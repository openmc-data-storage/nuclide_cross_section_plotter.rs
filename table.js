// The reaction table over a column store: filters, sort, pages.
//
// Filtering keeps the semantics the Yew app had. Each column has its own text
// box and the boxes AND together. A term matches a column value exactly when
// any value in the table equals it (case-insensitive), otherwise by prefix, so
// typing `C` gives carbon rather than every element from Ca to Cu, and `16`
// gives MT 16 rather than 160-something.
//
// The decision is made once per distinct value (a few hundred per column) and
// then applied to rows as a lookup, so a pass over half a million rows is a
// tight loop over small integers.

import { ATOMIC_SYMBOL, nucleonsLabel } from './elements.js';
import { LIBRARIES } from './libraries.js';
import { MT_NAMES } from './mt_names.js';
import { PHOTON_MTS } from './photon.js';
import { KIND_PHOTON } from './index_loader.js';

export const COLUMNS = ['element', 'nucleons', 'reaction', 'mt', 'library'];

/// The reaction name shown for a row: `(n,2n)`, `(γ,coherent)`, or `MT 999`.
export function reactionName(mt, kind) {
  if (kind === KIND_PHOTON) return PHOTON_MTS[mt]?.name ?? `MT ${mt}`;
  return MT_NAMES[mt] ?? `MT ${mt}`;
}

/// Key of the nucleons column: mass number and metastable state together.
const nucleonsKey = (a, meta) => a * 16 + meta;
/// Key of the reaction column: MT, with photon MTs kept apart from neutron ones.
const reactionKey = (mt, kind) => mt + (kind === KIND_PHOTON ? 65536 : 0);

/// Per-column dictionaries of the values present in a store: key -> lowercased
/// text, plus a rank for sorting.
export function buildDictionaries(store) {
  const dict = {
    element: new Map(), nucleons: new Map(), reaction: new Map(), mt: new Map(), library: new Map(),
  };
  const seen = { element: new Set(), nucleons: new Set(), reaction: new Set(), mt: new Set(), library: new Set() };
  for (let i = 0; i < store.n; i++) {
    seen.element.add(store.z[i]);
    seen.nucleons.add(nucleonsKey(store.a[i], store.meta[i]));
    seen.reaction.add(reactionKey(store.mt[i], store.kind[i]));
    seen.mt.add(store.mt[i]);
    seen.library.add(store.lib[i]);
  }
  for (const z of seen.element) dict.element.set(z, ATOMIC_SYMBOL[z].toLowerCase());
  for (const k of seen.nucleons) dict.nucleons.set(k, nucleonsLabel(k >> 4, k & 15).replace(' ', '').toLowerCase());
  for (const k of seen.reaction) dict.reaction.set(k, reactionName(k & 65535, k >= 65536 ? KIND_PHOTON : 0).toLowerCase());
  for (const mt of seen.mt) dict.mt.set(mt, String(mt));
  for (const lib of seen.library) dict.library.set(lib, `${LIBRARIES[lib].label} ${LIBRARIES[lib].id}`.toLowerCase());

  // Sort ranks: element and reaction alphabetical, the rest numeric or in
  // LIBRARIES order. Rank arrays are indexed by key.
  const rank = {};
  const alphabetical = (m) => [...m.entries()].sort((x, y) => (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0)).map(([k]) => k);
  rank.element = rankArray(alphabetical(dict.element), 256);
  rank.reaction = rankArray(alphabetical(dict.reaction), 131072);
  rank.nucleons = null; // numeric on the key itself
  rank.mt = null;
  rank.library = null;
  return { dict, rank };
}

function rankArray(orderedKeys, size) {
  const r = new Uint32Array(size);
  orderedKeys.forEach((k, i) => { r[k] = i + 1; });
  return r;
}

/// The keys a term admits in one column: exact match if any value equals the
/// term, otherwise every value the term is a prefix of.
export function allowedKeys(dictionary, term) {
  const t = term.trim().toLowerCase();
  const exact = [];
  const prefix = [];
  for (const [key, text] of dictionary) {
    if (text === t) exact.push(key);
    else if (text.startsWith(t)) prefix.push(key);
  }
  return exact.length ? exact : prefix;
}

/// Row indices surviving the filters, in store order.
///
/// `terms` maps column name to the text typed (empty or missing means no
/// filter). `enabledLibs` is a Uint8Array over LIBRARIES; `temperatureMask`
/// when non-zero keeps only rows publishing at least one ticked temperature
/// (photon rows always pass, having no temperature).
export function filterRows(store, dictionaries, terms, enabledLibs, temperatureMask = 0) {
  const { dict } = dictionaries;
  const allow = {};
  for (const col of COLUMNS) {
    const term = terms[col];
    if (!term || !term.trim()) continue;
    const size = col === 'element' ? 256 : col === 'nucleons' ? 65536 * 16 : col === 'reaction' ? 131072 : col === 'mt' ? 65536 : 8;
    const a = new Uint8Array(size);
    for (const k of allowedKeys(dict[col], term)) a[k] = 1;
    allow[col] = a;
  }
  const out = new Uint32Array(store.n);
  let n = 0;
  const { z, a, meta, mt, kind, lib, tmask } = store;
  const ae = allow.element, an = allow.nucleons, ar = allow.reaction, am = allow.mt, al = allow.library;
  for (let i = 0; i < store.n; i++) {
    if (!enabledLibs[lib[i]]) continue;
    if (temperatureMask && kind[i] !== KIND_PHOTON && !(tmask[i] & temperatureMask)) continue;
    if (ae && !ae[z[i]]) continue;
    if (an && !an[nucleonsKey(a[i], meta[i])]) continue;
    if (ar && !ar[reactionKey(mt[i], kind[i])]) continue;
    if (am && !am[mt[i]]) continue;
    if (al && !al[lib[i]]) continue;
    out[n++] = i;
  }
  return out.subarray(0, n);
}

/// Sort row indices by a column, stable, ascending or descending.
export function sortRows(indices, store, dictionaries, column, descending = false) {
  const { rank } = dictionaries;
  let key;
  switch (column) {
    case 'element': key = (i) => rank.element[store.z[i]]; break;
    case 'nucleons': key = (i) => nucleonsKey(store.a[i], store.meta[i]); break;
    case 'reaction': key = (i) => rank.reaction[reactionKey(store.mt[i], store.kind[i])]; break;
    case 'mt': key = (i) => store.mt[i]; break;
    case 'library': key = (i) => store.lib[i]; break;
    default: return indices;
  }
  const keys = new Float64Array(indices.length);
  for (let j = 0; j < indices.length; j++) keys[j] = key(indices[j]);
  const order = Uint32Array.from(indices.keys());
  const sign = descending ? -1 : 1;
  order.sort((p, q) => sign * (keys[p] - keys[q]) || indices[p] - indices[q]);
  const out = new Uint32Array(indices.length);
  for (let j = 0; j < order.length; j++) out[j] = indices[order[j]];
  return out;
}

/// One page of row indices and the page arithmetic around it.
export function paginate(indices, page, limit) {
  const total = indices.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * limit;
  return { rows: indices.subarray(start, Math.min(start + limit, total)), page: current, pages, total };
}

/// The stable id of a row: `endf-b8.1/Fe56/16`.
export function rowId(store, i) {
  return `${LIBRARIES[store.lib[i]].id}/${store.names[store.name[i]]}/${store.mt[i]}`;
}

/// Parse a row id back into its parts, or null.
export function parseRowId(id) {
  const m = /^([a-z0-9.-]+)\/([A-Za-z0-9_]+)\/(\d+)$/.exec(id);
  if (!m) return null;
  return { library: m[1], name: m[2], mt: Number(m[3]) };
}

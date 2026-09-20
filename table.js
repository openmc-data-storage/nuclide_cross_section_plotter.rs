// The reaction table over a column store: filters, sort, pages.
//
// Filtering keeps the semantics the Yew app had. Each column has its own text
// box and the boxes AND together. A term matches a column value exactly when
// any value in the table equals it (case-insensitive), otherwise by prefix, so
// typing `C` gives carbon rather than every element from Ca to Cu, and `16`
// gives MT 16 rather than 160-something.
//
// A table row is one (nuclide, reaction, library, temperature). The store
// holds one entry per (nuclide, reaction, library) with a bit mask of its
// temperatures, and the temperature axis is expanded while filtering rather
// than stored, so a row is a packed integer: store index shifted left by 3,
// plus the temperature bit (7 meaning none, for photon rows). The decision is
// made once per distinct value (a few hundred per column) and then applied as
// a lookup, so a pass over half a million entries is a tight loop over small
// integers.

import { ATOMIC_SYMBOL, nucleonsLabel } from './elements.js';
import { LIBRARIES } from './libraries.js';
import { MT_NAMES } from './mt_names.js';
import { PHOTON_MTS } from './photon.js';
import { KIND_PHOTON } from './index_loader.js';

export const COLUMNS = ['element', 'nucleons', 'reaction', 'mt', 'library', 'temperature'];

/// The temperature bit of a row with no temperature (photon).
export const NO_TEMPERATURE = 7;

/// Pack and unpack a table row.
export const packRow = (index, bit) => index * 8 + bit;
export const rowIndex = (packed) => Math.floor(packed / 8);
export const rowBit = (packed) => packed & 7;

/// The Kelvin number in a label: "294K" -> 294.
export const kelvinOf = (label) => parseFloat(label);

/// How a temperature cell reads: "294 K", or an em dash for a photon row.
export function temperatureLabel(store, bit) {
  if (bit === NO_TEMPERATURE) return '\u2014';
  const label = store.temperatures[bit];
  return label ? label.replace(/K$/, ' K') : '';
}

/// The reaction name shown for a row: `(n,2n)`, `(gamma,coherent)`, or `MT 999`.
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
    element: new Map(), nucleons: new Map(), reaction: new Map(), mt: new Map(), library: new Map(), temperature: new Map(),
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
  // Photon rows have no mass number and no nucleons text, so any term typed
  // in that box hides them; they are found through Element or Reaction.
  for (const k of seen.nucleons) dict.nucleons.set(k, nucleonsLabel(k >> 4, k & 15).replace(' ', '').toLowerCase());
  for (const k of seen.reaction) dict.reaction.set(k, reactionText(reactionName(k & 65535, k >= 65536 ? KIND_PHOTON : 0)));
  for (const mt of seen.mt) dict.mt.set(mt, String(mt));
  for (const lib of seen.library) dict.library.set(lib, `${LIBRARIES[lib].label} ${LIBRARIES[lib].id}`.toLowerCase());
  // Temperature text is the bare Kelvin number, so "294" is an exact match and
  // "2" a prefix of 250 and 2500. Photon rows have no temperature and pass
  // every temperature filter; they are not in the dictionary.
  store.temperatures.forEach((label, bit) => { if (bit < NO_TEMPERATURE) dict.temperature.set(bit, String(kelvinOf(label))); });

  // Sort ranks: element and reaction alphabetical, the rest numeric or in
  // LIBRARIES order. Rank arrays are indexed by key.
  const rank = {};
  const alphabetical = (m) => [...m.entries()].sort((x, y) => (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0)).map(([k]) => k);
  rank.element = rankArray(alphabetical(dict.element), 256);
  rank.reaction = rankArray(alphabetical(dict.reaction), 131072);
  rank.nucleons = null; // numeric on the key itself
  rank.mt = null;
  rank.library = null;
  rank.temperature = null;
  return { dict, rank };
}

function rankArray(orderedKeys, size) {
  const r = new Uint32Array(size);
  orderedKeys.forEach((k, i) => { r[k] = i + 1; });
  return r;
}

/// A reaction name as the filter sees it: lowercase, brackets dropped, and a
/// γ (which the table does not show, but someone may paste) spelled gamma, so
/// `(n,2n)` and `n,2n` are the same thing to type.
export function reactionText(name) {
  return name.toLowerCase().replace(/[()]/g, '').replace(/γ/g, 'gamma');
}

/// The keys a reaction term admits. Brackets are ignored on both sides, γ may
/// be typed as gamma, and a lone `g` before or after the comma means gamma
/// (`g,coherent`, `n,g`). Tiers, first non-empty wins: the whole name exactly
/// (`n,2n`), the product exactly (`2n`, `p`, `total`), the whole name by
/// prefix (`n,2`, `gamma,`), the product by prefix (`2n` when no channel is
/// exactly that). Exact before prefix keeps `p` at (n,p) rather than every
/// proton channel, and `gamma` at (n,gamma) rather than every photon row;
/// `gamma,` or `g,` lists the photon reactions.
export function allowedReactionKeys(dictionary, term) {
  // A γ typed on its own can only mean the photon reactions, so it reads as
  // `gamma,` rather than the capture product.
  const raw = term.trim().replace(/[()]/g, '');
  let t = raw === 'γ' ? 'gamma,' : reactionText(raw);
  if (!t) return [...dictionary.keys()];
  t = t.replace(/(^|,)g$/, '$1gamma').replace(/^g,/, 'gamma,');
  const tiers = [[], [], [], []];
  for (const [key, text] of dictionary) {
    const product = text.slice(text.indexOf(',') + 1);
    if (text === t) tiers[0].push(key);
    else if (product === t) tiers[1].push(key);
    else if (text.startsWith(t)) tiers[2].push(key);
    else if (product.startsWith(t)) tiers[3].push(key);
  }
  return tiers.find((tier) => tier.length) ?? [];
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

/// Packed rows surviving the filters, in store order.
///
/// `terms` maps column name to the text typed (empty or missing means no
/// filter). `enabledLibs` is a Uint8Array over LIBRARIES. Each store entry
/// becomes one row per temperature it publishes that the temperature filter
/// admits; a photon entry becomes one row with no temperature. The
/// temperature filter is `temperatureMask` (bits over `store.temperatures`)
/// when given, else the text in `terms.temperature`.
export function filterRows(store, dictionaries, terms, enabledLibs, temperatureMask = null) {
  const { dict } = dictionaries;
  const allow = {};
  for (const col of COLUMNS) {
    const term = terms[col];
    if (!term || !term.trim()) continue;
    const size = col === 'element' ? 256 : col === 'nucleons' ? 65536 * 16 : col === 'reaction' ? 131072 : col === 'mt' ? 65536 : 8;
    const a = new Uint8Array(size);
    const keys = col === 'reaction' ? allowedReactionKeys(dict[col], term) : allowedKeys(dict[col], term);
    for (const k of keys) a[k] = 1;
    allow[col] = a;
  }
  // The temperature filter as a bit mask over the store's temperature list.
  let tempMask = 0xff;
  if (temperatureMask !== null) {
    tempMask = temperatureMask;
  } else if (allow.temperature) {
    tempMask = 0;
    for (let b = 0; b < NO_TEMPERATURE; b++) if (allow.temperature[b]) tempMask |= 1 << b;
  }
  const out = new Uint32Array(store.n * 8);
  let n = 0;
  const { z, a, meta, mt, kind, lib, tmask } = store;
  const ae = allow.element, an = allow.nucleons, ar = allow.reaction, am = allow.mt, al = allow.library;
  for (let i = 0; i < store.n; i++) {
    if (!enabledLibs[lib[i]]) continue;
    if (ae && !ae[z[i]]) continue;
    if (an && !an[nucleonsKey(a[i], meta[i])]) continue;
    if (ar && !ar[reactionKey(mt[i], kind[i])]) continue;
    if (am && !am[mt[i]]) continue;
    if (al && !al[lib[i]]) continue;
    if (kind[i] === KIND_PHOTON) {
      out[n++] = packRow(i, NO_TEMPERATURE);
      continue;
    }
    let bits = tmask[i] & tempMask;
    for (let b = 0; bits; b++, bits >>= 1) if (bits & 1) out[n++] = packRow(i, b);
  }
  return out.subarray(0, n);
}

/// Sort row indices by a column, stable, ascending or descending.
export function sortRows(indices, store, dictionaries, column, descending = false) {
  const { rank } = dictionaries;
  const kelvin = store.temperatures.map(kelvinOf);
  let key;
  switch (column) {
    case 'element': key = (i) => rank.element[store.z[i]]; break;
    case 'nucleons': key = (i) => nucleonsKey(store.a[i], store.meta[i]); break;
    case 'reaction': key = (i) => rank.reaction[reactionKey(store.mt[i], store.kind[i])]; break;
    case 'mt': key = (i) => store.mt[i]; break;
    case 'library': key = (i) => store.lib[i]; break;
    case 'temperature': key = (i, bit) => (bit === NO_TEMPERATURE ? -1 : kelvin[bit]); break;
    default: return indices;
  }
  const keys = new Float64Array(indices.length);
  for (let j = 0; j < indices.length; j++) keys[j] = key(rowIndex(indices[j]), rowBit(indices[j]));
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

/// The stable id of a packed row: `endf-b8.1/Fe56/16/294K`, or
/// `endf-b8.1/Fe/502` for a photon row.
export function rowId(store, packed) {
  const i = rowIndex(packed);
  const bit = rowBit(packed);
  const base = `${LIBRARIES[store.lib[i]].id}/${store.names[store.name[i]]}/${store.mt[i]}`;
  return bit === NO_TEMPERATURE ? base : `${base}/${store.temperatures[bit]}`;
}

/// Parse a row id back into its parts, or null. `temperature` is null for a
/// photon row.
export function parseRowId(id) {
  const m = /^([a-z0-9.-]+)\/([A-Za-z0-9_]+)\/(\d+)(?:\/(\d+(?:\.\d+)?K))?$/.exec(id);
  if (!m) return null;
  return { library: m[1], name: m[2], mt: Number(m[3]), temperature: m[4] ?? null };
}

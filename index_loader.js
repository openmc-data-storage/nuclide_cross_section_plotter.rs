// Turning a library's published index.json into the columns the table runs on.
//
// The index is small on the wire (bit masks over one temperature list, MTs
// spelled out per nuclide) and is expanded here, once, into a struct of typed
// arrays: one row per (nuclide, MT). Filtering and sorting then touch only
// small integers, which is what keeps a table of half a million rows quick.
//
// Rows come out sorted by (Z, A, metastable, MT), the order the table shows by
// default, so the default view needs no sort. Several libraries' stores are
// concatenated with `mergeStores`.

import { parseNuclide } from './elements.js';
import { LIBRARIES } from './libraries.js';
import { PHOTON_MTS } from './photon.js';

export const KIND_NEUTRON = 0;
export const KIND_PHOTON = 1;

const LIBRARY_INDEX = new Map(LIBRARIES.map((l, i) => [l.id, i]));

/// Column-store constructor.
function store(n, library, particle, dataVersion, temperatures) {
  return {
    n,
    library, particle, dataVersion, temperatures,
    /// Index into LIBRARIES.
    lib: new Uint8Array(n),
    kind: new Uint8Array(n),
    z: new Uint8Array(n),
    a: new Uint16Array(n),
    meta: new Uint8Array(n),
    mt: new Uint16Array(n),
    /// Bit i set when temperatures[i] is published for this row; 0 for photon.
    tmask: new Uint8Array(n),
    /// Index into `names`.
    name: new Uint32Array(n),
    names: [],
    /// Rows skipped because their directory name was not understood.
    skipped: [],
  };
}

function checkIndex(index, particle) {
  if (!index || index.format !== 1) {
    throw new Error(`index.json format ${index?.format} is not 1`);
  }
  if (index.particle !== particle) {
    throw new Error(`index.json is for ${index.particle}, not ${particle}`);
  }
  if (!LIBRARY_INDEX.has(index.library)) {
    throw new Error(`index.json names unknown library ${index.library}`);
  }
}

/// Expand a neutron index.json into a store.
export function expandNeutronIndex(index) {
  checkIndex(index, 'neutron');
  const lib = LIBRARY_INDEX.get(index.library);
  const temperatures = index.temperatures;
  if (!Array.isArray(temperatures) || temperatures.length > 8) {
    throw new Error(`index.json lists ${temperatures?.length} temperatures; the store holds up to 8`);
  }
  const fullMask = index.full_mask;

  // Parse names first so rows can be laid out in nuclide order.
  const parsed = [];
  const skipped = [];
  for (const [name, entry] of Object.entries(index.nuclides)) {
    const p = parseNuclide(name);
    if (!p || p.a === 0) {
      skipped.push(name);
      continue;
    }
    parsed.push({ name, ...p, mts: entry.mts, masks: entry.masks ?? {} });
  }
  parsed.sort((x, y) => x.z - y.z || x.a - y.a || x.meta - y.meta);

  const n = parsed.reduce((sum, p) => sum + p.mts.length, 0);
  const s = store(n, index.library, 'neutron', index.data_version ?? null, temperatures);
  s.skipped = skipped;
  let row = 0;
  for (const p of parsed) {
    const nameIndex = s.names.push(p.name) - 1;
    const mts = [...p.mts].sort((x, y) => x - y);
    for (const mt of mts) {
      s.lib[row] = lib;
      s.kind[row] = KIND_NEUTRON;
      s.z[row] = p.z;
      s.a[row] = p.a;
      s.meta[row] = p.meta;
      s.mt[row] = mt;
      s.tmask[row] = p.masks[mt] ?? fullMask;
      s.name[row] = nameIndex;
      row++;
    }
  }
  return s;
}

/// Expand a photon index.json into a store (no temperatures).
export function expandPhotonIndex(index) {
  checkIndex(index, 'photon');
  const lib = LIBRARY_INDEX.get(index.library);
  const parsed = [];
  const skipped = [];
  for (const [symbol, mts] of Object.entries(index.elements)) {
    const p = parseNuclide(symbol);
    if (!p || p.a !== 0) {
      skipped.push(symbol);
      continue;
    }
    parsed.push({ name: symbol, ...p, mts: mts.filter((mt) => Object.hasOwn(PHOTON_MTS, mt)) });
  }
  parsed.sort((x, y) => x.z - y.z);
  const n = parsed.reduce((sum, p) => sum + p.mts.length, 0);
  const s = store(n, index.library, 'photon', index.data_version ?? null, []);
  s.skipped = skipped;
  let row = 0;
  for (const p of parsed) {
    const nameIndex = s.names.push(p.name) - 1;
    for (const mt of [...p.mts].sort((x, y) => x - y)) {
      s.lib[row] = lib;
      s.kind[row] = KIND_PHOTON;
      s.z[row] = p.z;
      s.a[row] = 0;
      s.meta[row] = 0;
      s.mt[row] = mt;
      s.tmask[row] = 0;
      s.name[row] = nameIndex;
      row++;
    }
  }
  return s;
}

/// Concatenate stores into one. `temperatures` must agree where present; the
/// merged store carries the union in the first store's order.
export function mergeStores(stores) {
  const n = stores.reduce((sum, s) => sum + s.n, 0);
  const temperatures = [];
  for (const s of stores) for (const t of s.temperatures) if (!temperatures.includes(t)) temperatures.push(t);
  if (temperatures.length > 8) throw new Error('more than 8 distinct temperature labels across libraries');
  const out = store(n, null, null, null, temperatures);
  let at = 0;
  for (const s of stores) {
    const nameBase = out.names.length;
    out.names.push(...s.names);
    // Re-map temperature bits when a store's list differs from the merged one.
    const sameOrder = s.temperatures.every((t, i) => temperatures[i] === t);
    const remap = sameOrder ? null : s.temperatures.map((t) => temperatures.indexOf(t));
    for (const col of ['lib', 'kind', 'z', 'a', 'meta', 'mt']) out[col].set(s[col], at);
    for (let i = 0; i < s.n; i++) {
      out.name[at + i] = s.name[i] + nameBase;
      let m = s.tmask[i];
      if (remap && m) {
        let r = 0;
        for (let b = 0; b < remap.length; b++) if (m & (1 << b)) r |= 1 << remap[b];
        m = r;
      }
      out.tmask[at + i] = m;
    }
    out.skipped.push(...s.skipped);
    at += s.n;
  }
  return out;
}

/// The bit of a temperature label in a store, or -1.
export function temperatureBit(storeOrMerged, label) {
  return storeOrMerged.temperatures.indexOf(label);
}

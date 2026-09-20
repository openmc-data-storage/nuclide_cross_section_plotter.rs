import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandNeutronIndex, expandPhotonIndex, mergeStores, KIND_PHOTON } from '../index_loader.js';
import { buildDictionaries, filterRows, sortRows, paginate, rowId, parseRowId, reactionName } from '../table.js';
import { LIBRARIES } from '../libraries.js';

const T = ['250K', '294K', '600K', '900K', '1200K', '2500K', '0K'];
const neutron = {
  format: 1, library: 'endf-b8.1', particle: 'neutron', data_version: '2026-09-18',
  temperatures: T, full_mask: 63,
  nuclides: {
    Fm257: { mts: [1, 2], masks: { 2: 127 } },
    Fe56: { mts: [16, 1, 2, 102], masks: { 2: 127 } },
    Am242_m1: { mts: [1, 18] },
    Am242: { mts: [1] },
    Weird: { mts: [1] },
  },
};
const jeff = { ...neutron, library: 'jeff-4.0', nuclides: { Fe56: { mts: [1, 2], masks: { 2: 127 } } } };
const photon = {
  format: 1, library: 'endf-b8.1', particle: 'photon', data_version: '2026-09-18',
  mts: [502, 504, 515, 517, 522], mts_verified: true,
  elements: { Fe: [502, 504, 522], H: [502] },
};
const all = new Uint8Array(LIBRARIES.length).fill(1);

test('a neutron index expands to one row per (nuclide, MT) in nuclide order', () => {
  const s = expandNeutronIndex(neutron);
  assert.equal(s.n, 9);
  assert.deepEqual(s.skipped, ['Weird']);
  const names = [...s.name].map((i) => s.names[i]);
  assert.deepEqual(names, ['Fe56', 'Fe56', 'Fe56', 'Fe56', 'Am242', 'Am242_m1', 'Am242_m1', 'Fm257', 'Fm257']);
  assert.deepEqual([...s.mt.subarray(0, 4)], [1, 2, 16, 102], 'MTs sorted within a nuclide');
  assert.equal(s.tmask[0], 63, 'MT 1 has the common six temperatures');
  assert.equal(s.tmask[1], 127, 'MT 2 also has 0 K');
  assert.equal(s.meta[5], 1);
  assert.equal(rowId(s, 5), 'endf-b8.1/Am242_m1/1');
  assert.deepEqual(parseRowId('endf-b8.1/Am242_m1/1'), { library: 'endf-b8.1', name: 'Am242_m1', mt: 1 });
});

test('a photon index expands with no temperatures and photon reaction names', () => {
  const s = expandPhotonIndex(photon);
  assert.equal(s.n, 4);
  assert.ok([...s.kind].every((k) => k === KIND_PHOTON));
  assert.equal(s.tmask[0], 0);
  assert.deepEqual([...s.mt], [502, 502, 504, 522], 'H (Z=1) before Fe (Z=26)');
  assert.equal(reactionName(502, KIND_PHOTON), '(γ,coherent)');
  assert.equal(reactionName(16, 0), '(n,2n)');
});

test('filters are exact when any value matches, else prefix, per column, ANDed', () => {
  const s = mergeStores([expandNeutronIndex(neutron), expandNeutronIndex(jeff), expandPhotonIndex(photon)]);
  assert.equal(s.n, 9 + 2 + 4);
  const d = buildDictionaries(s);
  const names = (rows) => [...new Set([...rows].map((i) => s.names[s.name[i]]))];
  const mts = (rows) => [...rows].map((i) => s.mt[i]);

  assert.deepEqual(names(filterRows(s, d, { element: 'F' }, all)).sort(), ['Fe', 'Fe56', 'Fm257'], 'prefix: Fe, Fm and photon Fe');
  assert.deepEqual(names(filterRows(s, d, { element: 'fe' }, all)).sort(), ['Fe', 'Fe56'], 'exact, case-insensitive');
  assert.deepEqual(mts(filterRows(s, d, { mt: '1' }, all)), [1, 1, 1, 1, 1], 'an exact MT wins over 16, 18, 102');
  assert.deepEqual(mts(filterRows(s, d, { mt: '10' }, all)), [102], 'no exact 10, so prefix');
  assert.deepEqual(names(filterRows(s, d, { nucleons: '242' }, all)), ['Am242'], 'ground state exact');
  assert.deepEqual(names(filterRows(s, d, { nucleons: '242m' }, all)), ['Am242_m1'], 'metastable by prefix');
  assert.deepEqual(mts(filterRows(s, d, { reaction: '(n,2n)' }, all)), [16]);
  assert.deepEqual(mts(filterRows(s, d, { reaction: '(γ' }, all)), [502, 502, 504, 522]);
  assert.deepEqual(names(filterRows(s, d, { library: 'jeff' }, all)), ['Fe56']);
  assert.deepEqual(mts(filterRows(s, d, { element: 'Fe', library: 'endf', mt: '2' }, all)), [2]);
  const onlyJeff = new Uint8Array(LIBRARIES.length); onlyJeff[LIBRARIES.findIndex((l) => l.id === 'jeff-4.0')] = 1;
  assert.equal(filterRows(s, d, {}, onlyJeff).length, 2);
  // Only rows publishing 0 K (bit 6): MT 2 rows; photon rows pass regardless.
  assert.deepEqual(mts(filterRows(s, d, {}, all, 1 << 6)).sort((x, y) => x - y), [2, 2, 2, 502, 502, 504, 522]);
});

test('sorting covers the whole filtered set and pagination clamps', () => {
  const s = mergeStores([expandNeutronIndex(neutron), expandPhotonIndex(photon)]);
  const d = buildDictionaries(s);
  const rows = filterRows(s, d, {}, all);
  const byMtDesc = sortRows(rows, s, d, 'mt', true);
  assert.deepEqual([...byMtDesc].map((i) => s.mt[i]), [522, 504, 502, 502, 102, 18, 16, 2, 2, 1, 1, 1, 1]);
  const byElement = sortRows(rows, s, d, 'element');
  const els = [...byElement].map((i) => s.names[s.name[i]].replace(/\d.*$/, ''));
  assert.deepEqual([...new Set(els)], ['Am', 'Fe', 'Fm', 'H'], 'alphabetical, not by Z');
  const p = paginate(rows, 99, 10);
  assert.deepEqual([p.page, p.pages, p.total, p.rows.length], [1, 2, 13, 3]);
  assert.equal(paginate(new Uint32Array(0), 0, 10).pages, 1);
});

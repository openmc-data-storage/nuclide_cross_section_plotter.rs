import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandNeutronIndex, expandPhotonIndex, mergeStores, KIND_PHOTON } from '../index_loader.js';
import { buildDictionaries, filterRows, sortRows, paginate, rowId, parseRowId, reactionName, rowIndex, rowBit, packRow, NO_TEMPERATURE, temperatureLabel } from '../table.js';
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
  assert.equal(rowId(s, packRow(5, 1)), 'endf-b8.1/Am242_m1/1/294K');
  assert.deepEqual(parseRowId('endf-b8.1/Am242_m1/1/294K'), { library: 'endf-b8.1', name: 'Am242_m1', mt: 1, temperature: '294K' });
  assert.deepEqual(parseRowId('endf-b8.1/Fe/502'), { library: 'endf-b8.1', name: 'Fe', mt: 502, temperature: null });
  assert.equal(temperatureLabel(s, 6), '0 K');
  assert.equal(temperatureLabel(s, NO_TEMPERATURE), '\u2014');
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
  const names = (rows) => [...new Set([...rows].map((p) => s.names[s.name[rowIndex(p)]]))];
  const mts = (rows) => [...rows].map((p) => s.mt[rowIndex(p)]);
  const temps = (rows) => [...rows].map((p) => (rowBit(p) === NO_TEMPERATURE ? null : s.temperatures[rowBit(p)]));
  const at294 = (terms) => filterRows(s, d, { temperature: '294', ...terms }, all);

  // Every neutron entry becomes one row per published temperature; photon one row.
  const everything = filterRows(s, d, {}, all);
  assert.equal(everything.length, 9 * 6 + 2 * 6 + 2 + 1 + 4, 'six temperatures each, 0 K on the three MT 2 entries, four photon rows');
  assert.equal(at294({}).length, 11 + 4, 'one row per entry at 294 K, photon rows pass');
  assert.deepEqual(new Set(temps(at294({ element: 'Fe' }))), new Set(['294K', null]));

  assert.deepEqual(names(at294({ element: 'F' })).sort(), ['Fe', 'Fe56', 'Fm257'], 'prefix: Fe, Fm and photon Fe');
  assert.deepEqual(names(at294({ element: 'fe' })).sort(), ['Fe', 'Fe56'], 'exact, case-insensitive');
  assert.deepEqual(mts(at294({ mt: '1' })), [1, 1, 1, 1, 1], 'an exact MT wins over 16, 18, 102');
  assert.deepEqual(mts(at294({ mt: '10' })), [102], 'no exact 10, so prefix');
  assert.deepEqual(names(at294({ nucleons: '242' })), ['Am242'], 'ground state exact');
  assert.deepEqual(names(at294({ nucleons: '242m' })), ['Am242_m1'], 'metastable by prefix');
  assert.deepEqual(mts(at294({ reaction: '(n,2n)' })), [16]);
  assert.deepEqual(mts(at294({ reaction: 'n,2n' })), [16], 'brackets are optional');
  assert.deepEqual(mts(at294({ reaction: '2n' })), [16], 'the product alone');
  assert.deepEqual(mts(at294({ reaction: 'gamma' })), [102], 'exact product beats the photon prefix');
  assert.deepEqual(mts(at294({ reaction: 'n,g' })), [102], 'g after the comma is gamma');
  assert.deepEqual(mts(at294({ reaction: 'fission' })), [18]);
  assert.deepEqual(mts(at294({ reaction: 'n,e' })), [2, 2, 2], 'prefix of the whole name: (n,elastic)');
  assert.deepEqual(mts(at294({ reaction: '(γ' })), [502, 502, 504, 522]);
  assert.deepEqual(mts(at294({ reaction: 'γ,coh' })), [502, 502]);
  assert.deepEqual(names(at294({ library: 'jeff' })), ['Fe56']);
  assert.deepEqual(mts(at294({ element: 'Fe', library: 'endf', mt: '2' })), [2]);
  const onlyJeff = new Uint8Array(LIBRARIES.length); onlyJeff[LIBRARIES.findIndex((l) => l.id === 'jeff-4.0')] = 1;
  assert.equal(filterRows(s, d, { temperature: '294' }, onlyJeff).length, 2, 'a disabled library masks its rows, photon rows included');
  // Temperature filter: exact "0" gives the 0 K rows (MT 2 only) plus photon rows; "2" is a prefix of 250 and 2500.
  assert.deepEqual(mts(filterRows(s, d, { temperature: '0' }, all)).sort((x, y) => x - y), [2, 2, 2, 502, 502, 504, 522]);
  assert.deepEqual(new Set(temps(filterRows(s, d, { temperature: '2', element: 'Fm' }, all))), new Set(['250K', '294K', '2500K']), '2 is a prefix of 250, 294 and 2500');
});

test('sorting covers the whole filtered set and pagination clamps', () => {
  const s = mergeStores([expandNeutronIndex(neutron), expandPhotonIndex(photon)]);
  const d = buildDictionaries(s);
  const rows = filterRows(s, d, { temperature: '294' }, all);
  const byMtDesc = sortRows(rows, s, d, 'mt', true);
  assert.deepEqual([...byMtDesc].map((p) => s.mt[rowIndex(p)]), [522, 504, 502, 502, 102, 18, 16, 2, 2, 1, 1, 1, 1]);
  const byElement = sortRows(rows, s, d, 'element');
  const els = [...byElement].map((p) => s.names[s.name[rowIndex(p)]].replace(/\d.*$/, ''));
  assert.deepEqual([...new Set(els)], ['Am', 'Fe', 'Fm', 'H'], 'alphabetical, not by Z');
  const fe2 = filterRows(s, d, { element: 'Fe', mt: '2' }, all);
  const byTemp = sortRows(fe2, s, d, 'temperature', true);
  assert.deepEqual([...byTemp].map((p) => s.temperatures[rowBit(p)]), ['2500K', '1200K', '900K', '600K', '294K', '250K', '0K'], 'numeric, descending');
  const p = paginate(rows, 99, 10);
  assert.deepEqual([p.page, p.pages, p.total, p.rows.length], [1, 2, 13, 3]);
  assert.equal(paginate(new Uint32Array(0), 0, 10).pages, 1);
});

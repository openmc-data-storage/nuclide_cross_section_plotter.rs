import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as arrow from 'apache-arrow';
import lz4 from 'lz4js';
import { createArrowDecoder } from '../arrow.js';
import { createEngine } from '../engine.js';
import { fixtureFetch } from './fixture_fetch.mjs';

const ORIGIN = 'https://data.test';
const decoder = createArrowDecoder(arrow, lz4.decompress);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function engine(opts = {}) {
  const fetchImpl = fixtureFetch({ origin: ORIGIN, ...opts });
  return { engine: createEngine({ origin: ORIGIN, fetchImpl, decoder }), log: fetchImpl.log };
}

test('a series is version.json plus two range requests, then one per further MT', async () => {
  const { engine: e, log } = engine();
  const s1 = await e.series('endf-b8.1', 'Li6', 1, '294K');
  assert.equal(s1.mt, 1);
  assert.equal(s1.temperature, '294K');
  assert.equal(s1.energy.length, s1.xs.length);
  assert.ok(s1.xs.every(Number.isFinite));
  // version.json, energy (schema + grid as two spans), reactions (schema + batch)
  const first = log.map((l) => `${l.url.split('/').pop()}${l.range ? ' ranged' : ''}`);
  assert.deepEqual(first.slice(0, 1), ['version.json']);
  assert.ok(first.filter((f) => f === 'energy.arrow ranged').length >= 1);
  assert.ok(first.filter((f) => f === 'reactions.arrow ranged').length >= 1);
  const n = log.length;

  const s2 = await e.series('endf-b8.1', 'Li6', 52, '294K');
  assert.equal(s2.mt, 52);
  assert.equal(log.length - n, 1, 'schema and grid are cached, so one range request');
  assert.ok(s2.threshold > 0 && s2.energy.length === s1.energy.length - s2.threshold,
    'an inelastic level reaction starts part-way up the grid');
  assert.equal(s2.energy[0], s1.energy[s2.threshold]);

  const s3 = await e.series('endf-b8.1', 'Li6', 1, '2500K');
  assert.equal(s3.temperature, '2500K');
  assert.ok(!same(s3.xs, s1.xs), 'a different temperature is different numbers');

  const again = await e.series('endf-b8.1', 'Li6', 1, '294K');
  assert.equal(again, s1, 'repeat requests come from memory');
  assert.equal(e.rangesStripped, false);
});

test('an origin that ignores Range gives the same numbers from whole files', async () => {
  const { engine: ranged } = engine();
  const { engine: stripped, log } = engine({ ranges: false });
  const a = await ranged.series('endf-b8.1', 'Li6', 2, '600K');
  const b = await stripped.series('endf-b8.1', 'Li6', 2, '600K');
  assert.ok(same(a.xs, b.xs) && same(a.energy, b.energy));
  assert.equal(stripped.rangesStripped, true);
  const n = log.length;
  const c = await stripped.series('endf-b8.1', 'Li6', 105, '294K');
  assert.equal(c.mt, 105);
  assert.equal(log.length, n, 'everything is already in memory after the whole file');
});

test('concurrent requests for one nuclide share a single version.json fetch', async () => {
  const { engine: e, log } = engine();
  await Promise.all([1, 2, 105].map((mt) => e.series('endf-b8.1', 'Li6', mt, '294K')));
  assert.equal(log.filter((l) => l.url.endsWith('version.json')).length, 1);
  assert.equal(log.filter((l) => l.url.endsWith('energy.arrow')).length, 1, 'one grid fetch');
});

test('errors name the nuclide, library and reaction', async () => {
  const { engine: e } = engine();
  await assert.rejects(e.series('tendl-2025', 'H1', 1, '294K'), /H1 is not published in tendl-2025/);
  await assert.rejects(e.series('endf-b8.1', 'Li6', 999, '294K'), /does not publish MT 999 at 294K/);
  await assert.rejects(e.series('endf-b8.1', 'Li6', 1, '77K'), /no energy grid at 77K/);
  await assert.rejects(e.series('endf-b9', 'Li6', 1, '294K'), /unknown library endf-b9/);
});

test('temperatures are listed in numeric order with 0K last', async () => {
  const { engine: e } = engine();
  const entry = await e.ensureNuclide('endf-b8.1', 'Li6');
  assert.deepEqual(e.temperaturesOf(entry), ['250K', '294K', '600K', '900K', '1200K', '2500K', '0K']);
  assert.equal(entry.dataVersion, '2026-09-18');
});

test('a photon element decodes to an eV grid and five cross sections', async () => {
  const { engine: e, log } = engine();
  const s = await e.photonSeries('endf-b8.1', 'H', 502);
  assert.equal(s.mt, 502);
  assert.equal(s.energy.length, s.xs.length);
  assert.ok(s.energy[0] > 0 && s.energy[s.energy.length - 1] > s.energy[0]);
  const t = await e.photonSeries('endf-b8.1', 'H', 522);
  assert.equal(t.energy, s.energy, 'one grid per element');
  assert.equal(log.filter((l) => l.url.endsWith('element.arrow')).length, 1);
  await assert.rejects(e.photonSeries('endf-b8.1', 'H', 501), /has no photon MT 501/);
  await assert.rejects(e.photonSeries('jeff-4.0', 'Fe', 502), /Fe is not published in jeff-4.0/);
});

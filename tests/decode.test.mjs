import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as arrow from 'apache-arrow';
import lz4 from 'lz4js';
import { createArrowDecoder, reactionSeries, energyGrid } from '../arrow.js';
import { reactionRanges, energyRanges, planFetch, spliceStream } from '../ranges.js';

const FIX = new URL('./fixtures/', import.meta.url).pathname;
const decoder = createArrowDecoder(arrow, lz4.decompress);
const bytes = (path) => new Uint8Array(readFileSync(path));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/// Emulate a ranged fetch against a local file: cut the planned spans out of
/// the whole file and splice them the way the worker does.
function spliced(path, schema, batchRanges) {
  const whole = bytes(path);
  const { parts, spans } = planFetch(schema, batchRanges);
  const bodies = spans.map((s) => whole.subarray(s.off, s.off + s.len));
  return spliceStream(parts, spans, bodies);
}

function nuclideFixture(name) {
  const dir = `${FIX}${name}.arrow/`;
  const version = JSON.parse(readFileSync(`${dir}version.json`, 'utf8'));
  return { dir, version, reactions: reactionRanges(version), energy: energyRanges(version) };
}

test('whole energy.arrow decodes to one labelled grid per temperature', () => {
  const { dir, energy } = nuclideFixture('Li6');
  const batches = decoder.readBatches(bytes(`${dir}energy.arrow`));
  const grids = batches.map((b) => energyGrid(decoder, b));
  assert.deepEqual(new Set(grids.map((g) => g.temperature)), new Set(energy.temperatures.keys()));
  for (const { grid } of grids) {
    assert.ok(grid.length > 100);
    for (let i = 1; i < grid.length; i++) assert.ok(grid[i] > grid[i - 1], 'grid is increasing');
  }
});

test('whole reactions.arrow decodes to one batch per indexed (MT, temperature)', () => {
  const { dir, reactions } = nuclideFixture('Li6');
  const batches = decoder.readBatches(bytes(`${dir}reactions.arrow`));
  let indexed = 0;
  for (const byT of reactions.mts.values()) indexed += byT.size;
  assert.equal(batches.length, indexed);
  const mts = new Set(batches.map((b) => decoder.scalar(b, 'mt')));
  assert.deepEqual(mts, new Set(reactions.mts.keys()));
});

test('a spliced stream decodes to the same numbers as the whole file', () => {
  const { dir, version, reactions, energy } = nuclideFixture('Li6');
  const wholeGrids = new Map(decoder.readBatches(bytes(`${dir}energy.arrow`))
    .map((b) => energyGrid(decoder, b)).map((g) => [g.temperature, g.grid]));
  const wholeXs = new Map();
  for (const b of decoder.readBatches(bytes(`${dir}reactions.arrow`))) {
    const mt = decoder.scalar(b, 'mt');
    const t = decoder.scalarList(b, 'xs_temperatures')[0];
    wholeXs.set(`${mt}@${t}`, reactionSeries(decoder, b, wholeGrids.get(t)));
  }
  assert.equal(version.format_version, 2);

  for (const T of ['294K', '2500K']) {
    const gridStream = spliced(`${dir}energy.arrow`, energy.schema, [energy.temperatures.get(T)]);
    const [gridBatch] = decoder.readBatches(gridStream);
    const { temperature, grid } = energyGrid(decoder, gridBatch);
    assert.equal(temperature, T);
    assert.ok(same(grid, wholeGrids.get(T)), `grid at ${T} identical`);

    for (const mt of [1, 2, 105]) {
      const range = reactions.mts.get(mt)?.get(T);
      assert.ok(range, `Li6 publishes MT ${mt} at ${T}`);
      const stream = spliced(`${dir}reactions.arrow`, reactions.schema, [range]);
      const [batch] = decoder.readBatches(stream);
      const series = reactionSeries(decoder, batch, grid);
      const expected = wholeXs.get(`${mt}@${T}`);
      assert.equal(series.mt, mt);
      assert.equal(series.temperature, T);
      assert.ok(same(series.xs, expected.xs), `MT ${mt} at ${T} identical`);
      assert.equal(series.energy.length, series.xs.length);
      assert.equal(series.energy[0], grid[series.threshold]);
    }
  }
});

test('several batches spliced together decode in file order', () => {
  const { dir, reactions, energy } = nuclideFixture('Li6');
  const T = '294K';
  const [gridBatch] = decoder.readBatches(spliced(`${dir}energy.arrow`, energy.schema, [energy.temperatures.get(T)]));
  const { grid } = energyGrid(decoder, gridBatch);
  const wanted = [105, 1, 2].map((mt) => reactions.mts.get(mt).get(T));
  const batches = decoder.readBatches(spliced(`${dir}reactions.arrow`, reactions.schema, wanted));
  const seen = batches.map((b) => reactionSeries(decoder, b, grid).mt);
  assert.deepEqual(seen, [1, 2, 105]);
});

test('every indexed range starts with an IPC continuation marker', () => {
  const { dir, reactions, energy } = nuclideFixture('Li6');
  const r = bytes(`${dir}reactions.arrow`);
  const e = bytes(`${dir}energy.arrow`);
  const marker = (buf, off) => buf[off] === 0xff && buf[off + 1] === 0xff && buf[off + 2] === 0xff && buf[off + 3] === 0xff;
  assert.ok(marker(r, reactions.schema.off) && marker(e, energy.schema.off));
  for (const byT of reactions.mts.values()) for (const { off } of byT.values()) assert.ok(marker(r, off));
  for (const { off } of energy.temperatures.values()) assert.ok(marker(e, off));
});

test('a photon element.arrow decodes to one grid and five cross sections', () => {
  const [batch] = decoder.readBatches(bytes(`${FIX}H.photon.arrow/element.arrow`));
  assert.equal(decoder.scalar(batch, 'name'), 'H');
  assert.equal(decoder.scalar(batch, 'Z'), 1);
  const ln = decoder.f64List(batch, 'ln_energy');
  const energy = ln.map(Math.exp);
  assert.ok(energy.length > 50);
  for (let i = 1; i < energy.length; i++) assert.ok(energy[i] > energy[i - 1]);
  for (const col of ['coherent_xs', 'incoherent_xs', 'photoelectric_xs', 'pair_production_electron_xs', 'pair_production_nuclear_xs']) {
    const xs = decoder.f64List(batch, col);
    assert.equal(xs.length, energy.length, col);
  }
});

const FE56 = '/home/jon/yamc-org/core/crates/yamc/tests/Fe56.arrow/';
test('Fe56 total at 294 K, the largest published buffer, splices identically', { skip: !existsSync(FE56) }, () => {
  const version = JSON.parse(readFileSync(`${FE56}version.json`, 'utf8'));
  const reactions = reactionRanges(version), energy = energyRanges(version);
  const T = '294K';
  const whole = new Map(decoder.readBatches(bytes(`${FE56}energy.arrow`)).map((b) => energyGrid(decoder, b)).map((g) => [g.temperature, g.grid]));
  const [gridBatch] = decoder.readBatches(spliced(`${FE56}energy.arrow`, energy.schema, [energy.temperatures.get(T)]));
  const { grid } = energyGrid(decoder, gridBatch);
  assert.ok(same(grid, whole.get(T)));
  const t0 = performance.now();
  const [batch] = decoder.readBatches(spliced(`${FE56}reactions.arrow`, reactions.schema, [reactions.mts.get(1).get(T)]));
  const series = reactionSeries(decoder, batch, grid);
  console.log(`  Fe56 MT 1 at 294 K: ${series.xs.length} points decoded in ${(performance.now() - t0).toFixed(1)} ms`);
  assert.equal(series.xs.length, grid.length);
  assert.ok(series.xs.every(Number.isFinite));
});

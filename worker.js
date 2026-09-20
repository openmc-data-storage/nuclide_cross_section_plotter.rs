// Web Worker hosting the data engine.
//
// The page never decodes anything itself: LZ4 plus Arrow decode of megabyte
// buffers and the expansion of a 700 kB index would stall typing in the filter
// boxes. Requests carry a requestId and get exactly one reply with the same id;
// typed arrays cross as transferred buffers.
//
//   in  {type: 'load_index', requestId, library, particle}
//   out {type: 'index', requestId, store}
//   in  {type: 'series', requestId, items: [{key, library, name, mt, temperature, photon}]}
//   out {type: 'series', requestId, results: [{key, energy, xs, label, threshold, dataVersion} | {key, error}]}
//   out {type: 'error', requestId, error}
// A single {type: 'ready'} is posted once the libraries have loaded.

import { arrow, lz4Decompress } from './deps.browser.js';
import { createArrowDecoder } from './arrow.js';
import { createEngine } from './engine.js';
import { expandNeutronIndex, expandPhotonIndex } from './index_loader.js';

const decoder = createArrowDecoder(arrow, lz4Decompress);
const engine = createEngine({ decoder });

const STORE_COLUMNS = ['lib', 'kind', 'z', 'a', 'meta', 'mt', 'tmask', 'name'];

async function loadIndex(library, particle) {
  const index = await engine.loadIndex(library, particle);
  return particle === 'neutron' ? expandNeutronIndex(index) : expandPhotonIndex(index);
}

async function oneSeries(item) {
  try {
    if (item.photon) {
      const s = await engine.photonSeries(item.library, item.name, item.mt);
      return { key: item.key, energy: s.energy.slice(), xs: s.xs.slice(), threshold: 0, dataVersion: s.dataVersion };
    }
    const s = await engine.series(item.library, item.name, item.mt, item.temperature);
    // Copies, not the engine's own views: the engine keeps its arrays for the
    // next request, and a transferred buffer is gone from this side.
    return { key: item.key, energy: s.energy.slice(), xs: s.xs.slice(), label: s.label, threshold: s.threshold };
  } catch (err) {
    return { key: item.key, error: String(err?.message ?? err) };
  }
}

self.postMessage({ type: 'ready' });

self.onmessage = async (event) => {
  const { type, requestId } = event.data ?? {};
  try {
    switch (type) {
      case 'load_index': {
        const { library, particle } = event.data;
        const store = await loadIndex(library, particle);
        self.postMessage({ type: 'index', requestId, store }, STORE_COLUMNS.map((c) => store[c].buffer));
        break;
      }
      case 'series': {
        const results = await Promise.all(event.data.items.map(oneSeries));
        const transfer = [];
        for (const r of results) if (!r.error) transfer.push(r.energy.buffer, r.xs.buffer);
        self.postMessage({ type: 'series', requestId, results, rangesStripped: engine.rangesStripped }, transfer);
        break;
      }
      default:
        throw new Error(`unknown request type ${type}`);
    }
  } catch (err) {
    self.postMessage({ type: 'error', requestId, error: String(err?.message ?? err) });
  }
};

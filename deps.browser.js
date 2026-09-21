// The two third-party libraries the worker needs, served from this repository
// so that loading the page contacts no host other than the one serving it.
// The tests import the same packages from npm instead.
//
// Versions are pinned in the file names: these are the `+esm` bundles that
// jsDelivr built for apache-arrow@21.2.0 and lz4js@0.2.0, copied into
// `vendor/` unchanged apart from a stripped source map comment.

export * as arrow from './vendor/apache-arrow-21.2.0.esm.js';
import lz4 from './vendor/lz4js-0.2.0.esm.js';
export const lz4Decompress = (bytes) => lz4.decompress(bytes);

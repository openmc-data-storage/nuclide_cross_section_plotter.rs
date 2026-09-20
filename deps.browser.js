// The two third-party libraries the worker needs, from a CDN so the site has
// no build step. This is the only file naming a CDN URL; the tests import the
// same packages from npm instead, and vendoring later means changing two lines.
//
// Versions are pinned exactly: the `+esm` bundles are rewritten by the CDN, so
// an integrity hash cannot be used, and a floating version could change the
// decoder under a published page.

export * as arrow from 'https://cdn.jsdelivr.net/npm/apache-arrow@21.2.0/+esm';
import lz4 from 'https://cdn.jsdelivr.net/npm/lz4js@0.2.0/+esm';
export const lz4Decompress = (bytes) => lz4.decompress(bytes);

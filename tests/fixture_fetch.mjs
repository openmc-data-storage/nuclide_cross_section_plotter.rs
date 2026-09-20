// A `fetch` over the files in tests/fixtures, standing in for the data host.
//
// Honours `Range` with a 206 by default, like the real origin; with
// `{ranges: false}` it answers every request with the whole object and a 200,
// which is what a proxy that strips the header looks like. Counts requests so
// tests can assert on what was fetched.

import { readFileSync, existsSync } from 'node:fs';

const FIX = new URL('./fixtures/', import.meta.url).pathname;

/// Map a host URL to a fixture path: `<origin>/<lib>/neutron/Li6.arrow/energy.arrow`
/// -> `fixtures/Li6.arrow/energy.arrow`; photon `H.arrow` -> `H.photon.arrow`.
function fixturePath(url, origin) {
  const rest = url.slice(origin.length + 1).split('/');
  const [, particle, dir, file] = rest;
  if (file === undefined) return `${FIX}${rest.slice(1).join('/')}`;
  const stem = particle === 'photon' ? dir.replace(/\.arrow$/, '.photon.arrow') : dir;
  return `${FIX}${stem}/${file}`;
}

export function fixtureFetch({ origin, ranges = true, log = [] } = {}) {
  const fetchImpl = async (url, opts = {}) => {
    const path = fixturePath(url, origin);
    const range = opts.headers?.Range;
    log.push({ url: url.slice(origin.length), range: range ?? null });
    if (!existsSync(path)) {
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }
    const whole = new Uint8Array(readFileSync(path));
    if (range && ranges) {
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      const body = whole.subarray(Number(m[1]), Number(m[2]) + 1);
      return new Response(body, { status: 206, statusText: 'Partial Content' });
    }
    return new Response(whole, { status: 200, statusText: 'OK' });
  };
  fetchImpl.log = log;
  return fetchImpl;
}

// Drives the page in headless Chromium against fixture data.
//
// The data host is routed to tests/fixtures: `index.json` for ENDF/B-VIII.1
// (Li6 and Li7 only, H for photons), and Li6's Arrow files, with `Range`
// honoured (206) the way the real origin does it. With `--no-range` every
// request is answered whole with a 200, the case of a proxy that strips the
// header, and the same steps must still pass. CDN requests pass through.
//
// Usage: python3 -m http.server 8000 & node tests/e2e.mjs [--no-range] [--url http://127.0.0.1:8000/]

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const noRange = args.includes('--no-range');
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://127.0.0.1:8000/';
const FIX = new URL('./fixtures/', import.meta.url).pathname;
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

function fixturePath(pathname) {
  // /endf-b8.1/neutron/Li6.arrow/energy.arrow -> Li6.arrow/energy.arrow
  // /endf-b8.1/photon/H.arrow/element.arrow  -> H.photon.arrow/element.arrow
  // /endf-b8.1/neutron/index.json            -> index/endf-b8.1/neutron/index.json
  const [, library, particle, dir, file] = pathname.split('/');
  if (dir === 'index.json') return `${FIX}index/${library}/${particle}/index.json`;
  const stem = particle === 'photon' ? dir.replace(/\.arrow$/, '.photon.arrow') : dir;
  return `${FIX}${stem}/${file}`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const requests = [];
await page.route('https://yamc-data.xsplot.com/**', (route) => {
  const pathname = new URL(route.request().url()).pathname;
  const path = fixturePath(pathname);
  const range = route.request().headers()['range'];
  requests.push({ pathname, range: range ?? null });
  if (!existsSync(path)) return route.fulfill({ status: 404, body: 'not found' });
  const whole = readFileSync(path);
  if (range && !noRange) {
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    return route.fulfill({ status: 206, body: whole.subarray(Number(m[1]), Number(m[2]) + 1), headers: { 'content-type': 'application/octet-stream' } });
  }
  return route.fulfill({ status: 200, body: whole, headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
});

const plot = () => page.evaluate(() => {
  const g = document.getElementById('plot');
  return { names: g.data.map((d) => d.name), lengths: g.data.map((d) => d.x.length), onY2: g.data.map((d) => d.yaxis ?? 'y'), y: g.layout.yaxis.title.text, y2: g.layout.yaxis2?.title.text ?? null, ytype: g.layout.yaxis.type };
});
const step = (name, ok, detail = '') => { console.log(`${ok ? 'ok' : 'FAIL'} - ${name}${detail ? `: ${detail}` : ''}`); if (!ok) process.exitCode = 1; };
const rows = () => page.evaluate(() => [...document.querySelectorAll('#rows tr[data-row]')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
/// Wait until the table shows exactly one row and it is the one named: the
/// filters are debounced, so the previous row is still there for a moment.
const waitForRow = (text) => page.waitForFunction((t) => {
  const trs = document.querAll ? [] : [...document.querySelectorAll('#rows tr[data-row]')];
  return trs.length === 1 && trs[0].innerText.replace(/\s+/g, ' ').includes(t);
}, text, { timeout: 15000 });

// Only ENDF/B-VIII.1 is fixtured; the hash limits the page to it.
await page.goto(`${url}index.html#l=endf-b8.1`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('busy').classList.contains('d-none') && document.querySelectorAll('#rows tr[data-row]').length > 0, null, { timeout: 60000 });
const counter = await page.textContent('#counter');
step('table lists Li6, Li7 and photon H', /· \d+ reactions match/.test(counter), counter);

await page.fill('.filter-input[data-column=element]', 'Li');
await page.fill('.filter-input[data-column=nucleons]', '6');
await page.fill('.filter-input[data-column=mt]', '105');
await waitForRow('(n,t) 105');
step('filters narrow to one row', (await rows())[0] === 'Li 6 (n,t) 105 ENDF/B-VIII.1', (await rows())[0]);

await page.check('#rows tr[data-row] .row-select');
await page.waitForFunction(() => document.getElementById('plot')?.data?.length === 1, null, { timeout: 60000 });
let p = await plot();
step('ticking a row draws it at 294 K', p.names[0] === 'Li6 (n,t) ENDF/B-VIII.1 294 K' && p.lengths[0] > 100, JSON.stringify(p.names));

await page.check('#temp-2500K');
await page.waitForFunction(() => document.getElementById('plot')?.data?.length === 2, null, { timeout: 60000 });
p = await plot();
step('ticking a temperature adds a trace', p.names[1] === 'Li6 (n,t) ENDF/B-VIII.1 2500 K');

await page.fill('.filter-input[data-column=mt]', '301');
await waitForRow('heating 301');
await page.check('#rows tr[data-row] .row-select');
await page.waitForFunction(() => document.getElementById('plot')?.data?.length === 4, null, { timeout: 60000 });
p = await plot();
step('heating goes on a right-hand eV·barn axis', p.y2 === 'Heating (eV·barn)' && p.onY2.filter((a) => a === 'y2').length === 2, JSON.stringify(p));

await page.click('#y-scale');
p = await plot();
step('the Y toggle switches to linear', p.ytype === 'linear');

await page.fill('.filter-input[data-column=element]', 'H');
await page.fill('.filter-input[data-column=nucleons]', '');
await page.fill('.filter-input[data-column=mt]', '502');
await waitForRow('(γ,coherent) 502');
await page.check('#rows tr[data-row] .row-select');
await page.waitForFunction(() => document.getElementById('plot')?.data?.length === 5, null, { timeout: 60000 });
p = await plot();
step('a photon reaction plots without a temperature', p.names[4] === 'H (γ,coherent) ENDF/B-VIII.1', p.names[4]);

await page.waitForTimeout(300);
const hash = await page.evaluate(() => location.hash);
step('the URL carries the state', hash.includes('s=endf-b8.1:Li6:105.301;endf-b8.1:H:502') && hash.includes('t=294,2500') && hash.includes('y=lin'), hash);

await page.screenshot({ path: `${SHOTS}plot${noRange ? '-no-range' : ''}.png`, fullPage: true });

await page.goto(`${url}index.html${hash}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('plot')?.data?.length === 5, null, { timeout: 90000 });
p = await plot();
step('reloading the URL restores the plot', p.names.length === 5 && p.ytype === 'linear');

// Read the download by watching the blob handed to createObjectURL; the real
// URL is still made so the click stays harmless.
const downloaded = await page.evaluate(() => new Promise((resolve) => {
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { blob.text().then(resolve); return orig(blob); };
  document.getElementById('download-json').click();
  setTimeout(() => { URL.createObjectURL = orig; }, 0);
}));
const parsed = JSON.parse(downloaded);
step('the JSON download has one object per series with units', parsed.length === 5 && parsed.every((s) => s.energy_eV.length === s.xs.length && s.units) && parsed.some((s) => s.units === 'eV barn'), `${parsed.length} series`);

const errorText = await page.textContent('#error');
step('no error is shown', errorText.trim() === '', errorText.trim());
const ranged = requests.filter((r) => r.range).length;
step(noRange ? 'whole files were used without Range' : 'range requests were used', noRange ? true : ranged > 0, `${requests.length} requests, ${ranged} ranged`);
step('no console errors', errors.length === 0, errors.join(' | '));

await browser.close();
if (process.exitCode) process.exit(process.exitCode);

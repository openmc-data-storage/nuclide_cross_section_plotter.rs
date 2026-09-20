# Nuclide cross section plotter

The source of the Nuclide Cross Section Plotter hosted on [xsplot.com](https://xsplot.com).

[Direct link to the web app](https://openmc-data-storage.github.io/nuclide_cross_section_plotter.rs/index.html)

Search every published neutron and photon reaction across six nuclear data
libraries and temperatures, compare libraries and temperatures on one plot,
and download the data. Each table row is one nuclide, reaction, library and
temperature. The Library and Temperature columns are filtered with dropdowns
of checkboxes; the temperature dropdown lists all seven published
temperatures (250, 294, 600, 900, 1200 and 2500 K, plus 0 K for elastic
scattering only) and starts with 294 K ticked. The page is a static site
with no build step: plain JavaScript modules, Bootstrap and Plotly.

## Where the data comes from

The cross sections are the Arrow files published at
`https://yamc-data.xsplot.com/<library>/<particle>/<Name>.arrow/`, the same
files the [yamc](https://github.com/fusion-neutronics/yamc) Monte Carlo code
reads. Each library also publishes an `index.json` per particle listing every
nuclide, reaction and temperature, which is what the table is built from.

Nothing is downloaded until a reaction is ticked. Each nuclide's `version.json`
carries the byte range of every record batch, and the reactions file is written
one batch per reaction and temperature, so plotting one cross section is one
small HTTP range request plus the energy grid of that temperature. The pieces
are spliced into an Arrow IPC stream and decoded in a Web Worker with
apache-arrow and an LZ4 codec (every published batch is LZ4-frame compressed).

Libraries: ENDF/B-VIII.1, JEFF-4.0, JENDL-5.0, TENDL-2025, TENDL-2017 and
FENDL-3.2d. Temperatures: 250, 294, 600, 900, 1200 and 2500 K, plus the
unbroadened 0 K grid where only elastic scattering is published. Photon
cross sections (coherent, incoherent, photoelectric and pair production) are
per element and have no temperature.

## Files

- `index.html`, `style.css`, `app.js`: the page and its controller
- `worker.js`: Web Worker that fetches and decodes; `deps.browser.js` names the CDN builds it uses
- `engine.js`: fetch planning, byte-range splicing and caching; `arrow.js`: Arrow decoding
- `index_loader.js`, `table.js`: the reaction table (typed-array store, filters, sort, pages)
- `plot.js`, `url_state.js`, `download.js`: the figure, the shareable URL hash, JSON and CSV export
- `ranges.js`, `libraries.js`, `mt_names.js`: shared with [materials_for_mc_online](https://github.com/shimwell/materials_for_mc_online)
- `elements.js`, `photon.js`: element symbols and photon reaction names
- `tests/`: Node unit tests and a Playwright end-to-end run against fixture data

## Running locally

```bash
python3 -m http.server 8000
```

then open [http://localhost:8000](http://localhost:8000). The page fetches
its data from the network.

## Tests

```bash
npm ci
npm test                 # unit tests against the fixtures in tests/fixtures
npx playwright install chromium
python3 -m http.server 8000 &
node tests/e2e.mjs       # drives the page in headless Chromium
```

The energy axis can be shown in eV or MeV; downloads are always in eV. The
sharing URL keeps the enabled libraries, selected reactions, axis scales and
energy unit in the hash, for example
`#l=endf-b8.1,jeff-4.0&s=endf-b8.1:Fe56:294:16.102;endf-b8.1:Fe56:600:16;jeff-4.0:Li6:294:1&e=MeV`.

## Browser support

The page uses a module Web Worker: Chrome and Edge 80+, Firefox 114+, Safari 15+.

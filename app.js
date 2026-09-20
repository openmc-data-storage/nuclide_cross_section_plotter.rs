// The page: a searchable table of every published reaction, a selection, and
// the plot. All decoding happens in worker.js; this file owns the DOM.

import { LIBRARIES, libraryLabel } from './libraries.js';
import { mergeStores, KIND_PHOTON } from './index_loader.js';
import {
  buildDictionaries, filterRows, sortRows, paginate, rowId, parseRowId, reactionName,
  rowIndex, rowBit, temperatureLabel, NO_TEMPERATURE,
} from './table.js';
import { encodeState, decodeState } from './url_state.js';
import { buildFigure, isEnergyRelease } from './plot.js';
import { seriesToJson, seriesToCsv, downloadText } from './download.js';
import { ATOMIC_SYMBOL, nucleonsLabel, parseNuclide } from './elements.js';

const PAGE_SIZE = 10;
/// What the temperature filter box starts with, so the table opens at room
/// temperature rather than seven rows per reaction.
const DEFAULT_TEMPERATURE_FILTER = '294';
const $ = (id) => document.getElementById(id);

// --- state ------------------------------------------------------------------

const state = {
  ...decodeState(location.hash),
  filters: { temperature: DEFAULT_TEMPERATURE_FILTER },
  sort: { column: null, descending: false },
  page: 0,
};

/// Stores by `${library}/${particle}` once their index has arrived.
const stores = new Map();
const storeLoads = new Map();
let merged = null;
let dictionaries = null;
let filtered = new Uint32Array(0);

/// Row facts for selected ids that are not in a loaded store yet (restored
/// from the URL): looked up when the store arrives.
const rowFacts = new Map();
/// Drawn series by row id (which names the temperature).
const seriesCache = new Map();
const seriesErrors = new Map();
/// Colour slot per series key, handed out in drawing order, kept until Clear.
const slots = new Map();
let pendingSeries = null;

// --- worker -------------------------------------------------------------------

const worker = new Worker('./worker.js', { type: 'module' });
const pending = new Map();
let workerReady = new Promise((resolve) => { worker.addEventListener('message', function once(e) { if (e.data?.type === 'ready') { worker.removeEventListener('message', once); resolve(); } }); });

worker.onmessage = (e) => {
  const msg = e.data;
  if (!msg.requestId) return;
  const p = pending.get(msg.requestId);
  if (!p) return;
  pending.delete(msg.requestId);
  if (msg.type === 'error') p.reject(new Error(msg.error)); else p.resolve(msg);
};
worker.onerror = (e) => showError(`The data worker failed: ${e.message}`);

function ask(type, payload = {}) {
  return workerReady.then(() => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    pending.set(requestId, { resolve, reject });
    worker.postMessage({ type, requestId, ...payload });
  }));
}

// --- busy / errors ------------------------------------------------------------

let busyCount = 0;
function busy(on, message) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  const el = $('busy');
  if (message) $('busy-text').textContent = message;
  el.classList.toggle('d-none', busyCount === 0);
}
function showError(message) {
  const el = $('error');
  el.textContent = message;
  el.classList.remove('d-none');
}
function clearError() {
  $('error').textContent = '';
  $('error').classList.add('d-none');
}
function setNotice(message) {
  const el = $('notice');
  el.textContent = message ?? '';
  el.classList.toggle('d-none', !message);
}

// --- indexes ------------------------------------------------------------------

function loadStore(library, particle) {
  const key = `${library}/${particle}`;
  if (stores.has(key) || storeLoads.has(key)) return storeLoads.get(key) ?? Promise.resolve();
  const p = ask('load_index', { library, particle }).then(({ store }) => {
    stores.set(key, store);
    rebuildStore();
  }).catch((err) => {
    showError(`Could not load the ${particle} list for ${libraryLabel(library)}: ${err.message}`);
  }).finally(() => { storeLoads.delete(key); busy(false); });
  storeLoads.set(key, p);
  busy(true, `Loading the ${particle} reaction list for ${libraryLabel(library)}...`);
  return p;
}

function loadEnabledLibraries() {
  for (const lib of LIBRARIES) {
    if (!state.libraries.has(lib.id)) continue;
    loadStore(lib.id, 'neutron');
    if (lib.photon) loadStore(lib.id, 'photon');
  }
}

function rebuildStore() {
  const ordered = [];
  for (const lib of LIBRARIES) {
    for (const particle of ['neutron', 'photon']) {
      const s = stores.get(`${lib.id}/${particle}`);
      if (s) ordered.push(s);
    }
  }
  merged = ordered.length ? mergeStores(ordered) : null;
  dictionaries = merged ? buildDictionaries(merged) : null;
  resolveRowFacts();
  renderTable();
  updatePlot();
}

/// Fill in kind and temperature mask for selected ids the URL restored.
function resolveRowFacts() {
  if (!merged) return;
  const unresolved = [...state.selection].filter((id) => !rowFacts.has(id));
  if (!unresolved.length) return;
  const wanted = new Map(unresolved.map((id) => [id, parseRowId(id)]).filter(([, p]) => p));
  for (let i = 0; i < merged.n && wanted.size; i++) {
    for (const [id, p] of wanted) {
      if (merged.mt[i] !== p.mt || LIBRARIES[merged.lib[i]].id !== p.library || merged.names[merged.name[i]] !== p.name) continue;
      const bit = p.temperature ? merged.temperatures.indexOf(p.temperature) : NO_TEMPERATURE;
      if (bit < 0 || (bit !== NO_TEMPERATURE && !(merged.tmask[i] & (1 << bit)))) continue;
      rowFacts.set(id, factsOfRow(i, bit));
      wanted.delete(id);
    }
  }
}

function factsOfRow(i, bit) {
  return {
    kind: merged.kind[i], z: merged.z[i], a: merged.a[i], meta: merged.meta[i],
    name: merged.names[merged.name[i]], mt: merged.mt[i], library: LIBRARIES[merged.lib[i]].id,
    temperature: bit === NO_TEMPERATURE ? null : merged.temperatures[bit],
  };
}

// --- table ----------------------------------------------------------------------

const enabledLibs = () => Uint8Array.from(LIBRARIES, (l) => (state.libraries.has(l.id) ? 1 : 0));

function renderTable() {
  const tbody = $('rows');
  if (!merged) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary">Loading the reaction list...</td></tr>';
    return;
  }
  filtered = filterRows(merged, dictionaries, state.filters, enabledLibs());
  if (state.sort.column) filtered = sortRows(filtered, merged, dictionaries, state.sort.column, state.sort.descending);
  const page = paginate(filtered, state.page, PAGE_SIZE);
  state.page = page.page;

  const html = [];
  for (const packed of page.rows) {
    const i = rowIndex(packed);
    const bit = rowBit(packed);
    const id = rowId(merged, packed);
    const checked = state.selection.has(id) ? ' checked' : '';
    const photon = merged.kind[i] === KIND_PHOTON;
    html.push(`<tr data-row="${packed}">
      <td><input class="form-check-input row-select" type="checkbox" data-id="${id}"${checked} aria-label="select ${id}"></td>
      <td>${ATOMIC_SYMBOL[merged.z[i]]}</td>
      <td class="mono">${photon ? '<span class="text-secondary">photon</span>' : nucleonsLabel(merged.a[i], merged.meta[i])}</td>
      <td>${reactionName(merged.mt[i], merged.kind[i])}</td>
      <td class="mono">${merged.mt[i]}</td>
      <td>${libraryLabel(LIBRARIES[merged.lib[i]].id)}</td>
      <td class="mono">${temperatureLabel(merged, bit)}</td>
    </tr>`);
  }
  if (!html.length) html.push('<tr><td colspan="7" class="text-center text-secondary">No reactions match these filters.</td></tr>');
  tbody.innerHTML = html.join('');
  $('counter').textContent = `${state.selection.size} selected · ${page.total.toLocaleString()} reactions match`;
  renderPagination(page);
  for (const th of document.querySelectorAll('th.sortable')) {
    const icon = th.querySelector('i');
    const active = th.dataset.column === state.sort.column;
    icon.className = `fa-solid ${active ? (state.sort.descending ? 'fa-sort-down' : 'fa-sort-up') : 'fa-sort'}`;
  }
}

function renderPagination({ page, pages }) {
  const ul = $('pagination');
  const item = (label, target, disabled = false, active = false, aria = '') =>
    `<li class="page-item${disabled ? ' disabled' : ''}${active ? ' active' : ''}"><a class="page-link" href="#" data-page="${target}" ${aria}>${label}</a></li>`;
  const parts = [item('&laquo;', 0, page === 0, false, 'aria-label="first"'), item('&lsaquo;', page - 1, page === 0, false, 'aria-label="previous"')];
  const from = Math.max(0, page - 2), to = Math.min(pages - 1, from + 4);
  for (let p = from; p <= to; p++) parts.push(item(String(p + 1), p, false, p === page));
  parts.push(item('&rsaquo;', page + 1, page >= pages - 1, false, 'aria-label="next"'), item('&raquo;', pages - 1, page >= pages - 1, false, 'aria-label="last"'));
  ul.innerHTML = parts.join('');
}

// --- selection and plot ------------------------------------------------------------

function seriesName(f) {
  const t = f.temperature ? ` ${f.temperature.replace(/K$/, ' K')}` : '';
  return `${f.name} ${reactionName(f.mt, f.kind)} ${libraryLabel(f.library)}${t}`;
}

/// The rows the current selection calls for, once their facts are known.
function wantedSeries() {
  const wanted = [];
  for (const id of state.selection) {
    const f = rowFacts.get(id);
    if (f) wanted.push({ id, temperature: f.temperature, f });
  }
  return wanted;
}

async function updatePlot() {
  const wanted = wantedSeries();
  const keyOf = (w) => w.id;
  const missing = wanted.filter((w) => !seriesCache.has(keyOf(w)) && !seriesErrors.has(keyOf(w)));
  if (missing.length) {
    const items = missing.map((w) => ({
      key: keyOf(w), library: w.f.library, name: w.f.name, mt: w.f.mt, temperature: w.temperature, photon: w.f.kind === KIND_PHOTON,
    }));
    busy(true, `Fetching ${items.length} cross section${items.length === 1 ? '' : 's'}...`);
    const request = ask('series', { items });
    pendingSeries = request;
    try {
      const { results, rangesStripped } = await request;
      for (const r of results) {
        if (r.error) seriesErrors.set(r.key, r.error); else seriesCache.set(r.key, r);
      }
      if (rangesStripped) setNotice('This network answers range requests with whole files, so downloads are larger than usual.');
    } catch (err) {
      showError(err.message);
    } finally {
      busy(false);
    }
    if (pendingSeries !== request) return; // a newer request superseded this one
  }
  drawPlot(wanted);
}

function drawPlot(wanted) {
  const drawn = [];
  const errors = [];
  for (const w of wanted) {
    const key = w.id;
    const s = seriesCache.get(key);
    if (!s) {
      if (seriesErrors.has(key)) errors.push(seriesErrors.get(key));
      continue;
    }
    if (!slots.has(key)) slots.set(key, slots.size);
    drawn.push({
      key, slot: slots.get(key), name: seriesName(w.f), energy: s.energy, xs: s.xs, mt: w.f.mt,
      meta: { ...w.f },
    });
  }
  if (errors.length) showError([...new Set(errors)].join('\n')); else clearError();
  const { data, layout, config } = buildFigure(drawn, { xLog: state.xLog, yLog: state.yLog, energyUnit: state.energyUnit });
  Plotly.react('plot', data, layout, config);
  currentSeries = drawn;
  $('download-json').disabled = $('download-csv').disabled = drawn.length === 0;
}
let currentSeries = [];

function exportSeries() {
  return currentSeries.map((d) => ({
    nuclide: d.meta.name,
    library: d.meta.library,
    particle: d.meta.kind === KIND_PHOTON ? 'photon' : 'neutron',
    mt: d.meta.mt,
    reaction: reactionName(d.meta.mt, d.meta.kind),
    temperature: d.meta.temperature,
    units: isEnergyRelease(d.meta.mt) ? 'eV barn' : 'barn',
    energy: d.energy,
    xs: d.xs,
  }));
}

// --- URL ---------------------------------------------------------------------------

let urlTimer = null;
function syncUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const hash = encodeState(state);
    const target = `${location.pathname}${location.search}${hash}`;
    if (`${location.pathname}${location.search}${location.hash}` !== target) history.replaceState(null, '', target);
  }, 150);
}

function applyUrl() {
  const decoded = decodeState(location.hash);
  state.libraries = decoded.libraries;
  state.selection = decoded.selection;
  state.xLog = decoded.xLog;
  state.yLog = decoded.yLog;
  state.energyUnit = decoded.energyUnit;
  renderControls();
  loadEnabledLibraries();
  resolveRowFacts();
  renderTable();
  updatePlot();
}

// --- controls -----------------------------------------------------------------------

/// What the library dropdown's button reads.
function libraryFilterLabel() {
  const n = state.libraries.size;
  if (n === LIBRARIES.length) return 'All libraries';
  if (n === 1) return libraryLabel([...state.libraries][0]);
  return `${n} of ${LIBRARIES.length} libraries`;
}

function renderControls() {
  for (const box of document.querySelectorAll('#library-menu input')) box.checked = state.libraries.has(box.value);
  $('library-filter').textContent = libraryFilterLabel();
  $('x-scale').textContent = state.xLog ? 'X: log' : 'X: linear';
  $('y-scale').textContent = state.yLog ? 'Y: log' : 'Y: linear';
  $('x-unit').textContent = `Energy: ${state.energyUnit}`;
}

function buildControls() {
  // The library filter: a dropdown of checkboxes in the column header. It
  // decides which libraries are listed and fetched, so it is the one control
  // for libraries; ticking a library that has not been loaded loads it.
  const menu = $('library-menu');
  const button = $('library-filter');
  menu.innerHTML = LIBRARIES.map((l) => `<div class="form-check">
      <input class="form-check-input" type="checkbox" id="lib-${l.id}" value="${l.id}">
      <label class="form-check-label" for="lib-${l.id}">${l.label}</label></div>`).join('');
  const openMenu = () => {
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${r.left}px`;
    menu.classList.remove('d-none');
    button.setAttribute('aria-expanded', 'true');
  };
  const closeMenu = () => { menu.classList.add('d-none'); button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', (e) => { e.stopPropagation(); if (menu.classList.contains('d-none')) openMenu(); else closeMenu(); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== button) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);
  menu.addEventListener('change', (e) => {
    if (!e.target.matches('input')) return;
    if (e.target.checked) state.libraries.add(e.target.value); else state.libraries.delete(e.target.value);
    if (!state.libraries.size) { state.libraries.add(e.target.value); e.target.checked = true; return; }
    state.page = 0;
    renderControls();
    loadEnabledLibraries();
    renderTable();
    syncUrl();
  });

  // One debounce for all five boxes, reading every box when it fires: a
  // per-box timer would let a quick tab-and-type across columns cancel the
  // earlier columns' updates.
  let filterTimer = null;
  const filterInputs = [...document.querySelectorAll('.filter-input')];
  for (const input of filterInputs) input.value = state.filters[input.dataset.column] ?? '';
  const applyFilters = () => {
    for (const input of filterInputs) state.filters[input.dataset.column] = input.value;
    state.page = 0;
    renderTable();
  };
  for (const input of filterInputs) {
    input.addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilters, 120); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(filterTimer); applyFilters(); } });
  }
  for (const th of document.querySelectorAll('th.sortable')) {
    th.addEventListener('click', () => {
      const column = th.dataset.column;
      if (state.sort.column === column) state.sort.descending = !state.sort.descending;
      else state.sort = { column, descending: false };
      renderTable();
    });
  }
  $('rows').addEventListener('change', (e) => {
    if (!e.target.matches('.row-select')) return;
    const id = e.target.dataset.id;
    const packed = Number(e.target.closest('tr').dataset.row);
    if (e.target.checked) { state.selection.add(id); rowFacts.set(id, factsOfRow(rowIndex(packed), rowBit(packed))); } else state.selection.delete(id);
    $('counter').textContent = `${state.selection.size} selected · ${filtered.length.toLocaleString()} reactions match`;
    updatePlot();
    syncUrl();
  });
  $('pagination').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-page]');
    if (!a) return;
    e.preventDefault();
    if (a.closest('.page-item').classList.contains('disabled')) return;
    state.page = Number(a.dataset.page);
    renderTable();
  });
  $('clear').addEventListener('click', () => {
    state.selection.clear();
    slots.clear();
    renderTable();
    updatePlot();
    syncUrl();
  });
  $('x-scale').addEventListener('click', () => { state.xLog = !state.xLog; renderControls(); drawPlot(wantedSeries()); syncUrl(); });
  $('y-scale').addEventListener('click', () => { state.yLog = !state.yLog; renderControls(); drawPlot(wantedSeries()); syncUrl(); });
  $('x-unit').addEventListener('click', () => { state.energyUnit = state.energyUnit === 'eV' ? 'MeV' : 'eV'; renderControls(); drawPlot(wantedSeries()); syncUrl(); });
  $('download-json').addEventListener('click', () => downloadText('xsplot_cross_sections.json', seriesToJson(exportSeries()), 'application/json'));
  $('download-csv').addEventListener('click', () => downloadText('xsplot_cross_sections.csv', seriesToCsv(exportSeries()), 'text/csv'));
  window.addEventListener('hashchange', applyUrl);
}

// --- start -------------------------------------------------------------------------

buildControls();
renderControls();
renderTable();
drawPlot([]);
loadEnabledLibraries();

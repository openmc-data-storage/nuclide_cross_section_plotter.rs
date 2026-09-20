// The plot as a URL: enabled libraries, temperatures, selected reactions and
// axis scales in the hash, so a plot can be linked and comes back on reload.
//
//   #l=endf-b8.1,jendl-5.0&t=294,600&s=endf-b8.1:Fe56:16.102;jendl-5.0:Li6:1&x=lin&y=lin
//
// Defaults are omitted: all libraries, 294 K only, both axes logarithmic.
// Selections are grouped by (library, nuclide) with the MTs dotted, which keeps
// a plot of one nuclide's many reactions short. Anything unparseable is
// dropped rather than failing the page.

import { LIBRARIES, DEFAULT_LIBRARY } from './libraries.js';

const LIBRARY_IDS = new Set(LIBRARIES.map((l) => l.id));
export const DEFAULT_TEMPERATURE = '294K';

/// Kelvin label -> the number written in the URL: "294K" -> "294".
const tempToUrl = (label) => label.replace(/K$/, '');
const tempFromUrl = (s) => (/^\d+(\.\d+)?$/.test(s) ? `${s}K` : null);

/// `state`: {libraries: Set<id>, temperatures: Set<label>, selection: Set<rowId>, xLog, yLog}.
export function encodeState(state) {
  const parts = [];
  const libs = [...state.libraries].filter((id) => LIBRARY_IDS.has(id));
  if (libs.length && libs.length < LIBRARIES.length) {
    parts.push(`l=${LIBRARIES.map((l) => l.id).filter((id) => state.libraries.has(id)).join(',')}`);
  }
  const temps = [...state.temperatures];
  if (!(temps.length === 1 && temps[0] === DEFAULT_TEMPERATURE)) {
    parts.push(`t=${temps.map(tempToUrl).join(',')}`);
  }
  if (state.selection.size) {
    const groups = new Map();
    for (const id of state.selection) {
      const m = /^([^/]+)\/([^/]+)\/(\d+)$/.exec(id);
      if (!m) continue;
      const key = `${m[1]}:${m[2]}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(Number(m[3]));
    }
    const groupText = [...groups.entries()]
      .map(([key, mts]) => `${key}:${mts.sort((a, b) => a - b).join('.')}`)
      .join(';');
    parts.push(`s=${groupText}`);
  }
  if (!state.xLog) parts.push('x=lin');
  if (!state.yLog) parts.push('y=lin');
  return parts.length ? `#${parts.join('&')}` : '';
}

/// The inverse: a full state with defaults filled in for anything absent.
export function decodeState(hash) {
  const state = {
    libraries: new Set(LIBRARIES.map((l) => l.id)),
    temperatures: new Set([DEFAULT_TEMPERATURE]),
    selection: new Set(),
    xLog: true,
    yLog: true,
  };
  const text = (hash ?? '').replace(/^#/, '');
  if (!text) return state;
  const fields = new Map();
  for (const part of text.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1)));
  }
  if (fields.has('l')) {
    const libs = fields.get('l').split(',').filter((id) => LIBRARY_IDS.has(id));
    state.libraries = new Set(libs.length ? libs : [DEFAULT_LIBRARY]);
  }
  if (fields.has('t')) {
    const temps = fields.get('t').split(',').map(tempFromUrl).filter(Boolean);
    state.temperatures = new Set(temps.length ? temps : [DEFAULT_TEMPERATURE]);
  }
  if (fields.has('s')) {
    for (const group of fields.get('s').split(';')) {
      const m = /^([a-z0-9.-]+):([A-Za-z0-9_]+):([^:]+)$/.exec(group);
      if (!m || !LIBRARY_IDS.has(m[1])) continue;
      for (const mt of m[3].split('.')) {
        if (/^\d+$/.test(mt)) state.selection.add(`${m[1]}/${m[2]}/${Number(mt)}`);
      }
    }
  }
  if (fields.get('x') === 'lin') state.xLog = false;
  if (fields.get('y') === 'lin') state.yLog = false;
  return state;
}

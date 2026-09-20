// The plot as a URL: enabled libraries, selected rows and axis scales in the
// hash, so a plot can be linked and comes back on reload.
//
//   #l=endf-b8.1,jendl-5.0&s=endf-b8.1:Fe56:294:16.102;endf-b8.1:Fe56:600:16;endf-b8.1:Fe::502&x=lin&y=lin
//
// Defaults are omitted: all libraries, both axes logarithmic. Selections are
// grouped by (library, nuclide, temperature) with the MTs dotted; the
// temperature is the bare Kelvin number and is empty for a photon row, which
// has none. Anything unparseable is dropped rather than failing the page.

import { LIBRARIES, DEFAULT_LIBRARY } from './libraries.js';

const LIBRARY_IDS = new Set(LIBRARIES.map((l) => l.id));

/// `state`: {libraries: Set<id>, selection: Set<rowId>, xLog, yLog}. A row id
/// is `library/name/mt` or `library/name/mt/294K`.
export function encodeState(state) {
  const parts = [];
  const libs = [...state.libraries].filter((id) => LIBRARY_IDS.has(id));
  if (libs.length && libs.length < LIBRARIES.length) {
    parts.push(`l=${LIBRARIES.map((l) => l.id).filter((id) => state.libraries.has(id)).join(',')}`);
  }
  if (state.selection.size) {
    const groups = new Map();
    for (const id of state.selection) {
      const m = /^([^/]+)\/([^/]+)\/(\d+)(?:\/(\d+(?:\.\d+)?)K)?$/.exec(id);
      if (!m) continue;
      const key = `${m[1]}:${m[2]}:${m[4] ?? ''}`;
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
  if (fields.has('s')) {
    for (const group of fields.get('s').split(';')) {
      const m = /^([a-z0-9.-]+):([A-Za-z0-9_]+):(\d+(?:\.\d+)?)?:([^:]+)$/.exec(group);
      if (!m || !LIBRARY_IDS.has(m[1])) continue;
      const suffix = m[3] ? `/${m[3]}K` : '';
      for (const mt of m[4].split('.')) {
        if (/^\d+$/.test(mt)) state.selection.add(`${m[1]}/${m[2]}/${Number(mt)}${suffix}`);
      }
    }
  }
  if (fields.get('x') === 'lin') state.xLog = false;
  if (fields.get('y') === 'lin') state.yLog = false;
  return state;
}

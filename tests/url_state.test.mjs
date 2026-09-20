import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState } from '../url_state.js';
import { LIBRARIES } from '../libraries.js';

const allLibs = new Set(LIBRARIES.map((l) => l.id));

test('defaults encode to nothing and decode back to defaults', () => {
  const state = { libraries: allLibs, selection: new Set(), xLog: true, yLog: true, energyUnit: 'eV' };
  assert.equal(encodeState(state), '');
  const back = decodeState('');
  assert.deepEqual([...back.libraries], [...allLibs]);
  assert.equal(back.selection.size, 0);
  assert.ok(back.xLog && back.yLog);
  assert.equal(back.energyUnit, 'eV');
});

test('a full state round-trips, grouping MTs by nuclide and temperature', () => {
  const state = {
    libraries: new Set(['jendl-5.0', 'endf-b8.1']),
    selection: new Set([
      'endf-b8.1/Fe56/102/294K', 'endf-b8.1/Fe56/16/294K', 'endf-b8.1/Fe56/16/600K',
      'jendl-5.0/Li6/1/2500K', 'endf-b8.1/Fe/502',
    ]),
    xLog: false, yLog: true, energyUnit: 'MeV',
  };
  const hash = encodeState(state);
  assert.equal(hash, '#l=endf-b8.1,jendl-5.0&s=endf-b8.1:Fe56:294:16.102;endf-b8.1:Fe56:600:16;jendl-5.0:Li6:2500:1;endf-b8.1:Fe::502&x=lin&e=MeV');
  const back = decodeState(hash);
  assert.deepEqual([...back.libraries].sort(), ['endf-b8.1', 'jendl-5.0']);
  assert.deepEqual([...back.selection].sort(), [...state.selection].sort());
  assert.equal(back.xLog, false);
  assert.equal(back.yLog, true);
  assert.equal(back.energyUnit, 'MeV');
});

test('garbage is dropped and defaults restored', () => {
  const back = decodeState('#l=nope&s=endf-b8.1:Fe56:294:16.x;bad;endf-b9:Li6:294:1;endf-b8.1:Fe::502&y=lin&e=keV&junk');
  assert.equal(back.energyUnit, 'eV', 'an unknown unit falls back to eV');
  assert.deepEqual([...back.libraries], ['endf-b8.1'], 'unknown libraries fall back to the default one');
  assert.deepEqual([...back.selection].sort(), ['endf-b8.1/Fe/502', 'endf-b8.1/Fe56/16/294K']);
  assert.equal(back.yLog, false);
});

test('every example link on the page decodes to a full selection', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const hrefs = [...html.matchAll(/<a href="(#s=[^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.length, 7, 'seven example plots');
  for (const href of hrefs) {
    const groups = href.slice(3).split(';');
    const expected = groups.reduce((n, g) => n + g.split(':')[3].split('.').length, 0);
    const state = decodeState(href);
    assert.equal(state.selection.size, expected, `${href} keeps every reaction`);
    assert.equal(encodeState({ ...state, libraries: allLibs }), href, `${href} round-trips`);
  }
});

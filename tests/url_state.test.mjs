import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState } from '../url_state.js';
import { LIBRARIES } from '../libraries.js';

const allLibs = new Set(LIBRARIES.map((l) => l.id));

test('defaults encode to nothing and decode back to defaults', () => {
  const state = { libraries: allLibs, selection: new Set(), xLog: true, yLog: true };
  assert.equal(encodeState(state), '');
  const back = decodeState('');
  assert.deepEqual([...back.libraries], [...allLibs]);
  assert.equal(back.selection.size, 0);
  assert.ok(back.xLog && back.yLog);
});

test('a full state round-trips, grouping MTs by nuclide and temperature', () => {
  const state = {
    libraries: new Set(['jendl-5.0', 'endf-b8.1']),
    selection: new Set([
      'endf-b8.1/Fe56/102/294K', 'endf-b8.1/Fe56/16/294K', 'endf-b8.1/Fe56/16/600K',
      'jendl-5.0/Li6/1/2500K', 'endf-b8.1/Fe/502',
    ]),
    xLog: false, yLog: true,
  };
  const hash = encodeState(state);
  assert.equal(hash, '#l=endf-b8.1,jendl-5.0&s=endf-b8.1:Fe56:294:16.102;endf-b8.1:Fe56:600:16;jendl-5.0:Li6:2500:1;endf-b8.1:Fe::502&x=lin');
  const back = decodeState(hash);
  assert.deepEqual([...back.libraries].sort(), ['endf-b8.1', 'jendl-5.0']);
  assert.deepEqual([...back.selection].sort(), [...state.selection].sort());
  assert.equal(back.xLog, false);
  assert.equal(back.yLog, true);
});

test('garbage is dropped and defaults restored', () => {
  const back = decodeState('#l=nope&s=endf-b8.1:Fe56:294:16.x;bad;endf-b9:Li6:294:1;endf-b8.1:Fe::502&y=lin&junk');
  assert.deepEqual([...back.libraries], ['endf-b8.1'], 'unknown libraries fall back to the default one');
  assert.deepEqual([...back.selection].sort(), ['endf-b8.1/Fe/502', 'endf-b8.1/Fe56/16/294K']);
  assert.equal(back.yLog, false);
});

/* Settings → Pen and touch → Pen pressure: the pen's pressure is bent on
   the way in, so a light hand gets a full line sooner and a heavy one
   keeps thin lines thin. A mouse and a finger are left as they were. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
  'editor.js', 'taps.js', 'tools.js', g => { g.DPO.store = { init: () => new Promise(() => {}), setLast() {} }; }, 'press.js', 'app.js');
const app = D.app;
const ev = (pointerType, pressure) => app.mkEv({ clientX: 0, clientY: 0, pointerType, pressure, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });

test('normal is the pen as it reports', () => {
  app.opts.general.pressureFeel = 'normal';
  assert.equal(ev('pen', 0.4).pressure, 0.4);
});

test('a light hand presses less for the same width; a heavy hand more', () => {
  app.opts.general.pressureFeel = 'light';
  const light = ev('pen', 0.4).pressure;
  app.opts.general.pressureFeel = 'firm';
  const firm = ev('pen', 0.4).pressure;
  assert.ok(light > 0.4 && firm < 0.4, `${light} and ${firm}`);
  assert.equal(ev('pen', 1).pressure, 1, 'full pressure is still full');
  assert.equal(ev('mouse', 0.5).pressure, 0.55, 'a mouse is not bent');
  app.opts.general.pressureFeel = 'normal';
});

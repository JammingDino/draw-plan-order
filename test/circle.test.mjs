/* The circle: an ellipse drawn out from its centre, its radius the
   distance the pen went, in any direction. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

test('dragged from the centre, its radius is how far the pen went', () => {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  app.camera.x = 0; app.camera.y = 0; app.camera.zoom = 1;
  app.opts.shape.kind = 'circle'; app.setTool('shape');
  const t = app.tools.shape, at = (x, y) => { const e = { x, y, sx: x, sy: y, pressure: 0.5, pointerType: 'mouse' }; e.samples = [e]; app.pointer = e; return e; };
  t.down(at(100, 100)); t.move(at(130, 140)); t.up(at(130, 140));
  const c = app.scene.items[0];
  assert.equal(c.kind, 'ellipse');
  assert.equal(c.w, 100); assert.equal(c.h, 100);
  assert.equal(c.x + c.w / 2, 100); assert.equal(c.y + c.h / 2, 100);
});

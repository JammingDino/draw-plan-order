/* The arc tool: through three points, or centre, start and end, in two
   goes. An arc is a moment arrow with no heads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function rig() {
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
  app.opts.shape.kind = 'arc'; app.setTool('shape');
  return { D, app, t: app.tools.shape };
}
const at = (app, x, y) => { const e = { x, y, sx: x, sy: y, pressure: 0.5, pointerType: 'mouse' }; e.samples = [e]; app.pointer = e; return e; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('through three points: the circle through them, the way round that passes the third', () => {
  const { app, t } = rig();
  app.opts.shape.arcMode = '3pt';
  t.down(at(app, 0, 0)); t.move(at(app, 200, 0)); t.up(at(app, 200, 0));
  assert.equal(app.scene.items.length, 0, 'nothing yet after the first go');
  t.down(at(app, 100, 100)); t.up(at(app, 100, 100));
  const a = app.scene.items[0];
  assert.equal(a.kind, 'moment'); assert.equal(a.head1, 'none'); assert.equal(a.head2, 'none');
  assert.ok(near(a.w, 200) && near(a.x, 0) && near(a.y, -100), 'centre (100, 0), radius 100');
  assert.ok(near(a.a0, 180) && near(a.sweep, 180), `from the left end, down through the bottom: ${a.a0}, ${a.sweep}`);
});

test('centre, start, end: followed round past half a turn', () => {
  const { app, t } = rig();
  app.opts.shape.arcMode = 'centre';
  t.down(at(app, 0, 0)); t.move(at(app, 50, 0)); t.up(at(app, 50, 0));
  t.down(at(app, 50, 0));
  for (let d = 0; d >= -300; d -= 15) t.move(at(app, 50 * Math.cos(d * Math.PI / 180), -50 * Math.sin(d * Math.PI / 180)));
  t.up(at(app, 0, 0));
  const a = app.scene.items[0];
  assert.ok(near(a.w, 100) && near(a.a0, 0), 'radius 50, from east');
  assert.ok(near(a.sweep, -300, 1e-6), `clockwise, three hundred degrees: ${a.sweep}`);
});

test('a tap for the first go starts nothing, and Escape forgets a half-made arc', () => {
  const { app, t } = rig();
  t.down(at(app, 10, 10)); t.up(at(app, 10, 10));
  assert.equal(t.arc, null);
  t.down(at(app, 0, 0)); t.move(at(app, 80, 0)); t.up(at(app, 80, 0));
  t.cancel();
  assert.equal(t.arc, null);
  assert.equal(app.scene.items.length, 0);
});

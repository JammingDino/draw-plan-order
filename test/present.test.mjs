/* Present (js/present.js): F5 shows the pages one at a time with the
   laser in hand; the arrow keys step; Escape puts everything back. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function rig() {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'ui.js', 'press.js', 'frames.js', 'present.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  return { D, app };
}
const key = (app, k) => app.onKey({ key: k, code: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: { matches: () => false }, preventDefault() {} });

test('F5 presents from the page in view, a page at a time, and Escape puts the view back', () => {
  const { D, app } = rig();
  for (let i = 0; i < 3; i++) app.scene.add(D.frames.make(app, { x: 0, y: i * 2000 }, { size: 'A4' }));
  app.setTool('pen');
  const was = { x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom };
  key(app, 'F5');
  assert.equal(D.present.active(), true);
  assert.equal(app.toolName, 'laser');
  key(app, 'ArrowRight'); key(app, 'ArrowRight'); key(app, 'ArrowRight');
  assert.equal(D.present.page(), 2, 'no further than the last');
  key(app, 'Home');
  assert.equal(D.present.page(), 0);
  key(app, 'Escape');
  assert.equal(D.present.active(), false);
  assert.equal(app.toolName, 'pen');
  assert.deepEqual({ x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom }, was);
});

test('without pages the board is shown whole, and the keys still end it', () => {
  const { D, app } = rig();
  D.present.start(app);
  assert.equal(D.present.active(), true);
  key(app, 'Escape');
  assert.equal(D.present.active(), false);
});

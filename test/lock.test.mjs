/* Lock: a page, picture or background left where it is. Never selected,
   moved or rubbed out until it is unlocked from the long-press menu. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

function rig(items = D => []) {
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
  const made = items(D);
  for (const it of made) app.scene.add(it);
  return { D, app, scene: app.scene, made };
}

test('locked: not selected by a tap, a box or Ctrl+A, and one undo step', () => {
  const { D, app, scene, made: [img, ink] } = rig(D => [
    D.make.image({ x: 0, y: 0, w: 400, h: 300 }),
    D.make.stroke({ pts: inked([500, 500, 600, 520]), size: 3 })
  ]);
  app.select([img, ink]);
  app.lockSelection();
  assert.equal(img.locked, true); assert.equal(ink.locked, true);
  assert.equal(app.selection.length, 0, 'let go of once locked');
  app.select(scene.items.slice());
  assert.equal(app.selection.length, 0, 'select all passes them by');
  app.setTool('select');
  const tool = app.tools.select, at = (x, y) => ({ x, y, sx: x, sy: y, samples: [], pointerType: 'mouse' });
  tool.down(at(200, 150)); tool.move(at(260, 190)); tool.up(at(260, 190));
  assert.equal(img.x, 0, 'a drag on it does not move it');
  app.undo();
  assert.equal(scene.get(img.id).locked, undefined, 'undone');
});

test('a locked stroke is not rubbed out', () => {
  const { D, made: [ink] } = rig(D => [D.make.stroke({ pts: inked([0, 0, 100, 0]), size: 3, locked: true })]);
  assert.equal(D.erasable(ink), false);
});

test('the long-press menu on a locked thing unlocks it, with what is grouped with it', () => {
  const { D, app, made: [a, b] } = rig(D => [
    D.make.shape({ kind: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#eee', group: 'g', locked: true }),
    D.make.shape({ kind: 'rect', x: 200, y: 0, w: 100, h: 100, fill: '#eee', group: 'g', locked: true })
  ]);
  app.setTool('select');
  app.unlock([a]);
  assert.ok(!a.locked && !b.locked);
  assert.equal(app.selection.length, 2, 'and selects them');
});

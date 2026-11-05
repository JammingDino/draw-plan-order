/* Flipping. Ink and lines have their points mirrored; a box is carried
   across by its centre and its turn goes the other way; a picture and a
   circuit part are mirrored in themselves, words are not. One undo step. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

function rig(items = D => []) {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'symbols.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  const made = items(D);
  for (const it of made) app.scene.add(it);
  return { D, app, scene: app.scene, made };
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('ink, an arrow and a box mirrored left to right about the middle of the selection', () => {
  const { D, app, scene, made: [ink, arrow, box] } = rig(D => [
    D.make.stroke({ pts: inked([0, 0, 100, 40]), size: 2 }),
    D.make.shape({ kind: 'arrow', x: 0, y: 60, w: 100, h: 0, size: 2, curve: [0.5, 0.2] }),
    D.make.shape({ kind: 'rect', x: 0, y: 80, w: 40, h: 20, size: 2 })
  ]);
  app.select([ink, arrow, box]);
  const c = app.selectionFrame().cx;
  app.flipSelection('x');
  assert.ok(near(ink.pts[0], 2 * c) && near(ink.pts[3], 2 * c - 100), 'the stroke runs the other way');
  assert.ok(near(arrow.x, 2 * c) && near(arrow.w, -100), 'the arrow points back');
  assert.ok(near(arrow.curve[1], -0.2), 'and its bend stays on the same side of the page');
  assert.ok(box.w > 0 && near(box.x + box.w / 2, 2 * c - 20), `the box, carried across and still the right way out: ${box.x}, ${box.w}`);
  app.undo();
  assert.ok(near(scene.get(box.id).x, 0) && near(scene.get(ink.id).pts[0], 0), 'one step undoes it all');
});

test('a turned box turns the other way; a triangle flipped top to bottom points down', () => {
  const { D, app, made: [r, t] } = rig(D => [
    D.make.shape({ kind: 'rect', x: 0, y: 0, w: 100, h: 20, size: 2, rot: 0.3 }),
    D.make.shape({ kind: 'triangle', x: 200, y: 0, w: 60, h: 60, size: 2 })
  ]);
  app.select([r]); app.flipSelection('x');
  assert.ok(near(r.rot, -0.3));
  app.select([t]); app.flipSelection('y');
  assert.ok(near(Math.abs(t.rot), Math.PI), 'half way round');
  app.flipSelection('y');
  assert.equal(t.rot, undefined, 'and back again, with no angle left over');
});

test('a picture is mirrored in itself; text is moved but stays readable', () => {
  const { D, app, made: [img, txt] } = rig(D => [
    D.make.image({ x: 0, y: 0, w: 50, h: 50 }),
    D.make.text({ x: 100, y: 0, text: 'abc' })
  ]);
  app.select([img, txt]); app.flipSelection('x');
  assert.equal(img.flipX, true);
  assert.ok(!txt.flipX && !txt.rot);
  assert.ok(img.x > txt.x, 'they swapped sides');
  app.select([img]); app.flipSelection('x');
  assert.equal(img.flipX, undefined, 'twice is no flip at all');
});

test('a circuit part is mirrored with its terminals', () => {
  const { D, app, made: [p] } = rig(D => [{ id: 'p', type: 'symbol', kind: 'diode', x: 0, y: 0, w: 80, h: 28, color: 'ink', size: 2, label: 'D1', textSize: 14 }]);
  const before = D.ext.items.symbol.snapPoints(p).filter(q => q.t === 'end').map(q => [q.k, q.x]);
  app.select([p]); app.flipSelection('x');
  assert.equal(p.mx, true);
  const after = Object.fromEntries(D.ext.items.symbol.snapPoints(p).filter(q => q.t === 'end').map(q => [q.k, q.x]));
  for (const [k, x] of before) assert.ok(near(after[k], 80 - x), `terminal ${k} moved across: ${x} → ${after[k]}`);
  app.flipSelection('y');
  assert.equal(p.my, true);
  app.flipSelection('x');
  assert.equal(p.mx, undefined, 'mirrored back');
});

test('Shift+H and Shift+V flip the selection; on their own they are still tools', () => {
  const { D, app, made: [r] } = rig(D => [D.make.shape({ kind: 'rect', x: 0, y: 0, w: 40, h: 20, size: 2, rot: 0.5 })]);
  app.select([r]);
  const key = (key, shiftKey) => app.onKey({ key, code: 'Key' + key.toUpperCase(), shiftKey, ctrlKey: false, metaKey: false, target: { matches: () => false }, preventDefault() {} });
  key('H', true);
  assert.ok(near(r.rot, -0.5));
  key('V', true);
  assert.ok(near(r.rot, 0.5));
  key('h', false);
  assert.equal(app.toolName, 'highlighter');
});

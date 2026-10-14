/* Turning and lining up. A box (shape, text, note, node, picture, page)
   keeps a turn in `rot`, about its own centre, and every question asked
   of it — its box, what is under the pointer, its outline, where it
   snaps — is answered turned. Ink and lines have their points turned.
   Align and distribute move groups as one piece, as one undo step. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

function rig(items = D => []) {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      // the boards sheet is shut, so the keyboard is the board's
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  const made = items(D);
  for (const it of made) app.scene.add(it);
  return { D, app, scene: app.scene, made };
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('a turned rectangle: boxed, hit and outlined turned, and painted about its centre', () => {
  const { D, app, scene, made: [r] } = rig(D => [D.make.shape({ kind: 'rect', x: 0, y: 0, w: 200, h: 20, fill: '#eee', size: 2 })]);
  app.select([r]);
  app.rotateSelection(90);
  assert.ok(near(r.rot, Math.PI / 2), 'a quarter turn, kept as an angle');
  assert.equal(r.x, 0, 'turned about its own centre: the box itself is where it was');
  const b = scene.bbox(r);
  assert.ok(near(b.w, 22, 1e-6) && near(b.h, 202, 1e-6), `boxed upright: ${b.w} × ${b.h}`);
  assert.ok(scene.hitItem(r, 100, 90, 1), 'inside, turned');
  assert.ok(!scene.hitItem(r, 10, 10, 1), 'where its end used to be is empty now');
  const o = scene.outlinePoints(r);
  assert.ok(near(Math.min(...o.filter((_, i) => i % 2 === 0)), 90) && near(Math.max(...o.filter((_, i) => i % 2)), 110), 'outline turned');
  // the snap points go round with it
  const ne = scene.snapPoints(r).find(p => p.k === 'ne');
  // clockwise on screen, as y runs down: the right-hand end swings down
  assert.ok(near(ne.x, 110) && near(ne.y, 110), `top-right corner now at ${ne.x}, ${ne.y}`);
  app.undo();
  assert.equal(scene.get(r.id).rot, undefined, 'undone');
});

test('four quarter turns come back to nothing, with no angle left behind', () => {
  const { app, made: [n] } = rig(D => [D.make.note({ x: 10, y: 10, w: 100, h: 100 })]);
  app.select([n]);
  for (let i = 0; i < 4; i++) app.rotateSelection(90);
  assert.equal(n.rot, undefined);
  assert.ok(near(n.x, 10) && near(n.y, 10));
});

test('ink and lines have their points turned about the selection, and the boxes ride round with them', () => {
  const { D, app, scene, made: [ink, line, box] } = rig(D => [
    D.make.stroke({ pts: inked([0, 0, 100, 0]), size: 2 }),
    D.make.shape({ kind: 'arrow', x: 0, y: 50, w: 100, h: 0, size: 2 }),
    D.make.shape({ kind: 'rect', x: 0, y: 80, w: 100, h: 20, size: 2 })
  ]);
  app.select([ink, line, box]);
  const c = D.util.boxCenter(app.selectionBounds());
  app.rotateSelection(180);
  assert.ok(near(ink.pts[0], 2 * c.x) && near(ink.pts[1], 2 * c.y), 'the stroke went half way round');
  assert.ok(near(line.w, -100) && near(line.h, 0, 1e-9), 'the arrow points the other way');
  assert.equal(line.rot, undefined, 'a line never takes an angle');
  assert.ok(near(Math.abs(box.rot), Math.PI));
  assert.ok(scene.bbox(box).y < scene.bbox(ink).y, 'the box that was at the bottom is at the top');
});

test('the turn handle: dragged round from above the selection, it settles on 15° steps', () => {
  const { D, app, made: [r] } = rig(D => [D.make.shape({ kind: 'rect', x: 100, y: 100, w: 100, h: 100, size: 2 })]);
  app.setTool('select');
  app.select([r]);
  app.camera.x = 0; app.camera.y = 0; app.camera.zoom = 1;
  app.selBox = { x: 95, y: 95, w: 110, h: 110 };
  const t = app.renderer.turnHandle(app.selBox);
  const tool = app.tools.select, at = (x, y) => ({ x, y, sx: x, sy: y, samples: [] });
  tool.down(at(t.x, t.y));
  assert.equal(tool.mode, 'turn');
  // round to the right of the centre (150,150), a whisker past 90°
  tool.move(at(150 + 80, 150 + 3));
  tool.up(at(150 + 80, 150 + 3));
  assert.ok(near(r.rot, Math.PI / 2), `snapped to a right angle: ${r.rot}`);
});

test('a turned box exports as SVG turned about its centre', async () => {
  const { D, app, made: [r] } = rig(D => [D.make.shape({ kind: 'rect', x: 0, y: 0, w: 40, h: 20, rot: Math.PI / 6 })]);
  const svg = await app.renderer.toSVG(app.scene, app.scene.contentBounds(), { theme: 'light', dark: false, transparent: true });
  assert.match(svg, /<g transform="rotate\(30 20 10\)">/);
});

test('align: left edges, centres and bottoms, a group moving as one piece', () => {
  let { D, app, made: [a, b, c1, c2] } = rig(D => [
    D.make.shape({ kind: 'rect', x: 10, y: 0, w: 50, h: 50, size: 0 }),
    D.make.shape({ kind: 'rect', x: 100, y: 200, w: 80, h: 30, size: 0 }),
    D.make.shape({ kind: 'rect', x: 300, y: 100, w: 20, h: 20, size: 0, group: 'g' }),
    D.make.shape({ kind: 'rect', x: 340, y: 100, w: 20, h: 20, size: 0, group: 'g' })
  ]);
  app.select([a, b, c1, c2]);
  assert.equal(app.alignUnits().length, 3, 'the group is one piece');
  app.alignSelection('left');
  assert.deepEqual([a.x, b.x, c1.x, c2.x], [10, 10, 10, 50], 'the group kept its shape');
  app.undo();
  // undo puts back copies of the items as they were: look them up again
  [a, b, c1, c2] = [a, b, c1, c2].map(i => app.scene.get(i.id));
  assert.deepEqual([a.x, b.x, c1.x, c2.x], [10, 100, 300, 340], 'one undo step');
  app.select([a, b]);
  app.alignSelection('bottom');
  assert.equal(a.y + a.h, 230); assert.equal(b.y + b.h, 230);
  app.alignSelection('hcentre');
  assert.equal(a.x + a.w / 2, b.x + b.w / 2);
});

test('distribute: equal gaps between pieces, the outermost left where they were', () => {
  const { D, app, made } = rig(D => [
    D.make.shape({ kind: 'rect', x: 0, y: 0, w: 10, h: 10, size: 0 }),
    D.make.shape({ kind: 'rect', x: 30, y: 0, w: 40, h: 10, size: 0 }),
    D.make.shape({ kind: 'rect', x: 75, y: 0, w: 10, h: 10, size: 0 }),
    D.make.shape({ kind: 'rect', x: 200, y: 0, w: 10, h: 10, size: 0 })
  ]);
  app.select(made);
  app.alignSelection('hspace');
  const xs = made.map(m => [m.x, m.x + m.w]).sort((p, q) => p[0] - q[0]);
  const gaps = xs.slice(1).map((p, i) => p[0] - xs[i][1]);
  assert.equal(xs[0][0], 0); assert.equal(xs[3][1], 210);
  for (const g of gaps) assert.ok(near(g, gaps[0]), `gaps ${gaps}`);
  // two pieces have no gap between them to share out
  app.select(made.slice(0, 2));
  const was = made[1].x;
  app.alignSelection('hspace');
  assert.equal(made[1].x, was);
});

test('Ctrl+R turns the selection a quarter clockwise, Ctrl+Shift+R back', () => {
  const { app, made: [n] } = rig(D => [D.make.note({ x: 0, y: 0, w: 100, h: 50 })]);
  app.select([n]);
  const key = (k, o = {}) => app.onKey({ key: k, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, target: { matches: () => false, closest: () => null }, preventDefault() {}, ...o });
  key('r');
  assert.ok(near(n.rot, Math.PI / 2));
  key('R', { shiftKey: true });
  assert.equal(n.rot, undefined);
});

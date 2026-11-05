/* Repeat (js/repeat.js): copies of the selection in a row, or round a
   centre, as one undo step. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function rig(items) {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'repeat.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false, buildPanel() {} };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  const made = items(D);
  for (const it of made) app.scene.add(it);
  return { D, app, made };
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('in a row: each copy a step on from the one before, one undo step for all', () => {
  const { D, app, made: [r] } = rig(D => [D.make.shape({ kind: 'rect', x: 0, y: 0, w: 40, h: 20 })]);
  app.select([r]);
  const made = D.repeat.run(app, { mode: 'row', count: 3, dx: 50, dy: 10 });
  assert.equal(made.length, 3);
  assert.equal(JSON.stringify(made.map(c => [c.x, c.y])), '[[50,10],[100,20],[150,30]]');
  assert.equal(app.selection.length, 4, 'the copies and the original, selected');
  app.undo();
  assert.equal(app.scene.items.length, 1);
});

test('round a whole turn: shared out evenly, none on top of the first', () => {
  const { D, app, made: [h] } = rig(D => [D.make.shape({ kind: 'ellipse', x: 90, y: -110, w: 20, h: 20 })]);
  app.select([h]);
  const made = D.repeat.run(app, { mode: 'round', count: 3, angle: 360, centre: { x: 100, y: 0 } });
  const at = made.map(c => [Math.round(c.x + 10), Math.round(c.y + 10)]);
  // quarter turns anticlockwise on paper: up, left, down, right
  assert.equal(JSON.stringify(at), '[[0,0],[100,100],[200,0]]');
});

test('round part of a turn: from end to end', () => {
  const { D, app, made: [h] } = rig(D => [D.make.shape({ kind: 'ellipse', x: 190, y: -10, w: 20, h: 20 })]);
  app.select([h]);
  const made = D.repeat.run(app, { mode: 'round', count: 2, angle: 90, centre: { x: 0, y: 0 } });
  const last = made[1];
  assert.ok(near(last.x + 10, 0, 1e-6) && near(last.y + 10, -200, 1e-6), 'the last one a quarter turn round, at the top');
});

test('a connector between two copied things joins the copies', () => {
  const { D, app, made } = rig(D => [
    D.make.node({ x: 0, y: 0, w: 50, h: 30 }), D.make.node({ x: 100, y: 0, w: 50, h: 30 })
  ]);
  const e = D.make.edge({ from: { id: made[0].id }, to: { id: made[1].id } });
  app.scene.add(e);
  app.select([made[0], made[1], e]);
  const copies = D.repeat.run(app, { mode: 'row', count: 1, dx: 0, dy: 100 });
  const ce = copies.find(c => c.type === 'edge'), ids = new Set(copies.map(c => c.id));
  assert.ok(ids.has(ce.from.id) && ids.has(ce.to.id));
});

/* Panning shifts the picture already painted and paints only the strips
   that uncovered — but only when nothing except the camera's position has
   changed, and only by whole device pixels. Everything else repaints. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js');

function rig() {
  const scene = new D.Scene();
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * 60, y = Math.floor(i / 20) * 40;
    scene.add(D.make.stroke({ pts: inked([x, y, x + 20, y + 20]), size: 3 }));
  }
  const app = { scene, camera: new D.Camera(), requestDraw() {}, opts: {} };
  const r = new D.Renderer(app);
  r.grid = 'none';
  const blits = () => r.bctx.calls.filter(c => c === 'drawImage').length;
  r.drawScene();
  const visible = r.lastDrawn;
  r.bctx.calls.length = 0;
  return { app, r, scene, blits, visible };
}

test('a whole-pixel pan shifts the picture and paints only the new strip', () => {
  const { app, r, blits, visible } = rig();
  app.camera.panBy(-10, 0);                 // dpr is 2 here: 20 device pixels
  r.drawScene(true);
  assert.equal(blits(), 1, 'the old picture is moved, not repainted');
  assert.ok(r.lastDrawn < visible / 3, `only the strip: ${r.lastDrawn} of ${visible}`);
});

test('a pan that is not on the pixel grid repaints', () => {
  const { app, r, blits, visible } = rig();
  app.camera.panBy(-0.3, 0);                // 0.6 device px
  r.drawScene(true);
  assert.equal(blits(), 0);
  assert.equal(r.lastDrawn, visible);
});

test('a zoom, an edit or a change of paper repaints, even when asked to scroll', () => {
  for (const change of [
    ({ app }) => { app.camera.zoom = 1.1; },
    ({ scene }) => { scene.add(D.make.stroke({ pts: inked([5, 5, 9, 9]) })); },
    ({ r }) => { r.grid = 'dots'; }
  ]) {
    const k = rig();
    change(k);
    k.app.camera.panBy(-10, 0);
    k.r.drawScene(true);
    assert.equal(k.blits(), 0, String(change));
  }
});

test('without the caller\u2019s word that only the camera moved, it repaints', () => {
  const { app, r, blits, visible } = rig();
  app.camera.panBy(-10, 0);
  r.drawScene();
  assert.equal(blits(), 0);
  assert.equal(r.lastDrawn, visible);
});

test('a pan of most of a screen is painted whole', () => {
  const { app, r, blits } = rig();
  app.camera.panBy(-900, 0);
  r.drawScene(true);
  assert.equal(blits(), 0);
});

/* ── adding on top ────────────────────────────────────────────────── */
/* A new stroke on top is painted over the picture already there; any
   other change, or a change the scene cannot see, repaints. */

const cleared = r => r.bctx.calls.filter(c => c === 'clearRect').length;

test('an item added on top is painted alone, over what is there', () => {
  const { r, scene } = rig();
  scene.add(D.make.stroke({ pts: inked([5, 5, 30, 30]) }));
  r.drawScene();
  assert.equal(cleared(r), 0, 'the canvas was not wiped');
  assert.equal(r.lastDrawn, 1);
});

test('anything other than adding on top repaints the board', () => {
  for (const change of [
    s => s.add(D.make.stroke({ pts: inked([5, 5, 30, 30]) }), 0),           // underneath
    s => { s.add(D.make.stroke({ pts: inked([5, 5, 9, 9]) })); s.touch(s.items[3]); },
    s => { s.add(D.make.stroke({ pts: inked([5, 5, 9, 9]) })); s.remove(s.items[3]); },
    s => { s.add(D.make.stroke({ pts: inked([5, 5, 9, 9]) })); s.reorder([s.items[0]], 'front'); },
    s => { s.begin('x'); s.add(D.make.stroke({ pts: inked([5, 5, 9, 9]) })); s.commit(); s.undo(); s.redo(); }
  ]) {
    const { r, scene, visible } = rig();
    change(scene);
    r.drawScene();
    assert.equal(cleared(r), 1, String(change));
    assert.ok(r.lastDrawn >= visible, String(change));
  }
});

test('an add together with a pan, or after an invalidate, repaints', () => {
  const a = rig();
  a.scene.add(D.make.stroke({ pts: inked([5, 5, 30, 30]) }));
  a.app.camera.panBy(-10, 0);
  a.r.drawScene(true);
  assert.equal(cleared(a.r), 1);

  const b = rig();
  b.scene.add(D.make.stroke({ pts: inked([5, 5, 30, 30]) }));
  b.r.invalidate();                        // say, a PDF page finished rendering
  b.r.drawScene();
  assert.equal(cleared(b.r), 1);
});

test('nothing changed and a draw was asked for anyway: it repaints', () => {
  const { r } = rig();
  r.drawScene();                           // an image decoded, a page rendered…
  assert.equal(cleared(r), 1);
});

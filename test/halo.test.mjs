/* The halo (Renderer.haloSoon): a softer picture of the board round the
   view, so a zoom out has the board to show at its edges rather than bare
   paper while the scaled picture waits to be painted sharp. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js');

function rig() {
  const scene = new D.Scene();
  // a board four times the window each way, written all over
  for (let i = 0; i < 900; i++) {
    const x = -2500 + (i % 30) * 170, y = -1600 + Math.floor(i / 30) * 110;
    scene.add(D.make.stroke({ pts: inked([x, y, x + 40, y + 30]), size: 3 }));
  }
  const app = { scene, camera: new D.Camera(), requestDraw() {}, opts: {} };
  const r = new D.Renderer(app);
  r.grid = 'none';
  r.drawScene();
  const blits = () => r.bctx.calls.filter(c => c === 'drawImage').length;
  return { app, r, scene, blits };
}

/** paint the whole halo now, as idle moments would */
const paintHalo = r => { r.haloStep(null); return r.halo; };

test('the halo covers three views each way, at a lower resolution, painted in tiles from the middle', () => {
  const { app, r } = rig();
  const h = paintHalo(r);
  assert.ok(h && h.next === h.order.length, 'every tile painted');
  const v = app.camera.viewport(r.w, r.h, 0);
  assert.ok(Math.abs(h.W / h.s - v.w * 3) < 2 && Math.abs(h.H / h.s - v.h * 3) < 2, 'three views across and down');
  assert.ok(h.W * h.H <= 6e6 + h.W + h.H, `within its pixel budget: ${h.W}×${h.H}`);
  assert.ok(h.s < app.camera.zoom * r.dpr, 'softer than the screen');
  const first = h.order[0], mid = { x: Math.ceil(h.W / 512) / 2, y: Math.ceil(h.H / 512) / 2 };
  assert.ok(Math.hypot(first.x + 0.5 - mid.x, first.y + 0.5 - mid.y) < 1, 'the middle first');
  assert.ok(h.ctx.calls.some(c => c === 'stroke' || c === 'fill'), 'with the board on it');
});

test('a zoom out shows the halo in its margins, and can go further before repainting', () => {
  const a = rig();
  a.app.camera.zoomBy(0.8, 640, 400);
  a.r.drawZoom();
  a.r.bctx.calls.length = 0;
  a.app.camera.zoomBy(0.9, 640, 400);
  a.r.drawZoom();
  assert.equal(a.blits(), 1, 'without a halo: the scaled picture alone, bare paper round it');

  const b = rig();
  paintHalo(b.r);
  b.app.camera.zoomBy(0.8, 640, 400);
  b.r.drawZoom();
  b.r.bctx.calls.length = 0;
  b.app.camera.zoomBy(0.9, 640, 400);
  b.r.drawZoom();
  assert.equal(b.blits(), 2, 'with one: the halo under the scaled picture');

  // to 0.36 of the size: past the stretch a scaled picture may take alone, inside the halo's three views
  b.r.bctx.calls.length = 0;
  b.app.camera.zoomBy(0.5, 640, 400);
  b.r.drawZoom();
  assert.equal(b.r.lastDrawn, 0, 'still the scaled picture, not a repaint mid-zoom');
});

test('the halo is not shown once the board has changed under it, only added to', () => {
  const { app, r, scene, blits } = rig();
  paintHalo(r);
  scene.add(D.make.stroke({ pts: inked([0, 0, 30, 30]), size: 3 }));
  assert.equal(r.haloFresh(), true, 'a stroke added: still true of what was there');
  scene.begin('erase'); scene.remove(scene.items[0]); scene.commit();
  assert.equal(r.haloFresh(), false, 'something taken away: no longer a picture of the board');
  r.drawScene();
  app.camera.zoomBy(0.8, 640, 400);
  r.drawZoom();
  r.bctx.calls.length = 0;
  app.camera.zoomBy(0.9, 640, 400);
  r.drawZoom();
  assert.equal(blits(), 1, 'so it is left out');
});

test('a halo that no longer suits the view is started again round it', () => {
  const { app, r } = rig();
  const h = paintHalo(r);
  assert.equal(r.haloSuits(h), true);
  app.camera.panBy(-r.w * 1.2, 0);
  assert.equal(r.haloSuits(h), false, 'the view has wandered to its edge');
  const again = paintHalo(r);
  assert.ok(again.x > h.x, 'centred on the view again');
  app.camera.zoomBy(0.3, 640, 400);
  assert.equal(r.haloSuits(again), false, 'or zoomed well away from it');
});

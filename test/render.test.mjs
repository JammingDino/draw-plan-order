/* Painting. The stub context cannot say what a frame looked like, so these
   tests assert on what the painter asks the rasteriser to do: how much
   geometry it submits, how many draw calls it takes, and which branch it
   took. That is the part that decides whether a dense board stays
   responsive. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js');
const U = D.util;

function rig(scene, zoom, grid = 'none') {
  const app = { scene, camera: new D.Camera(), requestDraw() {}, opts: {} };
  app.camera.zoom = zoom;
  const r = new D.Renderer(app);
  r.grid = grid;
  const reset = () => { r.bctx.ops = 0; r.bctx.calls.length = 0; };
  return { app, r, reset, ctx: r.bctx };
}

/** a page of dense handwriting, the case that used to go sticky */
function handwriting(lines = 20, perLine = 20) {
  const s = new D.Scene();
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let l = 0; l < lines; l++) {
    for (let c = 0; c < perLine; c++) {
      const x = 40 + c * 30, y = 60 + l * 42;
      const pts = [];
      const n = 12 + Math.floor(rand() * 20);
      for (let k = 0; k < n; k++) pts.push(x + rand() * 22, y + rand() * 26, 0.3 + rand() * 0.7);
      s.add(D.make.stroke({ pts, size: 2.5, thinning: 0.55, taper: 6 }));
    }
  }
  return s;
}

/* ── level of detail ─────────────────────────────────────────────── */

test('zoomed out, a dense board costs a fraction of the geometry', () => {
  const scene = handwriting();
  const far = rig(scene, 0.1);
  far.r.drawScene(); far.reset(); far.r.drawScene();

  const near = rig(scene, 1);
  near.r.drawScene(); near.reset(); near.r.drawScene();

  assert.ok(far.ctx.ops * 5 < near.ctx.ops,
    `zoomed out should be far cheaper: ${far.ctx.ops} vs ${near.ctx.ops} ops`);
});

test('zoomed out, the whole board collapses into a handful of draw calls', () => {
  const scene = handwriting();
  const { r, reset, ctx } = rig(scene, 0.1);
  r.drawScene(); reset(); r.drawScene();
  const draws = ctx.calls.filter(c => c === 'fill' || c === 'stroke').length;
  assert.ok(draws <= 4, `${scene.items.length} strokes in ${draws} draw calls`);
  assert.equal(r.lastSimplified, scene.items.length, 'all of them took the cheap path');
});

test('at reading size nothing is simplified', () => {
  const scene = handwriting(4, 4);
  const { r } = rig(scene, 1);
  r.drawScene();
  assert.equal(r.lastSimplified, 0, 'a 2.5px nib at 100% keeps its outline');
});

test('the threshold is the nib on screen, not the zoom', () => {
  const fine = new D.Scene();
  fine.add(D.make.stroke({ pts: [0, 0, 0.5, 10, 10, 0.5, 20, 0, 0.5], size: 1 }));
  const fat = new D.Scene();
  fat.add(D.make.stroke({ pts: [0, 0, 0.5, 10, 10, 0.5, 20, 0, 0.5], size: 40 }));

  const a = rig(fine, 1); a.r.drawScene();
  assert.equal(a.r.lastSimplified, 1, 'a 1px nib at 100% has no detail to show');

  const b = rig(fat, 0.1); b.r.drawScene();
  assert.equal(b.r.lastSimplified, 0, 'a 40px nib at 10% is still 4px of ink');
});

test('a highlighter keeps its outline however small it gets', () => {
  const s = new D.Scene();
  s.add(D.make.stroke({
    pts: [0, 0, 0.5, 40, 10, 0.5, 80, 0, 0.5],
    size: 2, thinning: 0, alpha: 1, blend: 'multiply'
  }));
  const { r } = rig(s, 0.05);
  r.drawScene();
  /* stroking a centreline would darken everywhere the stroke crosses
     itself, which is exactly what the single filled outline prevents */
  assert.equal(r.lastSimplified, 0);
});

test('a translucent stroke keeps its outline too', () => {
  const s = new D.Scene();
  s.add(D.make.stroke({ pts: [0, 0, 0.5, 40, 10, 0.5], size: 2, alpha: 0.4 }));
  const { r } = rig(s, 0.05);
  r.drawScene();
  assert.equal(r.lastSimplified, 0);
});

test('batches break where the colour changes, keeping paint order', () => {
  const s = new D.Scene();
  const line = (x, color) => s.add(D.make.stroke({
    pts: [x, 0, 0.5, x + 10, 10, 0.5, x + 20, 0, 0.5], size: 1, color
  }));
  line(0, '#111'); line(30, '#111');      // one batch
  line(60, '#c00');                        // second
  line(90, '#111'); line(120, '#111');     // third — not folded back into the first
  const { r } = rig(s, 0.5);
  r.drawScene();
  assert.equal(r.lastSimplified, 5);
  assert.equal(r.lastBatches, 3, 'a run of one colour at a time, in order');
});

test('simplified strokes stay where they were drawn', () => {
  const s = new D.Scene();
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push(i * 10, Math.sin(i / 4) * 60, 0.5);
  const st = s.add(D.make.stroke({ pts, size: 1 }));
  const { r } = rig(s, 0.5);
  r.drawScene();

  const xy = U.simplify(st.pts, 0.35 / 0.5, 3);
  assert.ok(xy.length >= 4, 'kept enough points to still be a curve');
  // every original point is still within tolerance of the simplified line
  for (let i = 0; i < st.pts.length; i += 3) {
    assert.ok(U.pointNearPolyline(st.pts[i], st.pts[i + 1], xy, 0.35 / 0.5 + 1e-6),
      `point ${i / 3} drifted off the simplified path`);
  }
});

test('a tap still paints something once simplified', () => {
  const s = new D.Scene();
  s.add(D.make.stroke({ pts: [5, 5, 0.9], size: 1 }));
  const { r, reset, ctx } = rig(s, 0.2);
  reset(); r.drawScene();
  assert.equal(r.lastSimplified, 1);
  assert.ok(ctx.ops >= 2, 'a zero-length subpath, which a round cap paints as a dot');
});

test('the simplified path is cached, and rebuilt when the stroke changes', () => {
  const s = new D.Scene();
  const st = s.add(D.make.stroke({ pts: [0, 0, 0.5, 20, 20, 0.5, 40, 0, 0.5], size: 1 }));
  const { r } = rig(s, 0.5);
  r.drawScene();
  const first = st._lod.path;
  r.drawScene();
  assert.equal(st._lod.path, first, 'same path reused across frames');

  s.begin('move'); s.translate(st, 100, 0); s.commit();
  r.drawScene();
  assert.notEqual(st._lod.path, first, 'moving the stroke rebuilds it');
});

test('small zoom changes reuse the cache; large ones rebuild', () => {
  const s = new D.Scene();
  const st = s.add(D.make.stroke({ pts: [0, 0, 0.5, 20, 20, 0.5, 40, 0, 0.5], size: 1 }));
  const { app, r } = rig(s, 0.5);
  r.drawScene();
  const first = st._lod.path;

  app.camera.zoom = 0.52;                 // a nudge, same third-octave bucket
  r.drawScene();
  assert.equal(st._lod.path, first, 'a pinch does not rebuild every frame');

  app.camera.zoom = 0.2;                  // a real change
  r.drawScene();
  assert.notEqual(st._lod.path, first, 'a big zoom change re-simplifies');
});

/* ── the paper ───────────────────────────────────────────────────── */

test('ruled paper draws horizontals only; squared paper draws both', () => {
  const s = new D.Scene();

  const lined = rig(s, 1, 'lined');
  lined.reset(); lined.r.drawScene();
  const ruledOps = lined.ctx.ops;

  const grid = rig(s, 1, 'lines');
  grid.reset(); grid.r.drawScene();
  const gridOps = grid.ctx.ops;

  assert.ok(ruledOps > 0, 'ruled paper draws something');
  assert.ok(gridOps > ruledOps,
    `squared paper adds the verticals: ${gridOps} vs ruled ${ruledOps}`);
});

test('ruled lines span the full width of the viewport', () => {
  const s = new D.Scene();
  const { r, ctx } = rig(s, 1, 'lined');
  const seen = [];
  ctx.moveTo = (x, y) => { seen.push(['m', x, y]); };
  ctx.lineTo = (x, y) => { seen.push(['l', x, y]); };
  r.drawScene();
  assert.ok(seen.length >= 4, 'some lines were drawn');
  for (let i = 0; i < seen.length; i += 2) {
    const [, mx, my] = seen[i], [, lx, ly] = seen[i + 1];
    assert.equal(my, ly, 'each ruled line is horizontal');
    assert.equal(mx, 0, 'starting at the left edge');
    assert.equal(lx, r.w, 'and running to the right edge');
  }
});

test('plain paper draws no rules at all', () => {
  const s = new D.Scene();
  const { r, reset, ctx } = rig(s, 1, 'none');
  reset(); r.drawScene();
  assert.equal(ctx.ops, 0);
});

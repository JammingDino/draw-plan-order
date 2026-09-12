/* The ink layer: smoothing, decimation, outline building, and turning a
   rough gesture into clean geometry. All pure maths, so it is the part of
   the app that is cheapest to pin down and easiest to break by accident. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { core, inked } from './harness.mjs';

const D = core();
const FH = D.freehand, RG = D.recognize, U = D.util;

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/* the incremental smoother is what the pen actually runs; the full pass is
   what it has to agree with, to the last bit */
test('smoothStep matches a full smooth at every length', () => {
  const rand = rng(4242);
  for (let trial = 0; trial < 40; trial++) {
    const raw = [];
    let sm = null;
    for (let k = 0; k < 250; k++) {
      raw.push(rand() * 500, rand() * 500, rand());
      let pts;
      if (raw.length <= 6) { sm = null; pts = raw.slice(); }
      else if (!sm || sm.length + 3 !== raw.length) pts = sm = FH.smooth(raw);
      else pts = FH.smoothStep(raw, sm);
      const want = FH.smooth(raw);
      assert.equal(pts.length, want.length, `trial ${trial} at ${k}`);
      for (let i = 0; i < want.length; i++) {
        assert.ok(Math.abs(pts[i] - want[i]) < 1e-9, `trial ${trial} sample ${k} index ${i}`);
      }
    }
  }
});

test('smoothing leaves very short strokes alone', () => {
  const raw = [1, 2, 0.5, 3, 4, 0.6];
  assert.deepEqual(Array.from(FH.smooth(raw)), raw);
});

test('smoothing pulls jitter in without moving the start', () => {
  const zig = [];
  for (let i = 0; i < 40; i++) zig.push(i * 10, i % 2 ? 8 : -8, 0.5);
  const sm = FH.smooth(zig);
  assert.equal(sm[0], zig[0], 'first point is untouched');
  assert.equal(sm[1], zig[1]);
  let rawSpread = 0, smSpread = 0;
  for (let i = 30; i < zig.length; i += 3) {
    rawSpread = Math.max(rawSpread, Math.abs(zig[i + 1]));
    smSpread = Math.max(smSpread, Math.abs(sm[i + 1]));
  }
  assert.ok(smSpread < rawSpread * 0.7, `jitter ${rawSpread} -> ${smSpread}`);
});

test('decimation keeps both ends and thins the middle', () => {
  const pts = [];
  for (let i = 0; i < 300; i++) pts.push(i * 0.05, 0, 0.5);   // far finer than any nib
  const out = FH.decimate(pts, 2);
  assert.equal(out[0], pts[0], 'first point kept');
  assert.equal(out[out.length - 3], pts[pts.length - 3], 'last point kept');
  assert.ok(out.length < pts.length / 4, `thinned ${pts.length} -> ${out.length}`);
});

test('decimation never loses the nib position on a short stroke', () => {
  const pts = [0, 0, 0.5, 1, 1, 0.5, 2, 2, 0.5];
  assert.deepEqual(Array.from(FH.decimate(pts, 100)), pts);
});

test('a single tap still leaves a mark', () => {
  const shapes = FH.shapes([10, 10, 0.8], { size: 6, thinning: 0.5 });
  assert.equal(shapes.length, 1, 'one disc');
  assert.ok(shapes[0].length >= 14, 'with enough points to look round');
});

test('an empty stroke produces no geometry', () => {
  assert.deepEqual(Array.from(FH.shapes([], { size: 4 })), []);
});

test('a stroke outline covers the path it was drawn along', () => {
  const pts = inked([0, 0, 50, 0, 100, 0]);
  const shapes = FH.shapes(pts, { size: 10, thinning: 0 });
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const poly of shapes) {
    for (let i = 0; i < poly.length; i += 2) {
      x1 = Math.min(x1, poly[i]); x2 = Math.max(x2, poly[i]);
      y1 = Math.min(y1, poly[i + 1]); y2 = Math.max(y2, poly[i + 1]);
    }
  }
  assert.ok(x1 <= 0 && x2 >= 100, `spans the stroke: ${x1}..${x2}`);
  assert.ok(y1 <= -4 && y2 >= 4, `about one nib thick: ${y1}..${y2}`);
});

test('pressure makes a thinning stroke thicker where it is pressed', () => {
  const light = FH.shapes([0, 0, 0.05, 40, 0, 0.05], { size: 20, thinning: 0.9 });
  const heavy = FH.shapes([0, 0, 1, 40, 0, 1], { size: 20, thinning: 0.9 });
  const span = polys => {
    let lo = Infinity, hi = -Infinity;
    for (const p of polys) for (let i = 1; i < p.length; i += 2) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
    return hi - lo;
  };
  assert.ok(span(heavy) > span(light) * 1.5, `${span(light)} vs ${span(heavy)}`);
});

test('a highlighter with no thinning keeps a constant width', () => {
  const shapes = FH.shapes([0, 0, 0.1, 30, 0, 1], { size: 20, thinning: 0 });
  let lo = Infinity, hi = -Infinity;
  for (const p of shapes) for (let i = 1; i < p.length; i += 2) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
  assert.ok(Math.abs((hi - lo) - 20) < 0.5, `width ${hi - lo} regardless of pressure`);
});

test('svgPath and Path2D describe the same polygons', () => {
  const shapes = FH.shapes(inked([0, 0, 30, 20, 60, 0]), { size: 6 });
  const d = FH.svgPath(shapes);
  assert.equal((d.match(/M/g) || []).length, shapes.filter(p => p.length >= 6).length);
  assert.equal((d.match(/Z/g) || []).length, shapes.filter(p => p.length >= 6).length);
});

/* recognition */

const closed = xy => xy.concat([xy[0], xy[1]]);

test('a rough straight line is recognised as a line', () => {
  const rand = rng(11);
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push(i * 10, (rand() - 0.5) * 3, 0.5);
  const r = RG.recognise(pts, {});
  assert.ok(r, 'something was recognised');
  assert.ok(r.kind === 'line' || r.kind === 'arrow', `got ${r.kind}`);
});

test('a rough box is recognised as a rectangle', () => {
  const rand = rng(12);
  const corners = [0, 0, 200, 0, 200, 140, 0, 140];
  const pts = [];
  const ring = closed(corners);
  for (let i = 0; i < ring.length - 2; i += 2) {
    for (let t = 0; t < 12; t++) {
      const f = t / 12;
      pts.push(
        U.lerp(ring[i], ring[i + 2], f) + (rand() - 0.5) * 4,
        U.lerp(ring[i + 1], ring[i + 3], f) + (rand() - 0.5) * 4,
        0.5);
    }
  }
  pts.push(ring[0], ring[1], 0.5);
  const r = RG.recognise(pts, {});
  assert.ok(r, 'something was recognised');
  assert.equal(r.kind, 'rect');
  assert.ok(Math.abs(r.box.w - 200) < 20 && Math.abs(r.box.h - 140) < 20, 'roughly the right size');
});

test('a rough circle is recognised as an ellipse', () => {
  const rand = rng(13);
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2;
    const r = 100 + (rand() - 0.5) * 5;
    pts.push(300 + Math.cos(a) * r, 300 + Math.sin(a) * r, 0.5);
  }
  const r = RG.recognise(pts, {});
  assert.ok(r, 'something was recognised');
  assert.equal(r.kind, 'ellipse');
});

test('deliberate scribble reads as a scribble, a plain line does not', () => {
  const scrub = [];
  for (let i = 0; i < 60; i++) scrub.push(i * 4, (i % 2 ? 30 : -30), 0.5);
  assert.ok(RG.scribble(scrub).is, 'back and forth is a scribble');

  const line = [];
  for (let i = 0; i < 60; i++) line.push(i * 4, 0, 0.5);
  assert.ok(!RG.scribble(line).is, 'a straight line is not');
});

test('xy strips pressure and keeps order', () => {
  assert.deepEqual(Array.from(RG.xy([1, 2, 0.5, 3, 4, 0.9])), [1, 2, 3, 4]);
});

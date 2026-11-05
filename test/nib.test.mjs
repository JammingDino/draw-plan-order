/* The chisel nib: a flat edge at one angle, so a stroke is broad drawn
   across the edge and thin drawn along it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js');
const FH = D.freehand;
const line = (x0, y0, x1, y1, n = 20) => { const p = []; for (let i = 0; i <= n; i++) p.push(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 1); return p; };
function extent(polys) {
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const p of polys) for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  return { w: x1 - x0, h: y1 - y0 };
}
const area = p => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a; };

test('across the edge it is broad; along it, thin', () => {
  const o = { size: 20, thinning: 0, nib: 'chisel', cap: true };
  const across = extent(FH.shapes(line(0, 0, 200, 0), { ...o, nibAngle: 90 }));
  const along = extent(FH.shapes(line(0, 0, 200, 0), { ...o, nibAngle: 0 }));
  assert.ok(Math.abs(across.h - 20) < 0.5, `an upright edge drawn sideways is the full nib tall: ${across.h}`);
  assert.ok(along.h < 4, `a level edge drawn sideways is a hairline: ${along.h}`);
});

test('every piece is wound as the round nib\'s are, so one fill unions them', () => {
  const round = FH.shapes(line(0, 0, 100, 40), { size: 10, thinning: 0 });
  const sign = Math.sign(area(round[0]));
  const polys = FH.shapes(line(0, 0, 100, 40).concat(line(100, 40, 0, 80).slice(3)), { size: 10, thinning: 0, nib: 'chisel', nibAngle: 40 });
  assert.ok(polys.every(p => Math.sign(area(p)) === sign || Math.abs(area(p)) < 1e-6));
});

test('a stroke keeps its nib in what it asks for', () => {
  const o = FH.optsOf({ size: 3, thinning: 0.5, nib: 'chisel', nibAngle: 30 });
  assert.equal(o.nib, 'chisel'); assert.equal(o.nibAngle, 30);
  assert.equal(FH.optsOf({ size: 3 }).nib, undefined, 'a round one says nothing');
});

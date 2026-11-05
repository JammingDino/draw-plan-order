/* Regular polygons: kind 'polygon', `sides` corners on the ellipse in
   its box, the first straight up. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('a hexagon in a square box is regular, with a corner straight up', () => {
  const it = D.make.shape({ kind: 'polygon', sides: 6, x: 0, y: 0, w: 100, h: 100 });
  const v = D.polygonPoints(it);
  assert.equal(v.length, 14, 'six corners, closed');
  assert.ok(near(v[0], 50) && near(v[1], 0), 'the first at the top');
  const sides = [];
  for (let i = 0; i + 3 < v.length; i += 2) sides.push(Math.hypot(v[i + 2] - v[i], v[i + 3] - v[i + 1]));
  assert.ok(sides.every(s => near(s, sides[0])), 'every side the same length');
});

test('it is hit, snapped to and exported by its corners', async () => {
  const scene = new D.Scene();
  const it = D.make.shape({ kind: 'polygon', sides: 5, x: 0, y: 0, w: 100, h: 100, size: 2, fill: '#eef1ff' });
  scene.add(it);
  assert.ok(scene.hitItem(it, 50, 50, 1));
  assert.ok(!scene.hitItem(it, 2, 2, 1), 'the box\'s corner is outside it');
  const snaps = scene.snapPoints(it);
  assert.equal(snaps.filter(p => p.t === 'end').length, 5);
  assert.ok(snaps.some(p => p.k === 'c'));
  const r = new D.Renderer({ scene, camera: new D.Camera(), requestDraw() {}, opts: {} });
  const svg = await r.toSVG(scene, scene.contentBounds(), { theme: 'light', dark: false, transparent: true });
  assert.equal((svg.match(/<path d="M[^"]*"/)[0].match(/L/g) || []).length, 5, 'five corners in the export');
});

test('sides are kept between 3 and 12', () => {
  assert.equal(D.polygonPoints({ x: 0, y: 0, w: 10, h: 10, sides: 40 }).length, 26);
  assert.equal(D.polygonPoints({ x: 0, y: 0, w: 10, h: 10, sides: 1 }).length, 8);
});

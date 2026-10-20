/* Smart guides (js/guides.js): a dragged box lines up with the edges,
   middles and spacing of what is round it, and says what with. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'guides.js');
const U = D.util, G = D.guides;
const box = (x, y, w, h) => U.box(x, y, x + w, y + h);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('a third page beside two snaps to the same gap, and the gaps are marked', () => {
  const A = box(0, 0, 100, 140), B = box(150, 0, 100, 140);
  const M = box(1000, 0, 100, 140);
  // dragged to 304: 4 past the gap of 50 the first two keep
  const s = G.snap(M, [A, B], 304 - 1000, 0, 6);
  near(1000 + s.dx, 300, 'its left edge lands a gap of 50 from the second page');
  const gaps = s.gaps.filter(g => g.axis === 'x');
  assert.equal(gaps.length, 2, 'both equal gaps marked');
  for (const g of gaps) near(g.g, 50, 'each 50 across');
  assert.ok(s.lines.some(l => l.axis === 'y' && Math.abs(l.v) < 1e-6), 'and its top lines up with theirs');
});

test('between two, it snaps to the middle, with the gap even either side', () => {
  const A = box(0, 0, 100, 100), C = box(300, 0, 100, 100), M = box(0, 400, 100, 100);
  const s = G.snap(M, [A, C], 147, -400, 6);
  near(s.dx, 150, 'centred in the space');
  assert.equal(s.gaps.filter(g => g.axis === 'x').length, 2);
});

test('edges and middles line up, within the tolerance and not beyond it', () => {
  const T = box(0, 0, 200, 100), M = box(500, 300, 80, 40);
  // dropped with its top 1 below the other's
  let s = G.snap(M, [T], 0, -299, 6);
  near(M.y + s.dy, 0, 'its top on the other\'s top');
  assert.ok(s.lines.some(l => l.axis === 'y' && Math.abs(l.v) < 1e-6), 'with a line along it');
  s = G.snap(M, [T], 0, -300 + 20, 6);
  near(s.dy, -280, 'twenty off: left where it was dropped');
  // middle to middle across: the boxes' centres at x = 100
  s = G.snap(M, [T], -440 - 3, 0, 6);
  near(M.x + s.dx + M.w / 2, 100, 'centred under it');
});

test('a drag held to one axis snaps only along it', () => {
  const T = box(0, 0, 100, 100), M = box(300, 3, 100, 100);
  const s = G.snap(M, [T], -4, 0, 6, 'x');
  near(s.dy, 0, 'the locked axis does not move');
});

test('one edge being resized snaps to edges and middles', () => {
  const T = box(0, 0, 200, 100);
  near(G.edge(203, 'x', [T], 6), 200, 'onto the right edge');
  near(G.edge(97, 'x', [T], 6), 100, 'onto the middle');
  near(G.edge(150, 'x', [T], 6), 150, 'nothing near: as it was');
});

test('what lines up with: pages and shapes and groups, not loose handwriting or connectors, nor what is moving', () => {
  const scene = new D.Scene();
  const mk = (o) => { const it = Object.assign({ id: U.uid() }, o); scene.add(it); return it; };
  const page = mk({ type: 'shape', kind: 'rect', x: 0, y: 0, w: 100, h: 100, size: 2, color: 'ink' });
  mk({ type: 'stroke', pts: [10, 10, 0.5, 40, 40, 0.5], size: 2, color: 'ink' });
  const g = U.uid();
  mk({ type: 'stroke', pts: [200, 0, 0.5, 260, 0, 0.5], size: 2, color: 'ink', group: g });
  mk({ type: 'stroke', pts: [200, 50, 0.5, 260, 50, 0.5], size: 2, color: 'ink', group: g });
  const moving = mk({ type: 'shape', kind: 'rect', x: 0, y: 300, w: 50, h: 50, size: 2, color: 'ink' });
  const cam = new D.Camera();
  const app = { scene, camera: cam };
  const t = G.targets(app, [moving]);
  assert.equal(t.length, 2, 'the shape, and the group as one');
  const gb = t.find(b => b.x > 150);
  assert.ok(gb && gb.y2 > 45, 'the group\'s box takes in both its strokes');
  assert.ok(!t.some(b => b.y > 250), 'not the thing being moved');
  assert.ok(t.some(b => b.x <= page.x), 'the shape is there');
});

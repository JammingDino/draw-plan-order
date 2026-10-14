/* Graphs (js/graph.js): sampling through the maths engine, the y range
   that ignores asymptote spikes, breaks at asymptotes, nice ticks, and
   the picture's primitives. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { load } from './harness.mjs';

const LIB = readFileSync(new URL('../vendor/mathjs/math.min.js', import.meta.url), 'utf8');
const HOST = ['Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'Map', 'Set', 'RegExp', 'JSON', 'Math', 'Date'];
const mathjs = g => { for (const k of HOST) delete g[k]; vm.runInContext(LIB, g, { filename: 'math.min.js' }); };
const D = load('util.js', mathjs, 'freehand.js', 'recognize.js', 'scene.js', 'render.js', 'math.js', 'graph.js');
await D.math.ready();
const G = D.graph;

const graph = o => G.make({ x: 0, y: 0 }, o);

test('sin(x) over −10…10: a curve between −1 and 1, in radians unless asked', () => {
  const p = G.sample(graph({ fns: ['sin(x)'] }));
  const ys = [];
  for (let i = 1; i < p.curves[0].length; i += 2) ys.push(p.curves[0][i]);
  assert.ok(Math.max(...ys) > 0.99 && Math.min(...ys) < -0.99);
  assert.ok(p.y0 < -1 && p.y0 > -1.3 && p.y1 > 1 && p.y1 < 1.3, `y range ${p.y0}…${p.y1}`);
  const deg = G.sample(graph({ fns: ['sin(x)'], angle: 'deg', x0: 0, x1: 90 }));
  assert.ok(Math.abs(deg.curves[0][deg.curves[0].length - 1] - 1) < 1e-9, 'sin 90° = 1');
});

test('the friendly notation, implicit products, constants and a leading "y ="', () => {
  const p = G.sample(graph({ fns: ['y = 3x² − 2', 'π·x', 'g'] , x0: 0, x1: 2 }));
  const last = c => p.curves[c][p.curves[c].length - 1];
  assert.ok(Math.abs(last(0) - 10) < 1e-9, '3·2² − 2');
  assert.ok(Math.abs(last(1) - 2 * Math.PI) < 1e-9);
  assert.ok(Math.abs(last(2) - 9.80665) < 1e-3, 'g is gravity');
  assert.deepEqual([...p.errors], [null, null, null]);
});

test('tan(x): the range follows the curve, not its spikes, and the line breaks at each asymptote', () => {
  const it = graph({ fns: ['tan(x)'], x0: -5, x1: 5 });
  const p = G.sample(it);
  assert.ok(p.y1 < 100 && p.y0 > -100, `not stretched by the spikes: ${p.y0}…${p.y1}`);
  const P = G.parts(it, p);
  assert.ok(P.curves[0].segs.length >= 3, `broken at the asymptotes: ${P.curves[0].segs.length} pieces`);
});

test('nonsense is reported beside its formula, and the rest still plots', () => {
  const it = graph({ fns: ['sin(', 'sqrt(x)'], x0: -4, x1: -1 });
  const p = G.sample(it);
  assert.ok(p.errors[0], 'a broken formula');
  assert.match(p.errors[1], /No real values/);
  const P = G.parts(it, p);
  assert.equal(P.legend.length, 2);
  assert.ok(P.legend.every(l => l.error));
});

test('ticks land on 1, 2 and 5 steps', () => {
  assert.deepEqual([...G.ticks(-10, 10, 4).list], [-10, -5, 0, 5, 10]);
  assert.equal(G.ticks(0, 1, 5).step, 0.2);
  assert.equal(G.ticks(0, 3000, 3).step, 1000);
});

test('a graph is a box: boxed, turned, exported, and re-sampled when its formula changes', () => {
  const scene = new D.Scene();
  const it = scene.add(graph({ fns: ['x'] }));
  assert.deepEqual([scene.bbox(it).w, scene.bbox(it).h], [520, 340]);
  const first = G.sample(it);
  assert.equal(G.sample(it), first, 'cached');
  scene.touch(it); it.fns = ['x^2'];
  assert.notEqual(G.sample(it), first, 'drawn again after an edit');
  const svg = D.ext.items.graph.svg(it);
  assert.match(svg, /<path d="M[^"]+" stroke="#3b6cff"/);
  assert.match(svg, /y = x\^2/);
  scene.rotateItem(it, { x: 0, y: 0 }, Math.PI / 2);
  assert.ok(it.rot, 'turns as a box');
});

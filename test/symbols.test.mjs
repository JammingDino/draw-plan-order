/* Circuit and mechanics symbols (js/symbols.js): terminals are snap
   points, a wire attached to one follows the part as it moves and turns,
   a label stays upright, and every symbol draws and exports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'render.js', 'symbols.js');
const S = D.symbols;
const app = { opts: { symbol: { kind: 'resistor', color: 'ink', size: 2, scale: 1, names: false } }, scene: new D.Scene() };
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('a resistor\'s terminals are where its leads end, and are what lines snap to', () => {
  const scene = new D.Scene();
  const r = scene.add(S.make(app, 'resistor', { x: 100, y: 100 }));
  const pins = scene.snapPoints(r);
  const a = pins.find(p => p.k === 'a'), b = pins.find(p => p.k === 'b');
  assert.ok(near(a.x, 60) && near(a.y, 100), `a at ${a.x}, ${a.y}`);
  assert.ok(near(b.x, 140) && near(b.y, 100));
  assert.equal(a.t, 'end');
});

test('a wire drawn to a terminal follows the part when it moves, and when it is turned', () => {
  const scene = new D.Scene();
  const r = scene.add(S.make(app, 'resistor', { x: 100, y: 100 }));
  const wire = scene.add(D.make.shape({ kind: 'line', x: 0, y: 0, w: 60, h: 100, bind2: { id: r.id, k: 'a' } }));
  let [, end] = scene.lineEnds(wire);
  assert.ok(near(end.x, 60) && near(end.y, 100), 'on terminal a');
  scene.translate(r, 0, 50);
  [, end] = scene.lineEnds(wire);
  assert.ok(near(end.y, 150), 'moved with it');
  scene.rotateItem(r, { x: 100, y: 150 }, Math.PI / 2);
  [, end] = scene.lineEnds(wire);
  assert.ok(near(end.x, 100) && near(end.y, 110), `stood up: terminal a now at the top (${end.x}, ${end.y})`);
});

test('changing a part for another keeps its middle; a two-terminal part keeps its span too', () => {
  const r = S.make(app, 'resistor', { x: 100, y: 100 });
  S.swap(r, 'capacitor');
  assert.equal(r.kind, 'capacitor');
  assert.ok(near(r.x + r.w / 2, 100) && near(r.y + r.h / 2, 100));
  assert.equal(r.w, 80, 'still spans its terminals');
  S.swap(r, 'ground');
  assert.equal(r.w, S.SYMBOLS.ground.W, 'one terminal: its own size');
});

test('every symbol draws, exports and has at least one terminal', () => {
  const scene = new D.Scene();
  const T = D.ext.items.symbol;
  for (const kind of S.ORDER) {
    const it = scene.add(S.make(app, kind, { x: 0, y: 0 }));
    it.label = 'X1';
    const ctx = { calls: [], save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, stroke() { this.calls.push('s'); }, fill() { this.calls.push('f'); }, fillText() { this.calls.push('t'); }, translate() {}, rotate() {} };
    T.draw(ctx, it, {});
    assert.ok(ctx.calls.length > 0, kind + ' drew');
    const svg = T.svg(it);
    assert.match(svg, /^<g>.*<\/g>$/s, kind + ' exported');
    assert.match(svg, /X1<\/text>/);
    assert.ok(Object.keys(S.SYMBOLS[kind].pins).length >= 1, kind + ' has a terminal');
    assert.match(S.icon(kind), /^<svg/);
  }
});

test('a turned symbol\'s label is turned back upright in the export', () => {
  const it = S.make(app, 'resistor', { x: 0, y: 0 });
  it.label = 'R1'; it.rot = Math.PI / 2;
  assert.match(D.ext.items.symbol.svg(it), /transform="rotate\(-90 /);
});

test('a part laid along a drag: its terminals land exactly on the ends, its body stays its size', () => {
  const scene = new D.Scene();
  const a = { x: 100, y: 100 }, b = { x: 100, y: 300 };
  const r = scene.add(S.spanning(app, 'resistor', a, b));
  const pins = scene.snapPoints(r);
  const pa = pins.find(p => p.k === 'a'), pb = pins.find(p => p.k === 'b');
  assert.ok(near(pa.x, 100) && near(pa.y, 100), `a on the start: ${pa.x}, ${pa.y}`);
  assert.ok(near(pb.x, 100) && near(pb.y, 300), `b on the end: ${pb.x}, ${pb.y}`);
  assert.ok(near(S.mapper(r).k, 1), 'the zigzag kept its size; the leads took the length');
  // too short a drag: the body's length, about the middle
  const s = S.spanning(app, 'resistor', { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(s.w >= 48);
});

test('parts are named as they are placed: R1, R2, then C1', () => {
  const sc = new D.Scene(), a2 = { opts: { symbol: { scale: 1, names: true } }, scene: sc };
  sc.add(S.make(a2, 'resistor', { x: 0, y: 0 }));
  sc.add(S.make(a2, 'resistor', { x: 0, y: 0 }));
  const c = S.make(a2, 'capacitor', { x: 0, y: 0 });
  assert.deepEqual([...sc.items.map(i => i.label)], ['R1', 'R2']);
  assert.equal(c.label, 'C1');
  assert.equal(S.make(a2, 'ground', { x: 0, y: 0 }).label, '', 'ground has no name');
});

test('an elbow wire between two terminals stays square as a part moves', () => {
  const scene = new D.Scene();
  const r1 = scene.add(S.make(app, 'resistor', { x: 100, y: 100 }));
  const r2 = scene.add(S.make(app, 'resistor', { x: 300, y: 250 }));
  const w = scene.add(D.make.shape({ kind: 'line', x: 0, y: 0, w: 1, h: 1, elbow: 'h', bind1: { id: r1.id, k: 'b' }, bind2: { id: r2.id, k: 'a' } }));
  const square = () => {
    const p = scene.linePath(w);
    for (let i = 0; i + 3 < p.length; i += 2) assert.ok(near(p[i], p[i + 2]) || near(p[i + 1], p[i + 3]), 'each stretch along or up');
    return p;
  };
  let p = square();
  assert.equal(p.length, 6, 'one corner');
  scene.translate(r2, 40, 60); w._b = null;
  p = square();
  assert.ok(near(p[4], 300 - 40 + 40) && near(p[5], 310), 'still on the moved terminal');
});

test('a named part turned along a drag still lands on its ends: the label does not move its middle', () => {
  const sc = new D.Scene(), a2 = { opts: { symbol: { scale: 1, names: true } }, scene: sc };
  const c = sc.add(S.spanning(a2, 'capacitor', { x: 560, y: 252.85 }, { x: 560, y: 520 }));
  assert.equal(c.label, 'C1');
  const pins = sc.snapPoints(c), pa = pins.find(p => p.k === 'a'), pb = pins.find(p => p.k === 'b');
  assert.ok(near(pa.x, 560) && near(pa.y, 252.85), `a at ${pa.x}, ${pa.y}`);
  assert.ok(near(pb.x, 560) && near(pb.y, 520), `b at ${pb.x}, ${pb.y}`);
});

/* Circuit and mechanics symbols (js/symbols.js): terminals are snap
   points, a wire attached to one follows the part as it moves and turns,
   a label stays upright, and every symbol draws and exports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'render.js', 'symbols.js');
const S = D.symbols;
const app = { opts: { symbol: { kind: 'resistor', color: 'ink', size: 2, scale: 1 } } };
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

test('swapping a part keeps its middle and its scale', () => {
  const r = S.make(app, 'resistor', { x: 100, y: 100 });
  S.swap(r, 'capacitor');
  assert.equal(r.kind, 'capacitor');
  assert.ok(near(r.x + r.w / 2, 100) && near(r.y + r.h / 2, 100));
  assert.equal(r.w, S.SYMBOLS.capacitor.W);
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

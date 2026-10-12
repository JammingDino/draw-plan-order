/* Calc blocks (js/calc.js): a worksheet item on the board. Its lines are
   worked out by D.math with variables flowing down; the answers are kept
   on the item so that painting never evaluates anything, and the board
   draws without math.js loaded at all. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { load, fakeApp } from './harness.mjs';

/* math.js in the realm, as test/math.test.mjs explains: the realm gets
   its own built-ins back first, or math.js's type checks fail. */
const LIB = readFileSync(new URL('../vendor/mathjs/math.min.js', import.meta.url), 'utf8');
const HOST = ['Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'Map', 'Set', 'RegExp', 'JSON', 'Math', 'Date',
  'Float32Array', 'Uint8Array', 'Uint8ClampedArray', 'Int32Array'];
const mathjs = g => { for (const k of HOST) delete g[k]; vm.runInContext(LIB, g, { filename: 'math.min.js' }); };

const FILES = ['util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js', 'math.js', 'calc.js'];
const plain = v => JSON.parse(JSON.stringify(v));

const D = load(...FILES.slice(0, 1), mathjs, ...FILES.slice(1));
await D.math.ready();
const C = D.calc;

const block = (text, o) => ({ id: D.util.uid(), type: 'calc', x: 100, y: 50, text, size: 16, res: [], sig: '', alpha: 1, ...o });

function app(over = {}) {
  const a = fakeApp(D, {
    opts: { calc: { angle: 'deg', format: 'auto', sig: 5, exact: false, size: 16 }, general: {}, text: { color: 'ink', size: 20, font: 'sans' } },
    selection: [], board: { id: 'b1' }, camera: new D.Camera(),
    select(items) { this.selection = items.filter(Boolean); },
    setTool(n) { this.toolName = n; }, afterEdit() { this.edits = (this.edits || 0) + 1; },
    requestDraw() {}, requestDrawLive() {}, markDirty() {}, toast() {}, focusCanvas() {},
    ...over
  });
  return a;
}

test('the feature registers its item, tool, button, press actions, settings and options', () => {
  assert.ok(D.ext.items.calc, 'the calc item type');
  const tool = D.ext.tools.find(t => t.name === 'calc');
  assert.equal(tool.rail.key, 'b', 'tool key B');
  assert.ok(D.ext.buttons.some(b => b.id === 'btn-calc' && b.where === 'top'));
  assert.deepEqual(plain(D.ext.pressActions.map(p => p.id).filter(id => id.startsWith('calc'))), ['calc-open', 'calc-block']);
  const menu = { source: 'menu', hit: null }, bar = { source: 'bar', hit: null };
  const here = D.ext.pressActions.find(p => p.id === 'calc-block');
  assert.equal(here.when(menu), true);
  assert.equal(here.when(bar), false, 'not on the selection bar: it is about a point');
  assert.ok(D.ext.settings.some(s => s.id === 'calc'));
  assert.deepEqual(plain(D.ext.opts.calc), { angle: 'deg', format: 'auto', sig: 5, exact: false, size: 16 });
});

test('a block works its lines out, variables flowing down', () => {
  const it = block('F = 2 kN\nL = 3 m\nM = F*L\n\n# a note\nM / 2\ny + 1');
  const out = C.recalc(it);
  assert.equal(out.length, 7);
  assert.deepEqual(plain(it.res), [
    { t: '2 kN' }, { t: '3 m' }, { t: '6 kN·m' }, null, null, { t: '3 kN·m' }, { e: 'y is not defined' }
  ]);
  assert.ok(it.sig, 'the settings it was worked out under are kept with it');
});

test('layout is cached, sized to the content, and bbox follows it', () => {
  const it = block('F = 2 kN\nM = F * 3 m');
  C.recalc(it);
  const L = C.layout(it);
  assert.equal(C.layout(it), L, 'cached in _lines');
  assert.equal(L.rows.length, 2);
  assert.equal(L.rows[1].out, '6 kN·m');
  const s = new D.Scene();
  s.add(it);
  const b = s.bbox(it);
  assert.deepEqual([b.x, b.y, b.w, b.h], [100, 50, L.w, L.h]);
  assert.ok(L.h >= 2 * 16 * 1.6, 'two lines tall at least');
  const wide = block('F = 2 kN\nM = F * 3 m * 1000000 * 1000000');
  C.recalc(wide);
  assert.ok(C.layout(wide).w > L.w, 'a longer line makes a wider block');
  // the core clears _lines when the block changes
  s.begin('edit'); s.touch(it); it.text += '\nM * 2'; s.commit();
  assert.equal(C.layout(it).rows.length, 3);
});

test('painting reads the kept answers and never evaluates', () => {
  const it = block('a = 2\nb = a * 3');
  C.recalc(it);
  const s = new D.Scene();
  s.add(it);
  const a = { scene: s, camera: new D.Camera(), requestDraw() {}, opts: {} };
  const r = new D.Renderer(a);
  r.grid = 'none';
  const evaluate = D.math.evaluate, evaluateLines = D.math.evaluateLines;
  let calls = 0;
  D.math.evaluate = (...x) => { calls++; return evaluate(...x); };
  D.math.evaluateLines = (...x) => { calls++; return evaluateLines(...x); };
  try {
    const ctx = r.bctx;
    ctx.calls.length = 0;
    r.drawScene();
    assert.ok(ctx.calls.includes('fillText'), 'the lines were drawn');
    assert.equal(calls, 0, 'nothing worked out while painting');
    // zoomed far out: a bar per line instead of text
    a.camera.zoom = 0.1;
    ctx.calls.length = 0;
    r.drawScene();
    assert.ok(!ctx.calls.includes('fillText'), 'no text below a readable size');
  } finally {
    D.math.evaluate = evaluate; D.math.evaluateLines = evaluateLines;
  }
});

test('a board of blocks draws with the engine not loaded', () => {
  const X = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js', 'math.js', 'calc.js');
  assert.equal(X.math.loaded, false);
  const it = { id: 'c1', type: 'calc', x: 0, y: 0, text: 'F = 2 kN\nF * 3 m', size: 16, res: [{ t: '2 kN' }, { t: '6 kN·m' }], sig: 'x', alpha: 1 };
  const s = new X.Scene();
  s.add(it);
  const r = new X.Renderer({ scene: s, camera: new X.Camera(), requestDraw() {}, opts: {} });
  r.grid = 'none';
  r.drawScene();
  assert.equal(X.math.loaded, false, 'painting did not need it');
  assert.ok(s.bbox(it).w > 0);
});

test('the SVG export carries the lines and the answers', async () => {
  const it = block('F = 2 kN\nF * 3 m');
  C.recalc(it);
  const s = new D.Scene();
  s.add(it);
  const r = new D.Renderer({ scene: s, camera: new D.Camera(), requestDraw() {}, opts: {} });
  const svg = await r.toSVG(s, s.contentBounds(), { theme: 'light', dark: false, transparent: true });
  assert.match(svg, />F = 2 kN<\/text>/);
  assert.match(svg, /text-anchor="end"[^>]*>6 kN·m<\/text>/);
});

test('a block survives save, copy and undo with its answers', () => {
  const it = block('x = 4\nx^2');
  C.recalc(it);
  const s = new D.Scene();
  s.add(it);
  const again = new D.Scene(JSON.parse(s.docText()));
  const back = again.get(it.id);
  assert.deepEqual(plain(back.res), [{ t: '4' }, { t: '16' }]);
  assert.ok(!back._lines, 'the layout cache is not saved');
  s.begin('move'); s.translate(it, 10, 0); s.commit();
  s.undo();
  assert.equal(s.get(it.id).x, 100);
});

test('resizing scales the text about the fixed corner', () => {
  const it = block('1 + 1');
  C.recalc(it);
  D.ext.items.calc.scale(it, { x: 100, y: 50 }, 2, 2);
  assert.equal(it.size, 32);
  assert.deepEqual([it.x, it.y], [100, 50]);
});

test('newBlock adds a worked-out block as one undo step', () => {
  const a = app();
  const it = C.newBlock(a, { x: 10, y: 20 }, 'F = 2 kN\nF * 2');
  assert.equal(a.scene.items.length, 1);
  assert.deepEqual(plain(it.res), [{ t: '2 kN' }, { t: '4 kN' }]);
  assert.equal(a.selection[0], it);
  a.scene.undo();
  assert.equal(a.scene.items.length, 0);
});

test('blocks made under other settings are worked out again', async () => {
  const a = app();
  const it = block('sin(30)');
  C.recalc(it);
  assert.deepEqual(plain(it.res), [{ t: '0.5' }]);
  a.scene.add(it);
  a.opts.calc.angle = 'rad';
  const settings = D.ext.settings.find(s => s.id === 'calc');
  assert.ok(settings);
  // what the settings page does when a choice changes: sync, then refresh the stale ones
  D.ext.emit('ready', a);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(it.res[0].t, '−0.98803', 'now in radians');
  a.opts.calc.angle = 'deg';
  D.ext.emit('ready', a);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(it.res[0].t, '0.5');
});

test('the calc tool, tapped on a block, does not stack a new one on it', () => {
  const a = app();
  const it = block('1 + 1');
  C.recalc(it);
  a.scene.add(it);
  const tool = D.ext.tools.find(t => t.name === 'calc').create(a);
  tool.down({ x: 110, y: 60 });
  tool.up({ x: 110, y: 60 });
  assert.equal(a.scene.items.length, 1, 'no second block');
  assert.equal(C.editing, it, 'the block tapped is the one being edited');
  assert.equal(a.toolName, 'select');
  D.ext.emit('board', a);                 // leaving the board closes the editor
  assert.equal(C.editing, null);
  assert.equal(a.scene.undoStack.length, 0, 'opening and closing without typing is no step');
});

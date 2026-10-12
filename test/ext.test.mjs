/* The extension registry (js/ext.js). Features add tools, item types and
   listeners without touching the core, so the core has to treat what
   they register exactly as it treats its own: an item type has to be
   boxed, indexed, hit, moved, resized, painted, exported, erased (or
   not) and carried through save, copy and undo like a built-in one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeApp, inked } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js');
const U = D.util;
/* the modules run in a vm context, whose objects have their own
   prototypes; compare them as plain data */
const plain = v => JSON.parse(JSON.stringify(v));

/* ── two item types, at either end of what a feature might register ── */

/* A tag: the least a type can say — a box and a way to paint it. Every
   other handler is left to the defaults. */
const drawn = [];
D.ext.items.tag = {
  bbox: it => ({ x: it.x, y: it.y, w: it.w, h: it.h }),
  draw: (ctx, it, r) => drawn.push({ id: it.id, alpha: ctx.globalAlpha, r })
};

/* A wire: a thin thing between two points, with a handler for everything. */
const near = (it, x, y, tol) => U.distToSegment2(x, y, it.a.x, it.a.y, it.b.x, it.b.y) < tol * tol;
const edits = [];
D.ext.items.wire = {
  label: 'Wire',
  bbox: it => {
    const b = U.box(it.a.x, it.a.y, it.b.x, it.b.y);
    return { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 };
  },
  draw: (ctx, it) => drawn.push({ id: it.id }),
  hit: (it, x, y, tol) => near(it, x, y, tol + 2),
  outline: it => [it.a.x, it.a.y, it.b.x, it.b.y],
  translate: (it, dx, dy) => { it.a.x += dx; it.a.y += dy; it.b.x += dx; it.b.y += dy; },
  scale: (it, o, sx, sy) => {
    for (const p of [it.a, it.b]) { p.x = o.x + (p.x - o.x) * sx; p.y = o.y + (p.y - o.y) * sy; }
  },
  solid: false,
  erasable: true,
  svg: it => `<line x1="${it.a.x}" y1="${it.a.y}" x2="${it.b.x}" y2="${it.b.y}"/>`,
  edit: (app, it) => edits.push(it.id)
};

const tag = o => ({ id: U.uid(), type: 'tag', x: 100, y: 100, w: 80, h: 40, alpha: 1, ...o });
const wire = o => ({ id: U.uid(), type: 'wire', a: { x: 0, y: 0 }, b: { x: 200, y: 200 }, size: 2, alpha: 1, ...o });

/** a board with some ink on it, so the spatial index has work to do */
function board(...items) {
  const s = new D.Scene();
  for (let i = 0; i < 50; i++) s.add(D.make.stroke({ pts: inked([1000 + i * 20, 1000, 1010 + i * 20, 1040]) }));
  for (const it of items) s.add(it);
  return s;
}

/* ── events ─────────────────────────────────────────────────────── */

test('emit runs handlers in order, stops at the first that returns true, and says so', () => {
  const seen = [];
  const a = (x) => { seen.push('a' + x); };
  const b = (x) => { seen.push('b' + x); return x === 2; };
  const c = (x) => { seen.push('c' + x); };
  D.ext.on('t1', a); D.ext.on('t1', b); D.ext.on('t1', c);
  assert.equal(D.ext.emit('t1', 1), false);
  assert.equal(D.ext.emit('t1', 2), true, 'consumed');
  assert.deepEqual(seen, ['a1', 'b1', 'c1', 'a2', 'b2'], 'nothing after the handler that took it');
  assert.equal(D.ext.emit('nobody-listens', 1), false);
});

test('off removes a handler, has() says whether anyone listens, and a throwing handler is skipped', () => {
  const seen = [];
  const bad = () => { throw new Error('a broken feature'); };
  const good = () => { seen.push('good'); };
  D.ext.on('t2', bad); D.ext.on('t2', good);
  const err = console.error; console.error = () => seen.push('logged');
  try { assert.equal(D.ext.emit('t2'), false); } finally { console.error = err; }
  assert.deepEqual(seen, ['logged', 'good'], 'the next handler still ran');
  D.ext.off('t2', bad); D.ext.off('t2', good);
  assert.equal(D.ext.has('t2'), false);
  assert.equal(D.ext.emit('t2'), false);
  // a handler that takes itself off part-way round does not upset the round
  const order = [];
  const once = () => { order.push('once'); D.ext.off('t3', once); };
  D.ext.on('t3', once); D.ext.on('t3', () => order.push('after'));
  D.ext.emit('t3'); D.ext.emit('t3');
  assert.deepEqual(order, ['once', 'after', 'after']);
});

/* ── item types ─────────────────────────────────────────────────── */

test('a registered item type is boxed, indexed and hit-tested by its own rules', () => {
  const t = tag(), w = wire();
  const s = board(t, w);
  const b = s.bbox(w);
  assert.deepEqual([b.x, b.y, b.x2, b.y2], [-2, -2, 202, 202], 'its bbox, with x2/y2 filled in');
  assert.ok(s.near(U.box(90, 90, 110, 110)).includes(w), 'the spatial index files it');

  // the wire is hit along its line and not in the empty corners of its box
  assert.equal(s.hitTest(20, 20, 4), w);
  assert.equal(s.hitTest(190, 10, 4), null);
  // the tag has no hit handler: anywhere in its box will do
  assert.equal(s.hitTest(170, 130, 2), t);
  assert.equal(s.hitTest(185, 130, 2), null);

  // and the lasso goes by its outline
  assert.ok(s.itemsInLasso([150, 140, 160, 140, 160, 160, 150, 160]).includes(w));
});

test('translate and scale use the type\'s handlers, or move x/y/w/h when it has none', () => {
  const t = tag(), w = wire();
  const s = board(t, w);
  s.translate(w, 10, 5);
  assert.deepEqual([w.a, w.b], [{ x: 10, y: 5 }, { x: 210, y: 205 }]);
  assert.equal(s.bbox(w).x, 8, 'the box moved with it');
  s.translate(t, -100, -100);
  assert.deepEqual([t.x, t.y], [0, 0]);
  assert.ok(s.near(U.box(0, 0, 5, 5)).includes(t), 'and the index followed');

  s.scaleItem(w, { x: 10, y: 5 }, 0.5, 2);
  assert.deepEqual([w.a, w.b], [{ x: 10, y: 5 }, { x: 110, y: 405 }]);
  s.scaleItem(t, { x: 0, y: 0 }, 2, 3);
  assert.deepEqual([t.x, t.y, t.w, t.h], [0, 0, 160, 120]);
});

test('a registered type is drawn, with its opacity, and exported through its svg handler', async () => {
  const t = tag({ alpha: 0.5 }), w = wire({ alpha: 0.5 });
  const s = board(t, w);
  const app = { scene: s, camera: new D.Camera(), requestDraw() {}, opts: {} };
  const r = new D.Renderer(app);
  r.grid = 'none';
  drawn.length = 0;
  r.drawScene();
  assert.deepEqual(drawn.map(d => d.id).sort(), [t.id, w.id].sort(), 'both painted');
  const td = drawn.find(d => d.id === t.id);
  assert.equal(td.alpha, 0.5, 'drawItem set its opacity first');
  assert.equal(td.r, r, 'and handed it the renderer');

  const svg = await r.toSVG(s, s.contentBounds(), { theme: 'light', dark: false, transparent: true });
  assert.match(svg, /<g opacity="0.5"><line x1="0" y1="0" x2="200" y2="200"\/><\/g>/);
  assert.equal(svg.split('\n').filter(l => l === '').length, 1, 'the tag, with no svg handler, is left out');
});

test('the eraser takes a type only if it says so, and goes by its outline when it is not solid', () => {
  const t = tag(), w = wire();
  const s = board(t, w);
  assert.equal(D.erasable(w), true);
  assert.equal(D.erasable(t), false);
  assert.equal(D.backdrop(t), false);
  // across the line
  assert.deepEqual([...s.itemsCrossing([150, 140, 140, 160], 3, D.erasable)], [w]);
  // through the empty corner of its box: not a wire, so not erased
  assert.deepEqual([...s.itemsCrossing([190, 5, 195, 15], 3, D.erasable)], []);
  // a solid type is crossed anywhere in its box, as a note is
  assert.deepEqual([...s.itemsCrossing([170, 130, 175, 135], 3)], [t]);
});

test('a registered type survives save, load, copy and undo untouched', () => {
  const w = wire({ meta: { ohms: 470, tags: ['R1', { pin: 2 }] } });
  const s = board(w);
  const before = plain(D.clone(w));

  const again = new D.Scene(JSON.parse(s.docText()));
  assert.deepEqual(plain(D.clone(again.get(w.id))), before, 'through the saved form');

  const { copies } = D.cloneSet([w]);
  assert.notEqual(copies[0].id, w.id);
  assert.deepEqual(plain({ ...copies[0], id: w.id }), before, 'a copy is the same apart from its id');

  s.begin('move'); s.translate(w, 30, 40); s.commit();
  assert.equal(s.get(w.id).a.x, 30);
  s.undo();
  assert.deepEqual(plain(D.clone(s.get(w.id))), before, 'undo puts it back');
  s.redo();
  assert.equal(s.get(w.id).b.y, 240, 'and redo moves it again');

  const moved = plain(D.clone(s.get(w.id)));
  s.begin('delete'); s.removeMany([s.get(w.id)]); s.commit();
  assert.equal(s.get(w.id), undefined);
  s.undo();
  assert.deepEqual(plain(D.clone(s.get(w.id))), moved, 'deleted and undone');
});

test('a type nobody registered is kept as it is, and never poisons the bounds', () => {
  const odd = { id: 'odd1', type: 'from-a-newer-version', data: { deep: [1, 2, { x: 3 }] } };
  const was = plain(odd);
  const s = board(odd);
  const content = s.contentBounds();
  assert.ok(isFinite(content.x) && isFinite(content.w), 'zoom to fit still has a box');
  assert.equal(s.hitTest(0, 0, 10), null);
  const again = new D.Scene(JSON.parse(s.docText()));
  assert.deepEqual(plain(D.clone(again.get('odd1'))), was, 'saved and loaded untouched');
  s.begin('delete'); s.removeMany([odd]); s.commit(); s.undo();
  assert.deepEqual(plain(D.clone(s.get('odd1'))), was, 'undone untouched');
});

test('the select tool drags a registered type with its own translate, from where it started', () => {
  const w = wire();
  const app = fakeApp(D, {
    selection: [], opts: { general: { snapGrid: true } },
    select(items) { this.selection = items.filter(Boolean); },
    requestDraw() {}, requestDrawLive() {}, afterEdit() {},
    renderer: { clearLive() {}, handleRects: () => [], liftBegin: () => false, liftEnd() {} }
  });
  app.scene.add(w);
  const tool = new D.tools.SelectTool(app, false);
  const at = (x, y) => ({ x, y, sx: x, sy: y, samples: [] });
  tool.down(at(50, 50));
  tool.move(at(60, 53)); tool.move(at(70, 57));
  tool.up(at(70, 57));
  assert.deepEqual(plain([w.a, w.b]), [{ x: 20, y: 7 }, { x: 220, y: 207 }], 'moved by the drag, once, unsnapped');
  app.scene.undo();
  assert.deepEqual(plain(app.scene.get(w.id).a), { x: 0, y: 0 }, 'one undo step');
});

test('the pen announces each stroke it commits; the highlighter does not', () => {
  const got = [];
  const on = (app, item) => got.push(item.type);
  D.ext.on('stroke', on);
  for (const kind of ['pen', 'highlighter']) {
    const app = fakeApp(D, {
      opts: { general: {}, [kind]: { color: 'ink', size: 3, alpha: 1, thinning: 0.5 } },
      requestDraw() {}, requestDrawLive() {}, afterEdit() {}, hideHint() {},
      renderer: { clearLive() {} }
    });
    const pen = new D.tools.PenTool(app, kind);
    const at = (x, y) => ({ x, y, sx: x, sy: y, pressure: 0.5 });
    pen.down(at(0, 0));
    pen.move({ ...at(40, 10), samples: [at(20, 4), at(40, 10)] });
    pen.up(at(40, 10));
    assert.equal(app.scene.items.length, 1, kind + ' left its stroke');
  }
  D.ext.off('stroke', on);
  assert.deepEqual(got, ['stroke']);
});

/* ── the app picks up what was registered before it was built ───── */

test('registered tools, options, keys and events reach the app', async () => {
  const fired = [];
  const A = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      const X = g.DPO;
      // a store that never answers: start() waits on it, so only the constructor runs
      X.store = { init: () => new Promise(() => {}), setLast() {} };
      X.ext.opts.widget = { color: 'ink', size: 4, nested: { on: true } };
      X.ext.opts.general = { holdToSnap: false, widgetSnap: true };
      X.ext.tools.push({
        name: 'widget',
        create: app => ({ app, down() {}, move() {}, up() {}, cancel() {}, paint() {} }),
        rail: { icon: 'M4 4h16', key: 'B', title: 'Widget · B' }
      });
      for (const ev of ['tool', 'select', 'board', 'change'])
        X.ext.on(ev, (app, arg) => { fired.push(ev); });
      X.ext.on('key', (app, e) => e.key === 'x');
      X.ext.on('frame', (app, ctx) => { fired.push('frame'); });
    }, 'app.js');
  const app = A.app;

  assert.equal(app.tools.widget.app, app, 'the tool was made for this app');
  assert.deepEqual(plain(app.opts.widget), { color: 'ink', size: 4, nested: { on: true } });
  assert.notEqual(app.opts.widget, A.ext.opts.widget, 'a copy of the defaults, not the defaults');
  assert.equal(app.opts.general.widgetSnap, true, 'a new key in an existing section is added');
  assert.equal(app.opts.general.holdToSnap, true, 'and an existing one is not overwritten');

  const key = (k) => ({ key: k, code: 'Key' + k.toUpperCase(), target: { matches: () => false }, preventDefault() {} });
  app.onKey(key('b'));
  assert.equal(app.toolName, 'widget', 'its key wins over the pen\'s alias');
  app.onKey(key('x'));
  assert.equal(app.toolName, 'widget', 'a key a feature consumed does nothing else');
  app.onKey(key('p'));
  assert.equal(app.toolName, 'pen');

  app.setBoard({ id: 'b1', name: 'B', doc: { items: [] } });
  app.saveDebounced = () => {}; app.warmSave = () => {};
  app.afterEdit();
  await new Promise(r => setTimeout(r, 20));          // a frame
  for (const ev of ['tool', 'select', 'board', 'change', 'frame']) assert.ok(fired.includes(ev), ev + ' was emitted');
});

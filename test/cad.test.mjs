/* Engineering drawing (js/cad.js and the line geometry in scene.js and
   render.js): arrowheads, bent and polyline arrows, attachments that
   follow what they are attached to, snapping, the drawing scale and
   dimensions. Asserted on the numbers behind the drawing, as everywhere. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js', 'cad.js');
const U = D.util, C = D.cad;
const plain = v => JSON.parse(JSON.stringify(v));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** a stand-in for the app, enough for the snap engine and the tools */
function app(scene = new D.Scene(), over = {}) {
  return {
    scene, camera: new D.Camera(), coarse: false,
    opts: { general: { snapGrid: false }, cad: { objects: true, angle: true }, dim: { mode: 'auto' }, shape: { kind: 'line', heads: {} } },
    requestDraw() {}, requestDrawLive() {}, afterEdit() {}, hint() {}, hideHint() {}, toast() {},
    ...over
  };
}
const line = o => D.make.shape({ kind: 'line', x: 0, y: 0, w: 100, h: 0, size: 2, ...o });

/* ── arrowheads ─────────────────────────────────────────────────── */

test('a filled head points along the line, scales with the stroke, and says how far to cut the shaft back', () => {
  const g = D.headGeom('filled', 100, 0, 0, 3, 1);
  const tri = g.fill[0];
  assert.deepEqual([tri[0], tri[1]], [100, 0], 'the tip is the end of the line');
  const len = D.headLen(3, 1);
  assert.ok(near(tri[2], 100 - len) && near(tri[4], 100 - len), 'the back corners sit a head-length behind the tip');
  assert.ok(near(tri[3], -tri[5]), 'and either side of the shaft, symmetrically');
  assert.ok(g.back > 0 && g.back < len, 'the shaft stops inside the head');
  assert.ok(D.headLen(8, 1) > D.headLen(3, 1), 'a heavier line gets a bigger head');
  assert.ok(near(D.headLen(3, 2), 2 * D.headLen(3, 1)), 'and the size can be overridden');
  // pointing up the page: the tip leads, the corners trail below it
  const up = D.headGeom('filled', 0, 0, -Math.PI / 2, 3, 1).fill[0];
  assert.ok(up[3] > 0 && up[5] > 0);
});

test('every head style has a shape, and none has none', () => {
  for (const s of ['open', 'filled', 'half', 'tick', 'dot']) {
    const g = D.headGeom(s, 0, 0, 0, 2, 1);
    assert.ok(g && (g.fill || g.line || g.dot), s);
  }
  assert.equal(D.headGeom('none', 0, 0, 0, 2, 1), null);
  assert.equal(D.headGeom('dot', 0, 0, 0, 2, 1).dot[0][2] > 0, true);
});

test('old arrows keep their heads: the defaults read the kind', () => {
  assert.deepEqual(plain(D.headsOf(D.make.shape({ kind: 'arrow' }))), ['none', 'filled']);
  assert.deepEqual(plain(D.headsOf(D.make.shape({ kind: 'line' }))), ['none', 'none']);
  assert.deepEqual(plain(D.headsOf(D.make.shape({ kind: 'line', arrowStart: true }))), ['filled', 'none']);
  assert.deepEqual(plain(D.headsOf(D.make.shape({ kind: 'line', head1: 'tick', head2: 'dot' }))), ['tick', 'dot']);
});

test('the shaft is cut back under a filled head but runs to the tip under an open one', () => {
  const s = new D.Scene();
  const filled = D.lineParts(s, line({ head2: 'filled', size: 3 }));
  assert.ok(filled.pts[2] < 100, 'stops short of the tip');
  const open = D.lineParts(s, line({ head2: 'open', size: 3 }));
  assert.equal(open.pts[2], 100);
});

test('line styles: centre and hidden lines have their own patterns', () => {
  assert.deepEqual(plain(D.dashFor(0, 2)), []);
  assert.equal(D.dashFor(3, 2).length, 4, 'centre line: long dash, gap, dot, gap');
  assert.ok(D.dashFor(4, 2)[0] < D.dashFor(1, 2)[0], 'hidden line dashes are shorter than plain dashes');
});

/* ── bent lines and polylines ───────────────────────────────────── */

test('a bent line is hit along its curve, not its chord, and its box takes the bulge in', () => {
  const s = new D.Scene();
  const it = s.add(line({ curve: [0.5, 0.4] }));       // midpoint 40 units off the chord
  const pts = s.linePath(it);
  const mid = D.pointAlong(pts, 0.5);
  assert.ok(near(mid.x, 50, 0.5) && near(Math.abs(mid.y), 40, 0.5), 'the curve passes through its handle');
  assert.ok(s.hitItem(it, mid.x, mid.y, 2), 'hit on the curve');
  assert.ok(!s.hitItem(it, 50, 0, 2), 'not on the chord it no longer follows');
  const b = s.bbox(it);
  assert.ok(b.y <= Math.min(0, mid.y) && b.y2 >= Math.max(0, mid.y), 'the box holds the bulge');
});

test('a polyline is hit on each leg, boxed round its corners, and moved and scaled with them', () => {
  const s = new D.Scene();
  const it = s.add(line({ x: 0, y: 0, w: 200, h: 0, via: [100, 100] }));
  assert.ok(s.hitItem(it, 50, 50, 2) && s.hitItem(it, 150, 50, 2));
  assert.ok(!s.hitItem(it, 100, 0, 2), 'the straight line between its ends is not part of it');
  assert.ok(s.bbox(it).y2 >= 100);
  s.translate(it, 10, 5);
  assert.deepEqual(plain(it.via), [110, 105]);
  s.scaleItem(it, { x: 0, y: 0 }, 2, 1);
  assert.deepEqual(plain(it.via), [220, 105]);
});

test('a mirror turns a bend and a moment the other way', () => {
  const s = new D.Scene();
  const it = s.add(line({ curve: [0.5, 0.3] }));
  s.scaleItem(it, { x: 50, y: 0 }, -1, 1);
  assert.equal(it.curve[1], -0.3);
  const m = s.add(D.make.shape({ kind: 'moment', x: 0, y: 0, w: 40, h: 40, a0: 30, sweep: 270 }));
  s.scaleItem(m, { x: 20, y: 20 }, -1, 1);
  assert.equal(m.sweep, -270);
  assert.equal(m.a0, 150);
});

test('a moment arrow is an arc: hit on the arc, not in the middle', () => {
  const s = new D.Scene();
  const m = s.add(D.make.shape({ kind: 'moment', x: 0, y: 0, w: 100, h: 100, a0: 0, sweep: 270, size: 2 }));
  assert.ok(s.hitItem(m, 100, 50, 2), 'on the arc at 0°');
  assert.ok(!s.hitItem(m, 50, 50, 2), 'not at the centre');
  assert.ok(!s.hitItem(m, 85.36, 85.36, 2), 'not in the gap the arc leaves (315°)');
});

/* ── attachments ────────────────────────────────────────────────── */

test('an arrow attached to a box follows it, and its stored ends are settled in the same step', () => {
  const s = new D.Scene();
  const box = s.add(D.make.shape({ kind: 'rect', x: 100, y: 100, w: 100, h: 50 }));
  const arrow = s.add(D.make.shape({ kind: 'arrow', x: 0, y: 0, w: 150, h: 100, bind2: { id: box.id, k: 'n' } }));
  s.begin('move'); s.translate(box, 40, 0); s.commit();
  const [, b] = s.lineEnds(arrow);
  assert.deepEqual([b.x, b.y], [190, 100], 'the end is on the top middle of the box, where it went');
  assert.deepEqual([arrow.x + arrow.w, arrow.y + arrow.h], [190, 100], 'and saved there');
  const bb = s.bbox(arrow);
  assert.ok(bb.x2 >= 190, 'its box moved too, though nothing touched the arrow itself');
  s.undo();
  const was = s.get(arrow.id);                       // undo puts back a copy, not the object
  assert.deepEqual([was.x + was.w, was.y + was.h], [150, 100], 'undo puts both back');
});

test('removing what an arrow is attached to leaves the arrow where it was, unattached', () => {
  const s = new D.Scene();
  const box = s.add(D.make.shape({ kind: 'rect', x: 100, y: 100, w: 100, h: 50 }));
  const arrow = s.add(D.make.shape({ kind: 'arrow', x: 0, y: 0, w: 150, h: 100, bind2: { id: box.id, k: 'n' } }));
  s.begin('delete'); s.removeMany([box]); s.commit();
  assert.ok(s.get(arrow.id), 'the arrow stays');
  assert.equal(arrow.bind2, undefined);
  assert.deepEqual([arrow.x + arrow.w, arrow.y + arrow.h], [150, 100]);
  s.undo();
  assert.deepEqual(plain(s.get(arrow.id).bind2), { id: box.id, k: 'n' }, 'undo attaches it again');
});

test('a copy keeps an attachment only when what it is attached to is copied with it', () => {
  const box = D.make.shape({ kind: 'rect', x: 100, y: 100, w: 100, h: 50 });
  const arrow = D.make.shape({ kind: 'arrow', x: 0, y: 0, w: 150, h: 100, bind2: { id: box.id, k: 'n' } });
  const both = D.cloneSet([box, arrow]).copies;
  assert.equal(both[1].bind2.id, both[0].id, 'rewired to the copied box');
  const alone = D.cloneSet([arrow]).copies;
  assert.equal(alone[0].bind2, undefined, 'let go of the original');
});

test('an attachment along a line or round an ellipse stays at its place on the thing', () => {
  const s = new D.Scene();
  const l = s.add(line({ x: 0, y: 0, w: 200, h: 0 }));
  const e = s.add(D.make.shape({ kind: 'ellipse', x: 300, y: 0, w: 100, h: 100 }));
  assert.deepEqual(plain(s.anchor({ id: l.id, k: 't', t: 0.25 })), { x: 50, y: 0 });
  const p = s.anchor({ id: e.id, k: '@', a: Math.PI / 2 });
  assert.ok(near(p.x, 350) && near(p.y, 0), 'the top of the circle');
  l.w = 400; l._b = null;
  assert.equal(s.anchor({ id: l.id, k: 't', t: 0.25 }).x, 100, 'a quarter of the way along, still');
});

test('a cycle of attachments does not hang the box', () => {
  const s = new D.Scene();
  const a = s.add(line({ x: 0, y: 0, w: 100, h: 0 }));
  const b = s.add(line({ x: 100, y: 0, w: 100, h: 0 }));
  a.bind2 = { id: b.id, k: 'p0' }; b.bind1 = { id: a.id, k: 'p1' };
  a._b = b._b = null;
  assert.ok(s.bbox(a));
  s.begin('x'); s.touch(a); s.commit();               // settling must not recurse for ever either
});

/* ── snapping ───────────────────────────────────────────────────── */

test('snaps to ends, corners, midpoints and centres, and offers an attachment', () => {
  const s = new D.Scene();
  const box = s.add(D.make.shape({ kind: 'rect', x: 100, y: 100, w: 200, h: 100 }));
  const A = app(s);
  const corner = C.snap(A, 104, 97);
  assert.deepEqual([corner.x, corner.y, corner.t], [100, 100, 'end']);
  assert.deepEqual(plain(corner.ref), { id: box.id, k: 'nw' });
  const mid = C.snap(A, 198, 103);
  assert.deepEqual([mid.x, mid.y, mid.t], [200, 100, 'mid']);
  const c = C.snap(A, 203, 148);
  assert.equal(c.t, 'centre');
  assert.equal(C.snap(A, 600, 600).t, null, 'nothing near: the point is left alone');
});

test('a corner beats a midpoint that is nearly as close', () => {
  const s = new D.Scene();
  s.add(line({ x: 0, y: 0, w: 20, h: 0 }));            // its middle is 10 from its start
  const A = app(s);
  A.opts.cad.objects = true;
  const p = C.snap(A, 4.5, 0);
  assert.equal(p.t, 'end');
});

test('where two lines cross is a snap point', () => {
  const s = new D.Scene();
  s.add(line({ x: 0, y: 0, w: 200, h: 200 }));
  s.add(line({ x: 0, y: 200, w: 200, h: -200 }));
  const p = C.snap(app(s), 103, 98);
  assert.equal(p.t, 'int');
  assert.ok(near(p.x, 100) && near(p.y, 100));
});

test('anywhere on an edge, failing a point; ink offers its ends but no attachment', () => {
  const s = new D.Scene();
  const box = s.add(D.make.shape({ kind: 'rect', x: 0, y: 0, w: 200, h: 100 }));
  const on = C.snap(app(s), 60, 3);
  assert.equal(on.t, 'on');
  assert.equal(on.y, 0);
  assert.equal(on.ref.id, box.id);
  assert.ok(near(on.ref.u, 0.3) && near(on.ref.v, 0));
  const s2 = new D.Scene();
  s2.add(D.make.stroke({ pts: [500, 500, .5, 600, 500, .5] }));
  const ink = C.snap(app(s2), 503, 502);
  assert.equal(ink.t, 'end');
  assert.equal(ink.ref, null);
});

test('15° steps catch a line that is nearly there, and the grid catches the rest', () => {
  const A = app();
  const a = C.snap(A, 100, -27, { from: { x: 0, y: 0 } });            // about 15.1°
  assert.equal(a.t, 'angle');
  assert.equal(a.label, '15°');
  assert.ok(near(Math.atan2(-a.y, a.x) * 180 / Math.PI, 15));
  assert.equal(C.snap(A, 100, -40, { from: { x: 0, y: 0 } }).t, null, '21.8° is left alone');
  assert.equal(C.snap(A, 100, -40, { from: { x: 0, y: 0 }, force15: true }).label, '15°', 'unless asked');
  A.opts.general.snapGrid = true;
  const g = C.snap(A, 37, 61);
  assert.deepEqual([g.x, g.y, g.t], [25, 50, 'grid']);
  A.opts.cad.objects = false;
});

test('a bigger reach under a finger or a pen', () => {
  const s = new D.Scene();
  s.add(line({ x: 0, y: 0, w: 200, h: 0 }));
  const A = app(s);
  assert.equal(C.snap(A, 0, 16).t, null);
  A.coarse = true;
  assert.equal(C.snap(A, 0, 16).t, 'end');
});

/* ── scale and units ────────────────────────────────────────────── */

test('calibration: a line of known length sets k, and a ratio is k on paper', () => {
  assert.equal(C.calibrate(200, 50), 0.25, '200 board units that are really 50 mm');
  assert.ok(Number.isNaN(C.calibrate(0, 5)));
  const k = C.kFromRatio(50, 'mm');
  assert.ok(near(C.ratioOf({ k, unit: 'mm' }), 50), '1:50 round-trips');
  assert.ok(near(C.convertK(1, 'mm', 'cm'), 0.1), 'the same scale in centimetres');
});

test('the scale is part of the document: it saves, loads and undoes', () => {
  const s = new D.Scene();
  s.add(line());
  const A = app(s);
  C.setScale(A, { unit: 'm', k: 0.01, prec: 2 });
  assert.equal(C.scaleOf(s).unit, 'm');
  const doc = JSON.parse(s.docText());
  assert.deepEqual(doc.meta.scale, { unit: 'm', k: 0.01, prec: 2, units: true });
  assert.equal(s.docText(), JSON.stringify(s.toJSON()), 'docBytes and toJSON agree');
  const t = new D.Scene(doc);
  assert.equal(C.fmtLen(t, 250), '2.50 m');
  s.undo();
  assert.equal(C.scaleOf(s).unit, 'mm');
  assert.ok(!('meta' in JSON.parse(s.docText())), 'a board at the default scale saves as it always did');
  s.redo();
  assert.equal(C.scaleOf(s).k, 0.01);
});

test('fields take arithmetic and units', () => {
  assert.equal(C.parse('250', 'mm'), 250);
  assert.equal(C.parse('2.5 m', 'mm'), 2500);
  assert.equal(C.parse('1200/4', 'mm'), 300);
  assert.equal(C.parse('3*(20+5) cm', 'mm'), 750);
  assert.equal(C.parse('10 mm + 1 cm', 'mm'), 20);
  assert.equal(C.parse('-30', '°'), -30);
  assert.ok(Number.isNaN(C.parse('abc', 'mm')));
  assert.ok(Number.isNaN(C.parse('', 'mm')));
});

test('angles count anticlockwise from east, as on paper', () => {
  assert.equal(C.angleOf(1, 0), 0);
  assert.equal(C.angleOf(0, -1), 90, 'up the page');
  assert.equal(C.angleOf(-1, 0), 180);
  assert.equal(C.angleOf(0, 1), 270);
});

/* ── dimensions ─────────────────────────────────────────────────── */

const dim = o => C.makeDim({ p: [{ x: 0, y: 0 }, { x: 200, y: 0 }], off: 20, ...o });

test('dimension text: formatted in board units, with prefixes, overrides and <>', () => {
  const s = new D.Scene();
  assert.equal(C.dimText(dim(), s), '200.0 mm');
  C.setScale(app(s), { k: 0.5, prec: 0 });
  assert.equal(C.dimText(dim(), s), '100 mm');
  C.setScale(app(s), { units: false });
  assert.equal(C.dimText(dim(), s), '100');
  assert.equal(C.dimText(dim({ kind: 'radius' }), s), 'R100');
  assert.equal(C.dimText(dim({ kind: 'diameter' }), s), 'Ø200');
  assert.equal(C.dimText(dim({ text: '2× <>' }), s), '2× 100');
  assert.equal(C.dimText(dim({ text: 'TYP' }), s), 'TYP');
  const ang = C.makeDim({ kind: 'angle', p: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: -100 }], off: 40 });
  assert.equal(C.dimText(ang, s), '90°');
  assert.equal(C.dimText({ ...ang, reflex: true }, s), '270°');
});

test('horizontal and vertical dimensions measure along their axis; auto picks by the drag', () => {
  const s = new D.Scene();
  const p = [{ x: 0, y: 0 }, { x: 300, y: 400 }];
  assert.equal(C.dimValue(dim({ p, orient: 'aligned' }), s), 500);
  assert.equal(C.dimValue(dim({ p, orient: 'h' }), s), 300);
  assert.equal(C.dimValue(dim({ p, orient: 'v' }), s), 400);
  assert.equal(C.orientFor({ x: 0, y: 0 }, { x: 100, y: 5 }), 'h');
  assert.equal(C.orientFor({ x: 0, y: 0 }, { x: 4, y: -100 }), 'v');
  assert.equal(C.orientFor({ x: 0, y: 0 }, { x: 100, y: 100 }), 'aligned');
});

test('a dimension is hit on its lines and its text, and erased like a line', () => {
  const s = new D.Scene();
  const d = s.add(dim());
  const g = C.dimGeom(d, s);
  assert.ok(s.hitItem(d, 100, g.lines.find(l => l.length === 4 && l[1] === l[3])[1], 2), 'on the dimension line');
  assert.ok(s.hitItem(d, g.text.cx, g.text.cy, 1), 'on its text');
  assert.ok(!s.hitItem(d, 100, 200, 2));
  assert.ok(D.erasable(d));
  assert.equal(s.itemsCrossing([100, -40, 100, 40], 2, D.erasable).length, 1, 'a rub across it takes it');
});

test('an attached dimension follows the drawing, and undo brings it back', () => {
  const s = new D.Scene();
  const l = s.add(line({ x: 0, y: 0, w: 200, h: 0 }));
  const d = s.add(C.makeDim({ p: [{ x: 0, y: 0, ref: { id: l.id, k: 'p0' } }, { x: 200, y: 0, ref: { id: l.id, k: 'p1' } }], off: 20 }));
  s.begin('stretch'); s.touch(l); l.w = 300; s.commit();
  assert.equal(C.dimValue(d, s), 300, 'the dimension measures the line as it is now');
  assert.equal(d.p[1].x, 300, 'and its stored point was brought up to date in the same step');
  assert.ok(s.bbox(d).x2 >= 300, 'its box moved with the line');
  s.undo();
  assert.equal(s.get(d.id).p[1].x, 200);
  assert.equal(C.dimValue(s.get(d.id), s), 200);
});

test('dragging an attached dimension on its own moves its line; with its target it moves along', () => {
  const s = new D.Scene();
  const l = s.add(line({ x: 0, y: 0, w: 200, h: 0 }));
  const d = s.add(C.makeDim({ orient: 'h', p: [{ x: 0, y: 0, ref: { id: l.id, k: 'p0' } }, { x: 200, y: 0, ref: { id: l.id, k: 'p1' } }], off: 20 }));
  const T = D.ext.items.dim.translate;
  const alone = D.clone(d);
  T(alone, 0, -15, new Set([d.id]));
  assert.equal(alone.off, 20 + 15, 'off the drawing by the distance dragged');
  const both = D.clone(d);
  T(both, 0, -15, new Set([d.id, l.id]));
  assert.equal(both.off, 20, 'its target is moving: it simply follows');
  const free = dim();
  T(free, 5, 5, new Set([free.id]));
  assert.deepEqual(plain(free.p), [{ x: 5, y: 5 }, { x: 205, y: 5 }], 'an unattached one just moves');
});

test('a dimension exports to SVG with its heads and text', () => {
  const s = new D.Scene();
  const d = s.add(dim());
  const r = new D.Renderer({ scene: s, camera: new D.Camera(), requestDraw() {}, opts: {} });
  const svg = D.ext.items.dim.svg(d, r);
  assert.match(svg, /<path d="M/);
  assert.match(svg, /<text[^>]*>200\.0 mm<\/text>/);
  assert.ok((svg.match(/fill="#/g) || []).length >= 2, 'two filled heads');
});

test('arrowheads reach the SVG export, which they used not to', async () => {
  const s = new D.Scene();
  s.add(D.make.shape({ kind: 'arrow', x: 0, y: 0, w: 100, h: 0, dash: 3 }));
  s.add(D.make.shape({ kind: 'moment', x: 200, y: 0, w: 60, h: 60 }));
  const r = new D.Renderer({ scene: s, camera: new D.Camera(), requestDraw() {}, opts: {} });
  const svg = await r.toSVG(s, s.contentBounds(), { theme: 'light', dark: false, transparent: true });
  assert.ok((svg.match(/Z" fill=/g) || []).length >= 2, 'a head on the arrow and on the moment');
  assert.match(svg, /stroke-dasharray/, 'the centre line keeps its pattern');
  assert.match(svg, / A30,30 /, 'the moment is an arc');
});

test('a dimension of a line in one go is attached to its ends', () => {
  const s = new D.Scene();
  const l = s.add(line({ x: 0, y: 0, w: 120, h: 0 }));
  const d = C.dimensionOf(app(s), l, { x: 60, y: -30 });
  assert.equal(d.kind, 'linear');
  assert.deepEqual(plain(d.p.map(q => q.ref.k)), ['p0', 'p1']);
  assert.ok(d.off > 0, 'on the side it was asked for');
  const e = s.add(D.make.shape({ kind: 'ellipse', x: 0, y: 100, w: 80, h: 80 }));
  const r = C.dimensionOf(app(s), e);
  assert.equal(r.kind, 'diameter');
  assert.equal(C.dimValue(r, s), 80);
});

/* ── the tools ──────────────────────────────────────────────────── */

const ev = (x, y, o) => ({ x, y, sx: x, sy: y, pressure: .5, samples: null, ...o });

test('drawing an arrow onto a box attaches it there', () => {
  const s = new D.Scene();
  const box = s.add(D.make.shape({ kind: 'rect', x: 100, y: 100, w: 100, h: 50 }));
  const A = app(s, { finishCreate() {}, renderer: { clearLive() {} } });
  A.opts.shape = { kind: 'arrow', color: 'ink', size: 2, alpha: 1, dash: 0, fill: 'none', heads: { arrow: ['none', 'filled'] } };
  const t = new D.tools.ShapeTool(A);
  t.down(ev(0, 0)); t.move(ev(148, 102)); t.up(ev(148, 102));
  const arrow = s.items[1];
  assert.equal(arrow.kind, 'arrow');
  assert.deepEqual(plain(arrow.bind2), { id: box.id, k: 'n' }, 'snapped to the top middle and held there');
  assert.equal(arrow.head2, 'filled');
});

test('a polyline is built a corner at a time and leaves nothing behind if cancelled', () => {
  const s = new D.Scene();
  const A = app(s, { finishCreate() {}, renderer: { clearLive() {} }, pointer: { sx: 0, sy: 0 } });
  A.opts.shape = { kind: 'polyline', color: 'ink', size: 2, alpha: 1, dash: 0, fill: 'none', heads: {} };
  const t = new D.tools.ShapeTool(A);
  const press = (x, y, x2 = x, y2 = y) => { A.pointer = ev(x, y); t.down(ev(x, y)); t.move(ev(x2, y2)); A.pointer = ev(x2, y2); t.up(ev(x2, y2)); };
  press(0, 0, 100, 0);
  press(100, 0, 100, 100);
  t.cancel();
  assert.equal(s.items.length, 0, 'cancelled: nothing on the board');
  press(0, 0, 100, 0);
  press(100, 0, 100, 100);
  press(100, 100);                                   // a tap on the last point finishes it
  assert.equal(s.items.length, 1);
  assert.deepEqual(plain(s.items[0].via), [100, 0]);
  assert.equal(s.items[0].kind, 'arrow', 'a polyline arrow by default');
});

test('the measure tool leaves nothing on the board unless pinned', () => {
  const s = new D.Scene();
  const A = app(s, { renderer: { clearLive() {} } });
  A.opts.measure = { mode: 'distance' };
  A.ui = null;
  const tool = D.ext.tools.find(t => t.name === 'measure').create(A);
  A.active = tool;
  tool.down(ev(0, 0)); tool.move(ev(30, 40)); tool.up(ev(30, 40));
  assert.equal(tool.done, true);
  assert.equal(tool.result()[0].startsWith('50.0 mm'), true);
  assert.equal(s.items.length, 0);
  tool.pin();
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].type, 'dim');
  tool.cancel();
  assert.deepEqual(plain(tool.pts), []);
});

test('the area of a polygon', () => {
  assert.equal(C.area([0, 0, 100, 0, 100, 50, 0, 50]), 5000);
});

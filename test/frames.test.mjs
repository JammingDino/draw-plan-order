/* Pages on the board (js/frames.js): sizes, order, picking only by the
   edge, the lasso going all the way round, selecting with contents, and
   Page Up / Page Down. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

function rig() {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', 'frames.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false };
  app.toast = () => {};
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {}; app.saveView = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  // nothing here is about painting, and PDF pages would want pdf.js to paint
  app.requestDraw = () => {}; app.requestDrawLive = () => {};
  // and a stand-in for pdf.js, which the painter asks for page pictures
  if (!D.pdf) D.pdf = new Proxy({}, { get: () => () => null });
  return { D, app, scene: app.scene, F: D.frames };
}

test('page sizes: A4 upright is 210 × 297 mm at 96 to the inch; on its side, the other way round; a slide is 16:9', () => {
  const { F } = rig();
  // (objects from the app's realm: compared by value)
  const wh = o => [o.w, o.h];
  assert.deepEqual(wh(F.dims('A4', 'portrait')), [794, 1123]);
  assert.deepEqual(wh(F.dims('A4', 'landscape')), [1123, 794]);
  const s = F.dims('Slide', 'portrait');
  assert.ok(Math.abs(s.w / s.h - 16 / 9) < 0.01 && s.w > s.h, 'a slide stays on its side');
});

test('pages go behind the ink, in the order they were added, and are named by it', () => {
  const { D, app, scene, F } = rig();
  const ink = scene.add(D.make.stroke({ pts: inked([10, 10, 50, 50]) }));
  const a = F.addAfter(app, null);
  const b = F.addAfter(app, a);
  assert.deepEqual([...F.list(scene).map(f => f.id)], [a.id, b.id]);
  assert.ok(scene.items.indexOf(b) < scene.items.indexOf(ink), 'behind what is written');
  assert.equal(b.x, a.x); assert.ok(b.y > a.y + a.h, 'the next one below');
  assert.equal(F.nameOf(scene, b), 'Page 2');
  b.name = 'Free-body diagrams';
  assert.equal(F.nameOf(scene, b), 'Free-body diagrams');
});

test('a page is picked by its edge or its name, never from the middle', () => {
  const { app, scene, F } = rig();
  const f = F.addAfter(app, null);
  const mid = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  assert.equal(scene.hitTest(mid.x, mid.y, 4), null, 'the middle is for writing on');
  assert.equal(scene.hitTest(f.x + 1, mid.y, 4), f, 'the edge');
  assert.equal(scene.hitTest(f.x + 20, f.y - F.labelSize(f) * 0.8, 4), f, 'the name');
});

test('a lasso takes a page only all the way round; select-with-contents takes it and its ink', () => {
  const { D, app, scene, F } = rig();
  const f = F.addAfter(app, null);
  const ink = scene.add(D.make.stroke({ pts: inked([f.x + 100, f.y + 100, f.x + 200, f.y + 150]) }));
  const off = scene.add(D.make.stroke({ pts: inked([f.x + f.w + 300, f.y, f.x + f.w + 350, f.y + 20]) }));
  const ring = (x1, y1, x2, y2) => [x1, y1, x2, y1, x2, y2, x1, y2];
  const inner = scene.itemsInLasso(ring(f.x + 50, f.y + 50, f.x + f.w - 50, f.y + f.h - 50));
  assert.ok(inner.includes(ink) && !inner.includes(f), 'round the middle: the ink, not the page');
  const outer = scene.itemsInLasso(ring(f.x - 10, f.y - 10, f.x + f.w + 10, f.y + f.h + 10));
  assert.ok(outer.includes(f), 'all the way round: the page too');
  F.selectWithContents(app, f);
  assert.ok(app.selection.includes(f) && app.selection.includes(ink) && !app.selection.includes(off));
});

test('resizing a page by hand makes it a page of its own size', () => {
  const { app, scene, F } = rig();
  const f = F.addAfter(app, null);
  scene.scaleItem(f, { x: f.x, y: f.y }, 1.5, 1);
  assert.equal(f.size, 'custom');
  assert.equal(Math.round(f.w), Math.round(794 * 1.5));
});

test('Page Down and Page Up step through the pages', () => {
  const { app, F, D } = rig();
  const a = F.addAfter(app, null), b = F.addAfter(app, a), c = F.addAfter(app, b);
  F.go(app, a);
  const key = k => D.ext.emit('key', app, { key: k, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} });
  assert.equal(key('PageDown'), true);
  assert.equal(F.current(app), b);
  key('PageDown'); key('PageDown');
  assert.equal(F.current(app), c, 'stops at the last');
  key('PageUp');
  assert.equal(F.current(app), b);
});

test('pages save, load and undo like anything else', () => {
  const { app, scene, F, D } = rig();
  const f = F.addAfter(app, null);
  const doc = JSON.parse(JSON.stringify(scene.toJSON()));
  assert.equal(doc.items[0].type, 'frame');
  app.undo();
  assert.equal(F.list(scene).length, 0);
  const s2 = new D.Scene(doc);
  assert.equal(F.list(s2).length, 1);
});

test('imported PDF pages are pages too: in reading order, named by their document, and followed by pages their size', () => {
  const { D, app, scene, F } = rig();
  // an A4 PDF page as it now comes in: 96 to the inch
  const p1 = scene.add(D.make.pdfpage({ asset: 'a', page: 1, pages: 2, label: 'Tutorial 3.pdf', x: 0, y: 0, w: 793.7, h: 1122.5, pw: 595.3, ph: 841.9 }), 0);
  const p2 = scene.add(D.make.pdfpage({ asset: 'a', page: 2, pages: 2, label: 'Tutorial 3.pdf', x: 0, y: 1150, w: 793.7, h: 1122.5, pw: 595.3, ph: 841.9 }), 0);
  assert.deepEqual([...F.sheets(scene)].map(s => s.id), [p1.id, p2.id]);
  assert.equal(F.nameOf(scene, p2), 'Tutorial 3 · p. 2');
  const next = F.addAfter(app, null);
  assert.ok(Math.abs(next.w - p2.w) < 1e-6 && Math.abs(next.h - p2.h) < 1e-6, 'a blank page the PDF page\'s size');
  assert.ok(next.y > p2.y + p2.h, 'after it');
  assert.equal(F.sheets(scene).length, 3);
  assert.equal(F.nameOf(scene, next), 'Page 3');
  // an A4 page and an A4 PDF page are the same size
  const a4 = F.dims('A4', 'portrait');
  assert.ok(Math.abs(a4.w - p1.w) < 1 && Math.abs(a4.h - p1.h) < 1);
  // and they print at their own size in points
  assert.deepEqual([Math.round(F.pointsOf(p1).w), Math.round(F.pointsOf(p1).h)], [595, 842]);
  assert.deepEqual([Math.round(F.pointsOf(next).w), Math.round(F.pointsOf(next).h)], [595, 842]);
  // one brought in before, at a unit to the point, prints at that
  const old = D.make.pdfpage({ asset: 'b', page: 1, x: 0, y: 0, w: 596, h: 842 });
  assert.deepEqual([F.pointsOf(old).w, F.pointsOf(old).h], [596, 842]);
});

test('reading order: down the board, and left to right along a row', () => {
  const { D, scene, F } = rig();
  const f = (x, y) => scene.add({ id: D.util.uid(), type: 'frame', x, y, w: 100, h: 140, size: 'custom', orient: 'portrait', paper: 'plain', name: '' }, 0);
  const c = f(0, 400), b = f(130, 10), a = f(0, 0);
  assert.deepEqual([...F.sheets(scene)].map(s => s.id), [a.id, b.id, c.id]);
});

/* ── reordering ──────────────────────────────────────────────────── */

function threePages() {
  const r = rig(), { D, app, scene, F } = r;
  const a = F.addAfter(app, null), b = F.addAfter(app, a), c = F.addAfter(app, b);
  const on = p => scene.add(D.make.stroke({ id: 'ink-' + p.id, pts: inked([p.x + 100, p.y + 100, p.x + 200, p.y + 150]) }));
  const ia = on(a), ib = on(b), ic = on(c);
  return { ...r, a, b, c, ia, ib, ic };
}
const at = (scene, it) => scene.bbox(it).y;

test('dragging the last page to the front: the pages change places, each with what is written on it', () => {
  const { app, scene, F, a, b, c, ic } = threePages();
  const spots = [a, b, c].map(p => ({ x: p.x, y: p.y }));
  const inkOffset = at(scene, ic) - c.y;
  assert.equal(F.reorder(app, 2, 0), true);
  assert.deepEqual([...F.sheets(scene).map(p => p.id)], [c.id, a.id, b.id]);
  assert.deepEqual([c.x, c.y], [spots[0].x, spots[0].y], 'into the first page\'s place');
  assert.deepEqual([a.y, b.y], [spots[1].y, spots[2].y]);
  assert.ok(Math.abs(at(scene, ic) - c.y - inkOffset) < 1e-6, 'its writing came with it');
});

test('a reorder is one undo step', () => {
  const { app, scene, F, a, b, c } = threePages();
  const before = [a, b, c].map(p => p.y);
  F.reorder(app, 0, 2);
  app.undo();
  assert.deepEqual([a, b, c].map(p => scene.get(p.id).y), before);
  assert.deepEqual([...F.sheets(scene).map(p => p.id)], [a.id, b.id, c.id]);
});

test('pages of mixed sizes are stacked down a column, and none lands on another', () => {
  const { app, scene, F, a, b, c } = threePages();
  scene.begin('t'); scene.touch(b); b.w = 1123; b.h = 794; b.size = 'A4'; b.orient = 'landscape'; scene.commit();
  F.reorder(app, 1, 0);
  const pages = F.sheets(scene);
  assert.deepEqual([...pages.map(p => p.id)], [b.id, a.id, c.id]);
  for (let i = 1; i < pages.length; i++) assert.ok(pages[i].y >= pages[i - 1].y + pages[i - 1].h, 'below the one before');
});

test('nothing happens for a move to where it already is, or out of range', () => {
  const { app, F } = threePages();
  assert.equal(F.reorder(app, 1, 1), false);
  assert.equal(F.reorder(app, 0, 5), false);
});

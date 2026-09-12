/* The document layer: cloning, undo/redo, text layout, bboxes and the
   rules about what a copy or an eraser is allowed to touch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { core, inked, CHAR_W } from './harness.mjs';

const D = core();
const ids = list => Array.from(list, i => i.id);

/* what clone() used to be, kept as the oracle for the faster version */
const jsonClone = it => {
  const o = {};
  for (const k in it) if (k[0] !== '_') o[k] = it[k];
  if (o.pts) o.pts = Array.from(o.pts, v => Math.round(v * 100) / 100);
  return JSON.parse(JSON.stringify(o));
};

test('clone still produces what the JSON round trip produced, bar rounding', () => {
  const samples = [
    D.make.stroke({ pts: inked([0, 0, 1.005, 2.6667, 300.123456, -4.5]), color: 'ink' }),
    D.make.shape({ x: -1.5, y: 2, w: 30.25, h: 0, dash: 2, fill: 'none' }),
    D.make.text({ text: 'two\nlines', bold: true, italic: false }),
    D.make.note({ text: '' }),
    D.make.node({ kind: 'decision', text: 'yes?' }),
    D.make.edge({ from: { id: 'a' }, to: { x: 3.14159, y: 2.71828 }, label: 'no' }),
    D.make.image({ src: 'data:image/png;base64,AAAA', w: 10, h: 10 }),
    D.make.pdfpage({ asset: 'vault:notes.pdf', page: 7, pages: 40 })
  ];
  for (const it of samples) {
    it._b = { x: 0 }; it._path = {}; it._lines = {};   // caches must not survive
    const got = JSON.parse(JSON.stringify(D.clone(it)));
    // history keeps full precision now; the stored format still rounds
    if (got.pts) got.pts = got.pts.map(v => Math.round(v * 100) / 100);
    assert.deepEqual(got, jsonClone(it), it.type);
  }
});

test('clone drops render caches and detaches point arrays', () => {
  const st = D.make.stroke({ pts: inked([0, 0, 10, 10]) });
  st._b = { x: 1 }; st._path = 'cached';
  const c = D.clone(st);
  assert.equal(c._b, undefined);
  assert.equal(c._path, undefined);
  c.pts[0] = 999;
  assert.equal(st.pts[0], 0, 'the copy owns its own points');
});

test('history keeps full precision; the saved file rounds', () => {
  const s = new D.Scene();
  const st = s.add(D.make.stroke({ pts: [1.23456, 9.87654, 0.5] }));
  assert.deepEqual(Array.from(D.clone(st).pts), [1.23456, 9.87654, 0.5],
    'an undo snapshot holds exactly what was on the board');
  assert.deepEqual(Array.from(s.toJSON().items[0].pts), [1.23, 9.88, 0.5],
    'the stored format is still rounded to keep it small');
});

test('serialising does not round the live board underneath it', () => {
  const s = new D.Scene();
  const st = s.add(D.make.stroke({ pts: [1.23456, 9.87654, 0.5] }));
  s.toJSON();
  assert.equal(st.pts[0], 1.23456, 'the item itself is untouched');
});

test('a transaction that changes nothing leaves no undo step', () => {
  const s = new D.Scene();
  const n = s.add(D.make.note({ x: 0, y: 0, w: 100, h: 100 }));
  s.begin('poke'); s.touch(n); s.commit();
  assert.equal(s.undoStack.length, 0, 'touching without changing is not an edit');

  s.begin('move'); s.translate(n, 5, 5); s.commit();
  assert.equal(s.undoStack.length, 1, 'an actual move is');
});

test('undo and redo walk a move back and forth', () => {
  const s = new D.Scene();
  const n = s.add(D.make.note({ x: 0, y: 0, w: 100, h: 100 }));
  s.begin('move'); s.translate(n, 40, 25); s.commit();
  assert.equal(s.get(n.id).x, 40);
  s.undo();
  assert.equal(s.get(n.id).x, 0);
  s.redo();
  assert.equal(s.get(n.id).x, 40);
});

test('removing a node takes its connectors with it, and undo brings both back', () => {
  const s = new D.Scene();
  const a = s.add(D.make.node({ x: 0, y: 0 }));
  const b = s.add(D.make.node({ x: 400, y: 0 }));
  const e = s.add(D.make.edge({ from: { id: a.id }, to: { id: b.id } }));
  s.begin('delete'); s.remove(a); s.commit();
  assert.equal(s.get(e.id), undefined, 'the dangling edge went too');
  s.undo();
  assert.ok(s.get(a.id) && s.get(e.id), 'both are back');
});

test('a new edit clears the redo branch', () => {
  const s = new D.Scene();
  const n = s.add(D.make.note({ x: 0, y: 0, w: 10, h: 10 }));
  s.begin('a'); s.translate(n, 1, 0); s.commit();
  s.undo();
  assert.equal(s.redoStack.length, 1);
  s.begin('b'); s.translate(s.get(n.id), 0, 1); s.commit();
  assert.equal(s.redoStack.length, 0);
});

test('the undo stack is bounded', () => {
  const s = new D.Scene();
  const n = s.add(D.make.note({ x: 0, y: 0, w: 10, h: 10 }));
  for (let i = 0; i < 260; i++) { s.begin('m'); s.translate(s.get(n.id), 1, 0); s.commit(); }
  assert.equal(s.undoStack.length, 200);
});

/* text layout */

test('text wraps at the box width and keeps blank lines', () => {
  const s = new D.Scene();
  // stub metrics: one character is size * CHAR_W wide
  const t = D.make.text({ text: 'aaaa bbbb cccc', size: 10, w: 10 * CHAR_W * 9 });
  const L = s.layout(t);
  assert.deepEqual(Array.from(L.lines), ['aaaa bbbb', 'cccc']);

  const blank = s.layout(D.make.text({ text: 'one\n\ntwo', size: 10, w: 1000 }));
  assert.deepEqual(Array.from(blank.lines), ['one', '', 'two']);
});

test('autoWidth text never wraps and reports its own width', () => {
  const s = new D.Scene();
  const t = D.make.text({ text: 'a very long single line indeed', size: 10, w: 5, autoWidth: true });
  const L = s.layout(t);
  assert.equal(L.lines.length, 1);
  assert.ok(L.width > 5);
});

test('layout is cached and invalidated when the item changes', () => {
  const s = new D.Scene();
  const t = s.add(D.make.text({ text: 'one', size: 10, w: 1000 }));
  const first = s.layout(t);
  assert.equal(s.layout(t), first, 'same object back');
  t.text = 'one two three';
  s.dirty(t);
  assert.notEqual(s.layout(t), first, 'recomputed after dirty()');
});

/* geometry */

test('a stroke bbox covers the ink plus half the nib', () => {
  const s = new D.Scene();
  const st = D.make.stroke({ pts: inked([0, 0, 100, 50]), size: 10 });
  const b = s.bbox(st);
  assert.ok(b.x <= -5 && b.y <= -5 && b.x2 >= 105 && b.y2 >= 55);
});

test('bbox is cached until the item is touched', () => {
  const s = new D.Scene();
  const n = s.add(D.make.note({ x: 0, y: 0, w: 10, h: 10 }));
  const b = s.bbox(n);
  assert.equal(s.bbox(n), b);
  s.begin('m'); s.translate(n, 100, 0); s.commit();
  assert.notEqual(s.bbox(n), b);
  assert.equal(s.bbox(n).x, 100);
});

test('an edge between two nodes stops at their edges, not their centres', () => {
  const s = new D.Scene();
  const a = s.add(D.make.node({ x: 0, y: 0, w: 100, h: 60 }));
  const b = s.add(D.make.node({ x: 400, y: 0, w: 100, h: 60 }));
  const e = s.add(D.make.edge({ from: { id: a.id }, to: { id: b.id }, style: 'straight' }));
  const p = s.edgePath(e);
  assert.ok(p[0] > 0 && p[0] <= 100, 'leaves the first node at its border');
  assert.ok(p[2] >= 400 && p[2] < 500, 'arrives at the second node border');
});

/* copying */

test('a duplicated diagram is a diagram, not a picture of one', () => {
  const s = new D.Scene();
  const a = D.make.node({ x: 0, y: 0, group: 'g1' });
  const b = D.make.node({ x: 300, y: 0, group: 'g1' });
  const e = D.make.edge({ from: { id: a.id }, to: { id: b.id }, group: 'g1' });
  const { copies } = D.cloneSet([a, b, e]);
  const originals = ids([a, b, e]);

  assert.equal(new Set(ids(copies)).size, 3, 'fresh ids');
  assert.equal(copies.filter(c => originals.includes(c.id)).length, 0);

  const edge = copies.find(c => c.type === 'edge');
  assert.equal(edge.from.id, copies[0].id, 'rewired to the copies');
  assert.equal(edge.to.id, copies[1].id);

  assert.notEqual(copies[0].group, 'g1', 'the copies get their own group');
  assert.equal(copies[0].group, copies[1].group);
  assert.equal(copies[0].group, edge.group);
});

test('the eraser rubs out ink, not things you placed', () => {
  assert.ok(D.erasable(D.make.stroke({})));
  assert.ok(D.erasable(D.make.shape({})));
  assert.ok(D.erasable(D.make.edge({})));
  for (const t of ['note', 'node', 'image', 'text', 'pdfpage'])
    assert.ok(!D.erasable(D.make[t]({})), t + ' is not erasable');
});

/* round trip */

test('a board survives save and reload', () => {
  const s = new D.Scene();
  s.add(D.make.stroke({ pts: inked([0, 0, 10, 10, 20, 5]), size: 4 }));
  s.add(D.make.node({ text: 'start', kind: 'terminal' }));
  const doc = JSON.parse(JSON.stringify(s.toJSON()));
  const back = new D.Scene(doc);
  assert.deepEqual(ids(back.items), ids(s.items));
  assert.equal(back.items[1].text, 'start');
  assert.equal(back.undoStack.length, 0, 'a freshly loaded board has no history');
});

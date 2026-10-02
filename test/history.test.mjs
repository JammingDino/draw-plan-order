/* Big edits and their history. Deleting, undoing and redoing thousands of
   items at once goes through one-pass paths rather than a search per item;
   these check that the result is exactly what the one-at-a-time path would
   have given, and that history cannot grow without bound. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { core, inked } from './harness.mjs';

const D = core();
const ids = s => s.items.map(i => i.id).join(',');
/* the same board built twice has different ids, so compare what is on it */
const sig = s => s.items.map(i => i.type + ':' + (i.pts ? i.pts[0] + '/' + i.pts[1] : i.type === 'edge' ? s.items.indexOf(s.get(i.from.id)) + '>' + s.items.indexOf(s.get(i.to.id)) : i.x)).join(',');

function board(n, seed = 3) {
  const s = new D.Scene();
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    if (i % 10 === 0) s.add(D.make.node({ x: i * 10, y: 0 }));
    else s.add(D.make.stroke({ pts: inked([i, rand() * 100, i + 5, rand() * 100]) }));
  }
  // connectors between some of the nodes
  const nodes = s.items.filter(i => i.type === 'node');
  for (let k = 0; k + 1 < nodes.length; k += 2) s.add(D.make.edge({ from: { id: nodes[k].id }, to: { id: nodes[k + 1].id } }), 3);
  return { s, rand };
}

test('removeMany removes what remove() would, connectors included', () => {
  const a = board(400).s, b = board(400).s;
  const pick = s => s.items.filter((it, i) => i % 3 === 0 && it.type !== 'edge');
  const pa = pick(a), pb = pick(b);
  a.begin('x'); for (const it of pa) a.remove(it); a.commit();
  b.begin('x'); b.removeMany(pb); b.commit();
  assert.equal(sig(b), sig(a));
  assert.equal(b.byId.size, b.items.length);
});

test('undo of a big delete puts every item back where it was', () => {
  const { s } = board(2000);
  const before = ids(s);
  const sel = s.items.filter((_, i) => i % 7 !== 3);
  s.begin('delete'); s.removeMany(sel); s.commit();
  const after = ids(s);
  assert.ok(s.items.length < 400);
  s.undo();
  assert.equal(ids(s), before);
  assert.equal(s.byId.size, s.items.length);
  for (const it of s.items) assert.equal(s.get(it.id), it, 'the index points at the live item');
  s.redo();
  assert.equal(ids(s), after, 'redo takes the same items out again');
  s.undo();
  assert.equal(ids(s), before, 'and again after a redo');
});

test('undo of removes made out of board order still restores the order', () => {
  const { s } = board(300);
  const before = ids(s);
  const sel = s.items.filter((_, i) => i % 2 === 0).reverse();     // back to front
  s.begin('x'); for (const it of sel) s.remove(it); s.commit();
  s.undo();
  assert.equal(ids(s), before);
});

test('undo and redo of a big move restore positions, in place', () => {
  const { s } = board(1000);
  const before = ids(s);
  const xs = s.items.map(i => i.type === 'stroke' ? i.pts[0] : i.x);
  s.begin('move');
  for (const it of s.items) if (it.type !== 'edge') s.translate(it, 50, 0);
  s.commit();
  s.undo();
  assert.equal(ids(s), before, 'order kept');
  assert.deepEqual(s.items.map(i => i.type === 'stroke' ? i.pts[0] : i.x), xs);
  s.redo();
  assert.equal(ids(s), before);
  assert.equal(s.items[1].pts[0], xs[1] + 50);
});

test('history is capped by what it holds, keeping the newest step', () => {
  const s = new D.Scene();
  const big = [];
  for (let i = 0; i < 3000; i++) big.push(i, i, 0.5);           // 9000 numbers
  for (let i = 0; i < 400; i++) s.add(D.make.stroke({ pts: big.slice() }));
  for (let step = 0; step < 6; step++) {
    s.begin('nudge');
    for (const it of s.items) s.translate(it, 1, 0);
    s.commit();
  }
  // each step holds two copies of 400 x 9000 numbers: 7.2M, so only one fits
  assert.equal(s.undoStack.length, 1);
  s.undo();
  assert.equal(s.items[0].pts[0], 5, 'the step kept is the newest one');
});

test('small steps still keep two hundred of them', () => {
  const s = new D.Scene();
  for (let i = 0; i < 250; i++) { s.begin('draw'); s.add(D.make.stroke({ pts: inked([i, 0, i, 10]) })); s.commit(); }
  assert.equal(s.undoStack.length, 200);
});

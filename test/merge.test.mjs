/* Two copies of a board, changed on two machines (js/merge.js): merged
   item by item against the copy both started from, losing nothing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'pdf.js', 'scene.js', 'camera.js', 'render.js', 'tools.js',
  'math.js', 'calc.js', 'cad.js', 'inkmath.js', 'frames.js', 'graph.js', 'symbols.js', 'merge.js');
const M = D.merge;
const plain = o => JSON.parse(JSON.stringify(o));
const ids = doc => doc.items.map(it => it.id);

const s = (id, x = 0) => ({ id, type: 'stroke', pts: [x, 0, 0.5, x + 10, 0, 0.5], color: 'ink', size: 3 });
const base = () => ({ v: 1, items: [s('a'), s('b'), s('c')] });

function three(b, o, t) { return plain(M.three(b, o, t)); }

test('changes made on either side alone are both kept', () => {
  const o = base(); o.items.push(s('mine', 50));
  const t = base(); t.items.push(s('theirs', 90));
  const r = three(base(), o, t);
  // theirs goes in after c, the item it followed on their side
  assert.deepEqual(ids(r.doc), ['a', 'b', 'c', 'theirs', 'mine']);
  assert.equal(r.lost.items.length, 0);
});

test('an item moved on their side and left alone on ours takes their move', () => {
  const o = base();
  const t = base(); t.items[1] = s('b', 40);
  const r = three(base(), o, t);
  assert.equal(r.doc.items[1].pts[0], 40);
  assert.equal(r.changed, 1);
});

test('removed on one side and untouched on the other: removed', () => {
  const o = base(); o.items.splice(0, 1);
  const t = base(); t.items.splice(2, 1);
  assert.deepEqual(ids(three(base(), o, t).doc), ['b']);
});

test('removed on one side but changed on the other: the change is kept', () => {
  const o = base(); o.items.splice(1, 1);                 // we rubbed b out
  const t = base(); t.items[1] = s('b', 77);              // they moved it
  const r = three(base(), o, t);
  assert.deepEqual(ids(r.doc), ['a', 'b', 'c']);
  assert.equal(r.doc.items.find(i => i.id === 'b').pts[0], 77);

  const o2 = base(); o2.items[1] = s('b', 66);            // and the other way round
  const t2 = base(); t2.items.splice(1, 1);
  assert.equal(three(base(), o2, t2).doc.items.find(i => i.id === 'b').pts[0], 66);
});

test('changed differently on both: ours stands, theirs comes back as lost', () => {
  const o = base(); o.items[0] = s('a', 10);
  const t = base(); t.items[0] = s('a', 20);
  const r = three(base(), o, t);
  assert.equal(r.doc.items[0].pts[0], 10);
  assert.equal(r.lost.items.length, 1);
  assert.equal(r.lost.items[0].pts[0], 20);
});

test('the same change on both sides is no clash', () => {
  const o = base(); o.items[0] = s('a', 10);
  const t = base(); t.items[0] = s('a', 10);
  const r = three(base(), o, t);
  assert.equal(r.lost.items.length, 0);
  assert.equal(r.changed, 0);
});

test('key order does not make two copies differ', () => {
  const o = base();
  const t = base(); t.items[0] = { size: 3, color: 'ink', pts: [0, 0, 0.5, 10, 0, 0.5], type: 'stroke', id: 'a' };
  assert.equal(three(base(), o, t).changed, 0);
});

test('what only theirs has goes in after the item it followed there', () => {
  const o = base(); o.items.unshift(s('front'));
  const t = base(); t.items.splice(2, 0, s('between', 15));          // a, b, between, c
  assert.deepEqual(ids(three(base(), o, t).doc), ['front', 'a', 'b', 'between', 'c']);
  const t2 = base(); t2.items.unshift(s('lead'));
  assert.deepEqual(ids(three(base(), base(), t2).doc), ['lead', 'a', 'b', 'c']);
});

test('a connector whose node was removed on the other side goes with it', () => {
  const n = id => ({ id, type: 'node', x: 0, y: 0, w: 10, h: 10 });
  const b = { v: 1, items: [n('n1'), n('n2')] };
  const o = plain(b); o.items.push({ id: 'e', type: 'edge', from: { id: 'n1' }, to: { id: 'n2' } });
  const t = plain(b); t.items.splice(1, 1);
  const r = three(b, o, t);
  assert.deepEqual(ids(r.doc), ['n1']);
  // and one with a free end survives
  const o2 = plain(b); o2.items.push({ id: 'e', type: 'edge', from: { id: 'n1' }, to: { x: 5, y: 5 } });
  assert.deepEqual(ids(three(b, o2, t).doc), ['n1', 'e']);
});

test('settings merge key by key; a clash keeps ours and hands back theirs', () => {
  const b = { v: 1, meta: { scale: { unit: 'mm', k: 1 }, grid: 5 }, items: [] };
  const o = plain(b); o.meta.scale = { unit: 'm', k: 1 };
  const t = plain(b); t.meta.grid = 10; t.meta.scale = { unit: 'in', k: 1 };
  const r = three(b, o, t);
  assert.deepEqual(r.doc.meta, { scale: { unit: 'm', k: 1 }, grid: 10 });
  assert.deepEqual(r.lost.meta, { scale: { unit: 'in', k: 1 } });
  assert.deepEqual(Object.keys(r.doc), ['v', 'meta', 'items']);
});

test('with no common copy, every difference is a clash and nothing is dropped', () => {
  const o = base(); o.items[0] = s('a', 1);
  const t = base(); t.items[0] = s('a', 2); t.items.push(s('d'));
  const r = three(null, o, t);
  assert.deepEqual(ids(r.doc), ['a', 'b', 'c', 'd']);
  assert.equal(r.lost.items.length, 1);
});

test('a merged fixture board loads, draws its boxes and saves', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/boards/v1-every-item.json', import.meta.url), 'utf8'));
  const o = plain(fx); o.items = o.items.filter(it => it.id !== 'r1');        // the arrow's start was bound to r1
  const t = plain(fx); t.items.find(it => it.id === 'd2').text = 'Thinner section';
  t.items = t.items.filter(it => it.id !== 'd1');                            // the connector's start
  const r = M.three(fx, o, t);
  const scene = new D.Scene(r.doc);
  for (const it of scene.items) {
    const b = scene.bbox(it);
    assert.ok([b.x, b.y, b.x2, b.y2].every(Number.isFinite), it.id);
  }
  assert.equal(scene.get('d2').text, 'Thinner section');
  assert.equal(scene.get('c1'), undefined, 'the connector went with its node');
  assert.ok(scene.docText().length > 0);
});

test('render caches on an item do not count as a change', () => {
  const o = base(); Object.assign(o.items[0], { _b: { x: 0 }, _path: null, _json: null });
  assert.equal(three(base(), o, base()).changed, 0);
  assert.equal(M.canon(o.items[0]), M.canon(base().items[0]));
});

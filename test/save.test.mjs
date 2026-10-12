/* Saving: the open board's text is assembled from a copy each item keeps
   of its own (Scene.docText), so the save no longer re-serialises the
   whole board. The one thing that must never happen is a stale copy —
   these check the text against a fresh serialisation after every kind
   of edit the app makes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { core, load, inked } from './harness.mjs';

const D = core();
const fresh = s => JSON.stringify(s.toJSON());

function board() {
  const s = new D.Scene();
  s.begin('draw');
  s.add(D.make.stroke({ pts: inked([0, 0, 10.123, 5.006, 20, 9]) }));
  s.add(D.make.stroke({ pts: inked([50, 50, 60, 70]), color: '#e5484d' }));
  s.add(D.make.text({ x: 5, y: 5, text: 'hello' }));
  s.add(D.make.node({ x: 100, y: 100, text: 'step' }));
  s.commit();
  return s;
}

test('docText is what serialising toJSON gives', () => {
  const s = board();
  assert.equal(s.docText(), fresh(s));
  assert.equal(new D.Scene().docText(), '{"v":1,"items":[]}');
});

test('docText follows every kind of edit', () => {
  const s = board();
  const [a, b, t, n] = s.items;
  s.docText();                                   // every item now has its text

  s.begin('move'); s.translate(a, 3, 4); s.commit();
  assert.equal(s.docText(), fresh(s), 'translate');

  s.begin('drag'); s.touchMoved(b);
  for (let k = 0; k < b.pts.length; k += 3) b.pts[k] += 7;
  s.commit();
  assert.equal(s.docText(), fresh(s), 'drag');

  s.begin('style'); s.touch(t); t.color = '#4f6bff'; s.commit();
  assert.equal(s.docText(), fresh(s), 'restyle');

  s.begin('resize'); s.scaleItem(n, { x: 0, y: 0 }, 2, 2); s.commit();
  assert.equal(s.docText(), fresh(s), 'scale');

  s.undo(); s.undo();
  assert.equal(s.docText(), fresh(s), 'undo');
  s.redo();
  assert.equal(s.docText(), fresh(s), 'redo');

  s.begin('delete'); s.removeMany([a]); s.commit();
  assert.equal(s.docText(), fresh(s), 'delete');
  s.undo();
  assert.equal(s.docText(), fresh(s), 'undo delete');

  s.reorder([s.items[0]], 'front');
  assert.equal(s.docText(), fresh(s), 'reorder');

  s.load(JSON.parse(s.docText()));
  assert.equal(s.docText(), fresh(s), 'reload');
});

test('warmText fills every item in slices, then reports done', () => {
  const s = new D.Scene();
  for (let i = 0; i < 300; i++) s.add(D.make.stroke({ pts: inked([i, 0, i + 1, 1]) }));
  let budget = 0, rounds = 0;
  const deadline = { timeRemaining: () => (budget -= 1) };
  for (;;) {
    budget = 3; rounds++;
    if (s.warmText(deadline)) break;
    assert.ok(rounds < 100, 'warming never finishes');
  }
  assert.ok(rounds > 1, 'warming did not yield');
  assert.ok(s.items.every(it => it._json));
  assert.equal(s.docText(), fresh(s));
});

test('a board saved from text writes the same record as one saved from objects', async () => {
  const S = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'store.js');
  const store = S.store;
  /* ?scratch is the memory backend, which only takes objects — so a
     text-form board has to come out of the getter intact */
  await store.init();
  const s = new S.Scene();
  s.add(S.make.stroke({ pts: inked([0, 0, 1.234567, 2]) }));
  const b = store.newBoard('t');
  store.setDocBytes(b, s.docBytes(), s.items.length);
  /* the same record, though `doc` moves to the end */
  assert.deepEqual(JSON.parse(store.boardText(b)), JSON.parse(JSON.stringify(b)));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(store.boardBytes(b))), JSON.parse(JSON.stringify(b)));
  assert.equal(JSON.stringify(b.doc), JSON.stringify(s.toJSON()));
  await store.save(b, true);
  const list = await store.list();
  assert.equal(list[0].count, 1);
  b.doc = { v: 1, items: [] };                  // an ordinary doc again
  assert.equal(JSON.parse(store.boardText(b)).doc.items.length, 0);
});

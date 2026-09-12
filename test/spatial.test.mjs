/* The index exists to make redraws and hit tests cheap. The only thing
   that matters about it is that it never disagrees with the linear scan
   it replaced: an index that drops an item makes that item vanish from
   the board, which is worse than any slowness. So these tests do not
   assert on buckets or cell sizes — they assert the answers are the same
   ones the old code gave, across a lot of random scenes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { core, inked } from './harness.mjs';

const D = core();
const U = D.util;

/* deterministic PRNG, so a failure is reproducible from the seed alone */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function randomScene(rand, n) {
  const s = new D.Scene();
  for (let i = 0; i < n; i++) {
    const x = (rand() - 0.5) * 8000, y = (rand() - 0.5) * 8000;
    const r = rand();
    if (r < 0.45) {
      const pts = [];
      const len = 2 + Math.floor(rand() * 20);
      for (let k = 0; k < len; k++) pts.push(x + rand() * 200, y + rand() * 200, rand());
      s.add(D.make.stroke({ pts, size: 1 + rand() * 8 }));
    } else if (r < 0.7) {
      s.add(D.make.shape({ x, y, w: rand() * 400, h: rand() * 400, size: 1 + rand() * 4 }));
    } else if (r < 0.85) {
      s.add(D.make.note({ x, y, w: 190, h: 190, text: 'note ' + i }));
    } else if (r < 0.95) {
      // deliberately enormous: exercises the oversized-item path
      s.add(D.make.image({ x, y, w: 200 + rand() * 40000, h: 200 + rand() * 40000 }));
    } else {
      s.add(D.make.text({ x, y, w: 260, text: 'hello world ' + i }));
    }
  }
  return s;
}

const linear = (s, box) => s.items.filter(it => U.boxesOverlap(box, s.bbox(it)));

/* the modules run in a vm realm, so their arrays are not the host's Array —
   pull results into a host array before comparing structurally */
const ids = list => Array.from(list, i => i.id);

test('near() returns exactly what a linear scan returns, in the same order', () => {
  const rand = rng(20260912);
  for (let trial = 0; trial < 200; trial++) {
    const s = randomScene(rand, 1 + Math.floor(rand() * 120));
    for (let q = 0; q < 5; q++) {
      const x = (rand() - 0.5) * 9000, y = (rand() - 0.5) * 9000;
      const box = U.box(x, y, x + rand() * 3000, y + rand() * 3000);
      assert.deepEqual(ids(s.near(box)), ids(linear(s, box)),
        `trial ${trial} query ${q}`);
    }
  }
});

test('a query larger than the whole board still finds everything', () => {
  const s = randomScene(rng(7), 80);
  const all = s.near(U.box(-1e9, -1e9, 1e9, 1e9));
  assert.equal(all.length, s.items.length);
  assert.deepEqual(ids(all), ids(s.items));
});

test('an empty scene answers without blowing up', () => {
  const s = new D.Scene();
  assert.deepEqual(ids(s.near(U.box(0, 0, 100, 100))), []);
  assert.equal(s.hitTest(0, 0), null);
});

test('the index follows the scene through add, move and remove', () => {
  const s = new D.Scene();
  const box = U.box(0, 0, 50, 50);
  const note = D.make.note({ x: 1000, y: 1000, w: 100, h: 100 });
  s.add(note);
  assert.deepEqual(ids(s.near(box)), [], 'far away to start');

  s.translate(note, -1000, -1000);
  s.dirty(note);
  assert.deepEqual(ids(s.near(box)), [note.id], 'found after moving into range');

  s.remove(note);
  assert.deepEqual(ids(s.near(box)), [], 'gone after removal');
});

test('reordering changes paint order, not membership', () => {
  const s = new D.Scene();
  const a = s.add(D.make.note({ id: 'a', x: 0, y: 0, w: 100, h: 100 }));
  const b = s.add(D.make.note({ id: 'b', x: 10, y: 10, w: 100, h: 100 }));
  const box = U.box(0, 0, 200, 200);
  assert.deepEqual(ids(s.near(box)), ['a', 'b']);
  s.reorder([a], 'front');
  assert.deepEqual(ids(s.near(box)), ['b', 'a']);
});

test('undo puts items back where the index can find them', () => {
  const s = new D.Scene();
  const n = D.make.note({ x: 0, y: 0, w: 100, h: 100 });
  s.begin('add'); s.add(n); s.commit();
  const box = U.box(0, 0, 100, 100);
  assert.equal(s.near(box).length, 1);
  s.undo();
  assert.equal(s.near(box).length, 0, 'undone add leaves nothing behind');
  s.redo();
  assert.equal(s.near(box).length, 1, 'redo restores it');
});

test('hitTest picks the topmost item, as the reverse linear scan did', () => {
  const rand = rng(99);
  for (let trial = 0; trial < 120; trial++) {
    const s = randomScene(rand, 1 + Math.floor(rand() * 40));
    const x = (rand() - 0.5) * 6000, y = (rand() - 0.5) * 6000;
    let want = null;
    for (let i = s.items.length - 1; i >= 0; i--) {
      if (s.hitItem(s.items[i], x, y, 6)) { want = s.items[i]; break; }
    }
    const got = s.hitTest(x, y, 6);
    assert.equal(got ? got.id : null, want ? want.id : null, `trial ${trial}`);
  }
});

test('itemsCrossing matches the scan it replaced', () => {
  const rand = rng(1234);
  for (let trial = 0; trial < 60; trial++) {
    const s = randomScene(rand, 1 + Math.floor(rand() * 50));
    const path = [];
    for (let k = 0; k < 6; k++) path.push((rand() - 0.5) * 4000, (rand() - 0.5) * 4000);
    const rad = 2 + rand() * 20;
    const got = ids(s.itemsCrossing(path, rad, D.erasable));

    // the pre-index formulation, kept here as the oracle
    const box = U.boxFromPoints(path, 2, rad);
    const want = [];
    for (const it of s.items) {
      if (!D.erasable(it)) continue;
      const b = s.bbox(it);
      if (!U.boxesOverlap(box, b)) continue;
      const w = rad + (it.size || 2) / 2;
      if (U.polylineNear(path, s.outlinePoints(it), w)) want.push(it.id);
    }
    assert.deepEqual(got, want, `trial ${trial}`);
  }
});

test('itemsInBox honours the contain flag', () => {
  const s = new D.Scene();
  s.add(D.make.note({ id: 'inside', x: 10, y: 10, w: 20, h: 20 }));
  s.add(D.make.note({ id: 'straddling', x: 90, y: 90, w: 100, h: 100 }));
  const box = U.box(0, 0, 100, 100);
  assert.deepEqual(ids(s.itemsInBox(box, false)), ['inside', 'straddling']);
  assert.deepEqual(ids(s.itemsInBox(box, true)), ['inside']);
});

test('a stroke is found by the ink it covers, not just its corners', () => {
  const s = new D.Scene();
  // a long diagonal: its bbox spans many cells but the ink only touches a few
  const st = D.make.stroke({ pts: inked([0, 0, 2000, 2000]), size: 4 });
  s.add(st);
  assert.deepEqual(ids(s.near(U.box(900, 900, 1100, 1100))), [st.id]);
  assert.ok(s.hitTest(1000, 1000, 6), 'hit on the line');
  assert.equal(s.hitTest(1000, 200, 6), null, 'miss off the line');
});

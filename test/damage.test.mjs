/* Damage: the area of the board that changed since the painter last
   looked (Scene.takeDamage). The painter repaints only that rectangle, so
   the one rule that matters is that it never reports less than changed —
   anything it cannot account for has to come back as "everything". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { core, inked } from './harness.mjs';

const D = core();
const stroke = (x, y) => D.make.stroke({ pts: inked([x, y, x + 10, y + 10]), size: 2 });
const inside = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y && outer.x2 >= inner.x2 && outer.y2 >= inner.y2;

function board() {
  const s = new D.Scene();
  const a = s.add(stroke(0, 0)), b = s.add(stroke(500, 500));
  s.takeDamage();
  return { s, a, b };
}

test('removing a stroke damages where it was, and only there', () => {
  const { s, a, b } = board();
  const was = s.bbox(a);
  s.begin('erase'); s.remove(a); s.commit();
  const d = s.takeDamage();
  assert.ok(d && d !== true);
  assert.ok(inside(d, was));
  assert.ok(!inside(d, s.bbox(b)), 'the stroke left alone is outside it');
  assert.equal(s.takeDamage(), null, 'and it is handed over once');
});

test('the eraser cutting a stroke in two damages the old stroke and its pieces', () => {
  const { s, a } = board();
  const was = s.bbox(a);
  s.begin('erase');
  const idx = s.indexOf(a);
  s.remove(a);
  s.add(stroke(0, 0), idx); s.add(stroke(2, 2), idx);
  s.commit();
  const d = s.takeDamage();
  assert.ok(d !== true && inside(d, was));
});

test('moving a stroke damages where it was and where it went', () => {
  const { s, a } = board();
  const from = s.bbox(a);
  s.begin('move'); s.translate(a, 200, 0); s.commit();
  const d = s.takeDamage();
  assert.ok(d !== true && inside(d, from) && inside(d, s.bbox(a)));
});

test('anything that is not a stroke means everything', () => {
  const { s } = board();
  const n = s.add(D.make.note({ x: 10, y: 10 }));
  s.takeDamage();
  s.begin('style'); s.touch(n); n.color = '#fff'; s.commit();
  assert.equal(s.takeDamage(), true);
});

test('changes that do not report their area mean everything', () => {
  const { s, a } = board();
  s.begin('erase'); s.remove(a); s.commit();
  s.undo();
  assert.equal(s.takeDamage(), true, 'undo');
  s.reorder([s.items[0]], 'front');
  assert.equal(s.takeDamage(), true, 'reorder');
  s.load({ items: [] });
  assert.equal(s.takeDamage(), true, 'load');
});

test('removing many strokes at once damages all of them', () => {
  const { s, a, b } = board();
  const ba = s.bbox(a), bb = s.bbox(b);
  s.begin('erase'); s.removeMany([a, b]); s.commit();
  const d = s.takeDamage();
  assert.ok(d !== true && inside(d, ba) && inside(d, bb));
});

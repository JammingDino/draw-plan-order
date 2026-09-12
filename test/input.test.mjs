/* Deciding what a pointer event means. The eraser end of a stylus is the
   fiddly one: it arrives as an ordinary pen carrying the X2 button, and it
   carries it while merely hovering as well as while pressed — which is the
   whole reason the size preview can appear before anything is rubbed out. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const U = load('util.js').util;

/* the shape of a PointerEvent, as far as this predicate cares */
const ev = o => Object.assign({ pointerType: 'pen', buttons: 0, button: -1 }, o);

test('the eraser end is recognised while pressed', () => {
  assert.ok(U.isEraserEnd(ev({ buttons: 32, button: 5 })), 'pointerdown');
  assert.ok(U.isEraserEnd(ev({ buttons: 32, button: -1 })), 'pointermove while erasing');
});

test('the eraser end is recognised while only hovering', () => {
  // no button is down, but the digitiser still reports which end is in range
  assert.ok(U.isEraserEnd(ev({ buttons: 32, button: -1 })));
});

test('button 5 counts even if buttons has not caught up', () => {
  assert.ok(U.isEraserEnd(ev({ buttons: 0, button: 5 })));
});

test('an engine reporting pointerType eraser is believed', () => {
  assert.ok(U.isEraserEnd(ev({ pointerType: 'eraser', buttons: 1 })));
  assert.ok(U.isEraserEnd(ev({ pointerType: 'eraser', buttons: 0, button: -1 })));
});

test('the writing end of the same stylus is not the eraser', () => {
  assert.ok(!U.isEraserEnd(ev({ buttons: 1, button: 0 })), 'drawing');
  assert.ok(!U.isEraserEnd(ev({ buttons: 0, button: -1 })), 'hovering the nib');
  assert.ok(!U.isEraserEnd(ev({ buttons: 2, button: 1 })), 'the barrel button');
});

test('a mouse is never the eraser end, whatever it is holding down', () => {
  for (const buttons of [0, 1, 2, 4, 32]) {
    assert.ok(!U.isEraserEnd(ev({ pointerType: 'mouse', buttons })), `buttons ${buttons}`);
  }
  assert.ok(!U.isEraserEnd(ev({ pointerType: 'mouse', button: 5 })), 'a mouse X2 button is not an eraser');
});

test('touch is never the eraser end', () => {
  assert.ok(!U.isEraserEnd(ev({ pointerType: 'touch', buttons: 1 })));
  assert.ok(!U.isEraserEnd(ev({ pointerType: 'touch', buttons: 32 })));
});

test('a pen holding the barrel button and the eraser end still erases', () => {
  // buttons is a bitmask: barrel (2) plus eraser (32)
  assert.ok(U.isEraserEnd(ev({ buttons: 34 })));
});

test('a missing or partial event does not throw', () => {
  assert.equal(U.isEraserEnd(null), false);
  assert.equal(U.isEraserEnd(undefined), false);
  assert.equal(U.isEraserEnd({}), false);
  assert.equal(U.isEraserEnd({ pointerType: 'pen' }), false, 'no buttons field at all');
});

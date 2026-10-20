/* Finger taps (taps.js): two fingers undo, three redo, two held still keep
   undoing — and none of it may fire for the pinches and pans that start
   exactly the same way. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'camera.js', 'taps.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function rig() {
  let t = 1000;
  const log = [];
  const camera = new D.Camera();
  const app = {
    camera, undone: 0, redone: 0, left: 5,
    undo() { if (!this.left) return null; this.left--; this.undone++; return { label: 'draw' }; },
    redo() { this.redone++; return { label: 'draw' }; },
    requestDraw() {}, flash(s) { log.push(s); }
  };
  const taps = new D.Taps(app, () => t);
  const ev = (id, x, y, type = 'touch') => ({ pointerId: id, clientX: x, clientY: y, pointerType: type });
  return { app, taps, log, ev, at: ms => { t += ms; } };
}

test('two fingers tapped together undo, and say what they undid', () => {
  const { app, taps, log, ev, at } = rig();
  taps.down(ev(1, 100, 100)); at(20); taps.down(ev(2, 160, 110));
  at(90); taps.up(ev(1, 101, 100)); at(10); taps.up(ev(2, 160, 111));
  assert.equal(app.undone, 1);
  assert.deepEqual(log, ['Undo stroke']);
});

test('three fingers tapped together redo', () => {
  const { app, taps, ev, at } = rig();
  for (const id of [1, 2, 3]) { taps.down(ev(id, id * 50, 100)); at(15); }
  at(80);
  for (const id of [1, 2, 3]) { taps.up(ev(id, id * 50, 100)); at(5); }
  assert.equal(app.redone, 1);
  assert.equal(app.undone, 0);
});

test('the view goes back to where the fingers found it', () => {
  const { app, taps, ev, at } = rig();
  app.camera.x = 10; app.camera.y = 20; app.camera.zoom = 1.5;
  taps.down(ev(1, 100, 100)); taps.down(ev(2, 160, 100));
  app.camera.panBy(3, -2); app.camera.zoom = 1.52;      // what the pinch did with the jitter
  at(100); taps.up(ev(1, 100, 100)); taps.up(ev(2, 160, 100));
  assert.deepEqual([app.camera.x, app.camera.y, app.camera.zoom], [10, 20, 1.5]);
});

test('pinches, pans and slow taps are left alone', () => {
  const cases = {
    'a pinch': ({ taps, ev, at }) => {
      taps.down(ev(1, 100, 100)); taps.down(ev(2, 200, 100));
      at(60); taps.move(ev(2, 240, 100));
      at(60); taps.up(ev(1, 100, 100)); taps.up(ev(2, 240, 100));
    },
    'a two-finger pan': ({ taps, ev, at }) => {
      taps.down(ev(1, 100, 100)); taps.down(ev(2, 150, 100));
      at(50); taps.move(ev(1, 100, 130)); taps.move(ev(2, 150, 130));
      at(50); taps.up(ev(1, 100, 130)); taps.up(ev(2, 150, 130));
    },
    'two fingers resting too long': ({ taps, ev, at }) => {
      taps.down(ev(1, 100, 100)); taps.down(ev(2, 150, 100));
      at(D.Taps.TAP_MS + 50); taps.up(ev(1, 100, 100)); taps.up(ev(2, 150, 100));
    },
    'a second finger landing late': ({ taps, ev, at }) => {
      taps.down(ev(1, 100, 100)); at(250); taps.down(ev(2, 150, 100));
      at(30); taps.up(ev(1, 100, 100)); taps.up(ev(2, 150, 100));
    },
    'one finger': ({ taps, ev, at }) => { taps.down(ev(1, 100, 100)); at(60); taps.up(ev(1, 100, 100)); },
    'a pen joining in': ({ taps, ev, at }) => {
      taps.down(ev(1, 100, 100)); taps.down(ev(9, 300, 300, 'pen')); taps.down(ev(2, 150, 100));
      at(60); taps.up(ev(1, 100, 100)); taps.up(ev(2, 150, 100));
    },
    'a touch the system cancelled': ({ taps, ev, at }) => {
      taps.down(ev(1, 100, 100)); taps.down(ev(2, 150, 100));
      at(60); taps.up(ev(1, 100, 100), true); taps.up(ev(2, 150, 100));
    }
  };
  for (const [name, run] of Object.entries(cases)) {
    const r = rig();
    run(r);
    assert.equal(r.app.undone + r.app.redone, 0, name);
  }
});

test('two fingers held still keep undoing, and lifting them adds no extra undo', async () => {
  const { app, taps, ev, at } = rig();
  app.left = 50;
  taps.down(ev(1, 100, 100)); taps.down(ev(2, 150, 100));
  await sleep(D.Taps.HOLD_MS + 700);
  const held = app.undone;
  assert.ok(held >= 3, `undid ${held} while held`);
  at(2000); taps.up(ev(1, 100, 100)); taps.up(ev(2, 150, 100));
  await sleep(300);
  assert.equal(app.undone, held, 'nothing more after letting go');
});

test('holding stops when there is nothing left to undo, or a finger moves', async () => {
  const a = rig();
  a.app.left = 2;
  a.taps.down(a.ev(1, 100, 100)); a.taps.down(a.ev(2, 150, 100));
  await sleep(D.Taps.HOLD_MS + 600);
  assert.equal(a.app.undone, 2);
  a.taps.up(a.ev(1, 100, 100)); a.taps.up(a.ev(2, 150, 100));

  const b = rig();
  b.app.left = 50;
  b.taps.down(b.ev(1, 100, 100)); b.taps.down(b.ev(2, 150, 100));
  await sleep(D.Taps.HOLD_MS + 100);
  b.taps.move(b.ev(1, 100, 160));                       // started pinching after all
  const at = b.app.undone;
  await sleep(500);
  assert.equal(b.app.undone, at);
  b.taps.up(b.ev(1, 100, 160)); b.taps.up(b.ev(2, 150, 100));
});

test('turned off in Settings, two fingers tapped (or a resting hand) undo nothing, and nor does holding them', async () => {
  const { app, taps, log, ev, at } = rig();
  app.opts = { general: { tapUndo: false } };
  taps.down(ev(1, 100, 100)); at(20); taps.down(ev(2, 160, 110));
  at(90); taps.up(ev(1, 101, 100)); at(10); taps.up(ev(2, 160, 111));
  for (const id of [1, 2, 3]) { taps.down(ev(id, id * 50, 100)); at(15); }
  for (const id of [1, 2, 3]) { taps.up(ev(id, id * 50, 100)); at(5); }
  taps.down(ev(4, 100, 100)); taps.down(ev(5, 160, 100));
  await sleep(D.Taps.HOLD_MS + 400);
  taps.up(ev(4, 100, 100)); taps.up(ev(5, 160, 100));
  assert.equal(app.undone, 0); assert.equal(app.redone, 0);
  assert.deepEqual(log, []);
  // and back on, as before
  app.opts.general.tapUndo = true;
  taps.down(ev(1, 100, 100)); at(20); taps.down(ev(2, 160, 110));
  at(90); taps.up(ev(1, 101, 100)); at(10); taps.up(ev(2, 160, 111));
  assert.equal(app.undone, 1);
});

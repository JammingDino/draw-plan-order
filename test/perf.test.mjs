/* The frame counter's ring buffer. Circular indexing is easy to get
   subtly wrong, and a measuring instrument that lies about the numbers is
   worse than no instrument at all. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeApp } from './harness.mjs';

const D = load('util.js', 'perf.js');
const Ring = D.Perf.Ring;

test('an empty ring reports zeroes rather than NaN', () => {
  const r = new Ring(8);
  assert.equal(r.n(), 0);
  assert.equal(r.mean(), 0);
  assert.equal(r.max(), 0);
  assert.equal(r.p95(), 0);
});

test('a partly filled ring reads oldest first', () => {
  const r = new Ring(8);
  for (const v of [1, 2, 3]) r.push(v);
  assert.equal(r.n(), 3);
  assert.deepEqual([r.at(0), r.at(1), r.at(2)], [1, 2, 3]);
  assert.equal(r.mean(), 2);
  assert.equal(r.max(), 3);
});

test('a wrapped ring keeps the newest values, still oldest first', () => {
  const r = new Ring(4);
  for (const v of [1, 2, 3, 4, 5, 6]) r.push(v);
  assert.equal(r.n(), 4);
  assert.deepEqual([r.at(0), r.at(1), r.at(2), r.at(3)], [3, 4, 5, 6],
    'the two oldest fell off the back');
  assert.equal(r.mean(), 4.5);
  assert.equal(r.max(), 6);
});

test('the ring never grows past its capacity', () => {
  const r = new Ring(16);
  for (let i = 0; i < 1000; i++) r.push(i);
  assert.equal(r.n(), 16);
  assert.equal(r.at(15), 999, 'newest');
  assert.equal(r.at(0), 984, 'oldest still held');
});

test('p95 reports a tail, not an average', () => {
  const r = new Ring(100);
  for (let i = 0; i < 99; i++) r.push(8);
  r.push(500);                                  // one bad frame
  assert.equal(r.mean() < 20, true, 'the average hides it');
  assert.equal(r.max(), 500, 'the worst does not');
  assert.ok(r.p95() >= 8, 'and p95 sits in the tail');
});

test('a single sample is its own mean, max and p95', () => {
  const r = new Ring(10);
  r.push(12.5);
  assert.equal(r.mean(), 12.5);
  assert.equal(r.max(), 12.5);
  assert.equal(r.p95(), 12.5);
});

/* Driving the overlay itself. It cannot be asserted on pixel by pixel, but
   it can be made to run a few hundred frames without throwing and to report
   numbers that match what it was fed — which is the whole job. */


const boot = () => {
  const P = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'perf.js');
  const app = fakeApp(P);
  const perf = new P.Perf(app);
  return { P, app, perf };
};

test('the overlay stays off until it is asked for', () => {
  const { app, perf } = boot();
  assert.equal(perf.on, false);
  perf.frameStart(); perf.mark('base'); perf.frameEnd();
  assert.equal(perf.gap.n(), 0, 'measures nothing while off');
  assert.equal(app.scheduled, undefined, 'and does not drive the frame loop');
});

test('toggling on mounts a readout and starts the loop', () => {
  const { app, perf } = boot();
  perf.toggle();
  assert.equal(perf.on, true);
  assert.ok(perf.el, 'mounted');
  assert.ok(app.scheduled >= 1, 'asked for a frame');
  perf.toggle();
  assert.equal(perf.on, false);
  assert.equal(perf.el, null, 'and cleans up after itself');
});

test('it survives a few hundred frames of being measured', () => {
  const { P, app, perf } = boot();
  for (let i = 0; i < 40; i++) app.scene.add(P.make.note({ x: i * 10, y: 0, w: 50, h: 50 }));
  perf.toggle();
  for (let f = 0; f < 300; f++) {
    perf.frameStart();
    perf.drawn = 12;
    perf.mark('base');
    perf.mark('live');
    perf.frameEnd();
  }
  assert.equal(perf.gap.n(), 120, 'history is capped at its window');
  assert.ok(perf.pre.textContent.includes('fps'), 'the readout says something');
  assert.ok(perf.pre.textContent.includes('12/40 items drawn'), 'including what it drew');
});

test('the readout reflects the timings it was given', () => {
  const { perf } = boot();
  perf.toggle();
  // frameStart derives the gap from the wall clock, so drive the rings directly
  for (let i = 0; i < 10; i++) { perf.gap.push(20); perf.base.push(5); perf.live.push(3); }
  perf.render();
  const txt = perf.pre.textContent;
  assert.ok(/ 50 fps/.test(txt), `50fps from a 20ms frame: ${txt.split('\n')[0]}`);
  assert.ok(/other\s+12/.test(txt), `20 - 5 - 3 = 12ms unaccounted: ${txt}`);
});

test('a board with no frames yet does not divide by zero', () => {
  const { perf } = boot();
  perf.toggle();
  perf.render();
  assert.ok(perf.pre.textContent.includes('0 fps'));
});

/* Low-latency ink (Renderer.inkWorld/retireInk, PenTool.paint, App.frame):
   an opaque pen stroke goes on its own layer, which is the only one that
   may skip the compositor, which is only ever added to while the pen is
   down, and which keeps a finished stroke until the scene showing it has
   been on screen — so nothing on it can be caught half redrawn, and a
   stroke never blinks as the pen lifts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeApp } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js');

/* a renderer stand-in that records which layer each thing went to */
function rig() {
  const log = [];
  const layer = name => new Proxy({}, {
    get: (t, k) => k in t ? t[k] : (...a) => { if (k === 'fill' || k === 'clearRect') log.push(name + ':' + String(k)); },
    set: (t, k, v) => (t[k] = v, true)
  });
  const ink = layer('ink'), live = layer('live');
  const app = fakeApp(D, {
    opts: { general: {}, pen: { color: 'ink', size: 3, alpha: 1, thinning: 0.5, smooth: 0 }, highlighter: { color: '#ffe066', size: 22, alpha: 0.4, smooth: 0 } },
    requestDraw() {}, requestDrawLive() {}, afterEdit() {}, hideHint() {}, haptic() {}, hint() {},
    renderer: {
      inkRetire: 0,
      inkWorld: () => ink, liveWorld: () => live,
      clearLive() { log.push('live:clear'); }, clearInk() { this.inkRetire = 0; log.push('ink:clear'); },
      retireInk() { this.inkRetire = 3; log.push('ink:retire'); },
      blendFor: () => 'source-over', drawItem() {}
    }
  });
  return { app, log, r: app.renderer };
}
const at = (x, y) => ({ x, y, sx: x, sy: y, pressure: 0.5 });
const scribbleFree = ev => ({ ...at(ev[0], ev[1]), samples: [at(ev[0] - 10, ev[1]), at(ev[0], ev[1])] });

test('an opaque pen stroke is drawn on the ink layer, and that layer is never cleared while the pen is down', () => {
  const { app, log, r } = rig();
  const pen = new D.tools.PenTool(app, 'pen');
  pen.down(at(0, 0));
  for (let x = 10; x <= 60; x += 10) { pen.move(scribbleFree([x, x / 3])); pen.paint(r); }
  assert.ok(log.filter(l => l === 'ink:fill').length >= 5, 'ink added to the ink layer');
  assert.ok(!log.includes('ink:clear') && !log.includes('ink:clearRect'), 'and nothing taken off it');
  assert.ok(!log.includes('live:fill'), 'the live layer is not drawn on');
});

test('lifting the pen retires the ink rather than wiping it, so the stroke never blinks', () => {
  const { app, log, r } = rig();
  const pen = new D.tools.PenTool(app, 'pen');
  pen.down(at(0, 0));
  pen.move(scribbleFree([40, 10])); pen.paint(r);
  log.length = 0;
  pen.up(at(40, 10));
  assert.ok(log.includes('ink:retire'));
  assert.ok(!log.includes('ink:clear'), 'not wiped before the scene has it');
  assert.equal(app.scene.items.length, 1, 'and it is in the scene');
});

test('the highlighter is drawn whole on the composited layer, never the ink layer', () => {
  const { app, log, r } = rig();
  const hl = new D.tools.PenTool(app, 'highlighter');
  hl.down(at(0, 0));
  hl.move(scribbleFree([40, 0])); hl.paint(r);
  assert.ok(log.includes('live:fill'));
  assert.ok(!log.includes('ink:fill'));
});

test('a stroke snapped to a shape moves to the live layer, and its ink is retired, not wiped', () => {
  const { app, log, r } = rig();
  const pen = new D.tools.PenTool(app, 'pen');
  pen.down(at(0, 0));
  pen.move(scribbleFree([40, 0])); pen.paint(r);
  pen.snapped = { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 };
  log.length = 0;
  pen.paint(r);
  assert.ok(log.includes('ink:retire'));
  assert.ok(!log.includes('ink:clear'));
});

test('a stroke given up (a second finger, a cancelled gesture) is wiped at once', () => {
  const { app, log } = rig();
  const pen = new D.tools.PenTool(app, 'pen');
  pen.down(at(0, 0));
  pen.cancel();
  assert.ok(log.includes('ink:clear'));
});

test('only the ink layer asks to skip the compositor; the scene and the live layer stay composited', () => {
  const asked = [];
  const R = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', g => {
    const make = g.document.createElement;
    g.document.getElementById = id => {
      const el = make(id);
      el.getContext = (kind, attrs) => { asked.push([id, attrs]); return { getContextAttributes: () => attrs || {} }; };
      return el;
    };
  }, 'render.js');
  const r = new R.Renderer({ camera: { zoom: 1, x: 0, y: 0 }, requestDraw() {} });
  assert.equal(r.lowLatency, true);
  assert.equal(asked.find(([id]) => id === 'ink')[1].desynchronized, true);
  for (const id of ['base', 'live']) assert.ok(!(asked.find(([i]) => i === id)[1] || {}).desynchronized, id + ' stays composited');
});

test('a retired stroke is wiped a few frames later, not while another is being written', async () => {
  const A = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
    }, 'app.js');
  const app = A.app, r = app.renderer;
  let wiped = 0;
  r.clearInk = function () { this.inkRetire = 0; wiped++; };
  app.perf = null;
  r.retireInk();
  app.frame();
  assert.equal(wiped, 0, 'still there the first frame');
  // a new stroke started: it waits
  app.tool = { incremental: true, item: {}, paint() {} };
  app.frame(); app.frame(); app.frame();
  assert.equal(wiped, 0, 'kept while the pen writes the next one');
  app.tool = app.tools.pen;
  app.frame(); app.frame();
  assert.equal(wiped, 1, 'gone once it is safe');
});

/* Drawing ahead of the pen (PenTool.paintAhead, Renderer.paintAhead): the
   pointer's predicted positions carry the live stroke on towards the nib,
   from where the stroke ends, never further than AHEAD_PX on screen, and
   never into the stroke that is saved. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeApp } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js');
const AHEAD_PX = 24;

function rig(zoom = 1) {
  const drawn = [];
  const app = fakeApp(D, {
    camera: { zoom, x: 0, y: 0 },
    opts: { general: {}, pen: { color: 'ink', size: 3, alpha: 1, thinning: 0.5, smooth: 0 } },
    requestDraw() {}, requestDrawLive() {}, afterEdit() {}, hideHint() {},
    renderer: {
      cleared: 0,
      clearLive() {}, clearAhead() { this.cleared++; },
      paintAhead(item, pts) { drawn.push(pts.slice()); },
      liveWorld: () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => {}, set: (t, k, v) => (t[k] = v, true) }),
      blendFor: () => 'source-over'
    }
  });
  const pen = new D.tools.PenTool(app, 'pen');
  return { app, pen, drawn };
}
const at = (x, y) => ({ x, y, sx: x, sy: y, pressure: 0.5 });

test('the predicted points carry on from the end of the stroke', () => {
  const { pen, app, drawn } = rig();
  pen.down(at(0, 0));
  pen.move({ ...at(30, 0), samples: [at(10, 0), at(20, 0), at(30, 0)], predicted: [at(34, 0), at(38, 0)] });
  pen.paint(app.renderer);
  assert.equal(drawn.length, 1);
  const pts = [...drawn[0]], stroke = [...pen.item.pts];
  // it starts on the stroke's own last points, then goes on to the prediction
  assert.deepEqual(pts.slice(0, -6), stroke.slice(-(pts.length - 6)));
  assert.deepEqual(pts.slice(-6, -4), [34, 0]);
  assert.deepEqual(pts.slice(-3, -1), [38, 0]);
});

test('a prediction never runs more than AHEAD_PX past the stroke, at any zoom', () => {
  for (const zoom of [0.5, 1, 3]) {
    const { pen, app, drawn } = rig(zoom);
    pen.down(at(0, 0));
    pen.move({ ...at(30, 0), samples: [at(10, 0), at(20, 0), at(30, 0)], predicted: [at(130, 0), at(400, 0)] });
    pen.paint(app.renderer);
    const pts = drawn[0], stroke = pen.item.pts;
    const endX = stroke[stroke.length - 3], last = pts[pts.length - 3];
    assert.ok(Math.abs(last - endX - AHEAD_PX / zoom) < 1e-9, `zoom ${zoom}: ran ${last - endX}`);
  }
});

test('the prediction is never part of the saved stroke', () => {
  const { pen, app } = rig();
  pen.down(at(0, 0));
  pen.move({ ...at(30, 0), samples: [at(10, 0), at(20, 0), at(30, 0)], predicted: [at(60, 0)] });
  pen.paint(app.renderer);
  pen.up(at(30, 0));
  const s = app.scene.items[0];
  let maxX = -Infinity;
  for (let i = 0; i < s.pts.length; i += 3) maxX = Math.max(maxX, s.pts[i]);
  assert.ok(maxX <= 30, `the stroke reaches ${maxX}, past the last real sample`);
});

test('no prediction, nothing drawn ahead, and what was there is wiped', () => {
  const { pen, app, drawn } = rig();
  pen.down(at(0, 0));
  pen.move({ ...at(30, 0), samples: [at(10, 0), at(20, 0), at(30, 0)] });
  pen.paint(app.renderer);
  assert.equal(drawn.length, 0);
  assert.ok(app.renderer.cleared > 0);
});

test('the highlighter, drawn whole each frame, is not drawn ahead', () => {
  const { app, drawn } = rig();
  app.opts.highlighter = { color: '#ffe066', size: 22, alpha: 0.4, smooth: 0 };
  const hl = new D.tools.PenTool(app, 'highlighter');
  hl.down(at(0, 0));
  hl.move({ ...at(30, 0), samples: [at(10, 0), at(20, 0), at(30, 0)], predicted: [at(40, 0)] });
  hl.paint(app.renderer);
  assert.equal(drawn.length, 0);
});

test('the renderer asks for a desynchronized live layer unless turned off', () => {
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
  const live = asked.find(([id]) => id === 'live');
  assert.equal(live[1].desynchronized, true);
  assert.equal(asked.find(([id]) => id === 'base')[1], undefined, 'the scene layer stays composited');
});

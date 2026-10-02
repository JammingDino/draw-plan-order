/* The eraser applies each stretch of its path once, as it arrives. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeApp, inked } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'tools.js');

function rig(mode) {
  const app = fakeApp(D, {
    opts: { eraser: { mode, size: 10 } },
    requestDraw() {}, requestDrawLive() {}, afterEdit() {},
    renderer: { clearLive() {} }
  });
  const tool = new D.tools.EraserTool(app);
  const at = (x, y) => ({ x, y });
  const move = (...pts) => tool.move({ samples: pts.map(([x, y]) => at(x, y)) });
  return { app, tool, at, move };
}

test('a fast pen does not jump over ink between samples', () => {
  const { app, tool, at, move } = rig('object');
  app.scene.add(D.make.stroke({ pts: inked([50, 0, 50, 100]) }));
  tool.down(at(0, 50));
  // one pointer move carrying ten coalesced samples, the ink under the third
  move(...Array.from({ length: 10 }, (_, i) => [10 + i * 10, 50]));
  tool.up();
  assert.equal(app.scene.items.length, 0);
});

test('a long pixel-erase cuts each stroke where it was crossed, and only there', () => {
  const { app, tool, at, move } = rig('partial');
  app.scene.add(D.make.stroke({ pts: inked([0, 0, 0, 100, 0, 200, 0, 300]) }));
  tool.down(at(-30, 50));
  move([30, 50]);                         // first cut, across y = 50
  move([30, 120], [30, 200]);             // down the side, clear of the ink
  move([-30, 250]);                       // second cut, across x = 0 at y = 225
  tool.up();
  const parts = app.scene.items.map(it => {
    const ys = []; for (let i = 1; i < it.pts.length; i += 3) ys.push(it.pts[i]);
    return [Math.min(...ys), Math.max(...ys)];
  }).sort((a, b) => a[0] - b[0]);
  assert.equal(parts.length, 3, 'two cuts make three pieces');
  assert.ok(parts[0][1] < 50 && parts[1][0] > 50 && parts[1][1] < 225 && parts[2][0] > 225, JSON.stringify(parts));
  // one undo step puts the whole stroke back
  app.scene.undo();
  assert.equal(app.scene.items.length, 1);
});

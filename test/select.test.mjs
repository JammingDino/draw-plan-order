/* The select tool over a PDF page or a picture. Those are hit by their
   whole area, so the page used to be what moved whenever you pressed in
   the gaps between the notes written on it. Now a quick drag over one
   selects what is on it, a tap selects it, and press-and-hold moves it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeApp, inked } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'tools.js');
const ids = a => [...a].map(i => i.id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function rig() {
  const app = fakeApp(D, {
    selection: [], opts: { general: {} }, toasts: [],
    select(items) { this.selection = items.filter(Boolean); },
    selectionBounds() { let b = null; for (const it of this.selection) b = D.util.unionBox(b, this.scene.bbox(it)); return b; },
    requestDraw() {}, requestDrawLive() {}, afterEdit() {}, toast(m) { this.toasts.push(m); },
    renderer: { clearLive() {}, handleRects: () => [] }
  });
  const page = app.scene.add(D.make.pdfpage({ asset: 'a', page: 1, x: 0, y: 0, w: 600, h: 800 }));
  const ink = app.scene.add(D.make.stroke({ pts: inked([100, 100, 200, 110, 300, 100]), size: 3 }));
  const tool = new D.tools.SelectTool(app, false);
  const at = (x, y, o = {}) => ({ x, y, sx: x, sy: y, samples: [], ...o });
  return { app, page, ink, tool, at };
}

test('a quick drag over a page draws a marquee and leaves the page where it is', () => {
  const { app, page, ink, tool, at } = rig();
  tool.down(at(60, 60));
  tool.move(at(200, 120)); tool.move(at(350, 150));
  tool.up(at(350, 150));
  assert.deepEqual(ids(app.selection), ids([ink]), 'the ink written on the page is selected');
  assert.equal(page.x, 0); assert.equal(page.y, 0);
});

test('a tap on a page selects it, and a drag then moves it straight away', () => {
  const { app, page, tool, at } = rig();
  tool.down(at(400, 500)); tool.up(at(400, 500));
  assert.deepEqual(ids(app.selection), ids([page]));
  tool.down(at(400, 500)); tool.move(at(430, 540)); tool.up(at(430, 540));
  assert.equal(page.x, 30); assert.equal(page.y, 40);
});

test('press and hold picks the page up', async () => {
  const { app, page, tool, at } = rig();
  tool.down(at(400, 500));
  await sleep(340);
  assert.deepEqual(ids(app.selection), ids([page]), 'picked up: selected before it moves');
  tool.move(at(410, 520)); tool.up(at(410, 520));
  assert.equal(page.x, 10); assert.equal(page.y, 20);
});

test('ink on a page is grabbed even a little way off the line', () => {
  const { app, page, ink, tool, at } = rig();
  tool.down(at(200, 122));                     // 12px under the stroke
  tool.move(at(220, 142)); tool.up(at(220, 142));
  assert.deepEqual(ids(app.selection), ids([ink]));
  assert.equal(page.x, 0, 'the page stayed put');
  assert.equal(Math.round(ink.pts[0]), 120, 'the ink moved');
});

test('something underneath a page is not reached through it', () => {
  const { app, page, tool, at } = rig();
  const under = app.scene.add(D.make.stroke({ pts: inked([380, 480, 420, 480]), size: 3 }), 0);
  tool.down(at(400, 490)); tool.up(at(400, 490));
  assert.deepEqual(ids(app.selection), ids([page]));
  assert.notDeepEqual(ids(app.selection), ids([under]));
});

test('an image behaves like a page', () => {
  const { app, tool, at } = rig();
  const pic = app.scene.add(D.make.image({ x: 1000, y: 0, w: 300, h: 200, src: 'x' }));
  tool.down(at(1100, 100)); tool.move(at(1200, 150)); tool.up(at(1200, 150));
  assert.equal(pic.x, 1000, 'a quick drag does not move it');
});

test('cancelling a press on a page leaves no hold waiting to fire', async () => {
  const { app, tool, at } = rig();
  tool.down(at(400, 500)); tool.cancel();
  await sleep(340);
  assert.deepEqual(ids(app.selection), ids([]));
});

/* Cropping a picture: `crop` is the part shown, as fractions of the whole
   picture as stored; the box is what shows, and the whole picture lies
   round it to be brought back. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function rig(items = D => []) {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  const made = items(D);
  for (const it of made) app.scene.add(it);
  return { D, app, scene: app.scene, made };
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the whole picture lies round the part that shows, mirrored with it', () => {
  const { D } = rig();
  const it = { x: 100, y: 0, w: 50, h: 100, crop: [0.5, 0, 1, 1] };
  assert.deepEqual({ ...D.wholeOf(it) }, { x: 50, y: 0, w: 100, h: 100 });
  it.flipX = true;
  assert.deepEqual([...D.shownCrop(it)], [0, 0, 0.5, 1], 'flipped, the right half shows on the left');
  assert.equal(D.wholeOf(it).x, 100);
  D.setShownCrop(it, [0, 0, 1, 1]);
  assert.equal(it.crop, undefined, 'all of it shown is no crop at all');
});

test('a handle crops in crop mode, and stretches out of it', () => {
  const { D, app, made: [img] } = rig(D => [D.make.image({ x: 0, y: 0, w: 400, h: 200 })]);
  app.startCrop(img);
  assert.equal(app.cropping, img);
  const tool = app.tools.select;
  tool.mode = 'resize'; tool.handle = 'e'; tool.grabOff = { x: 0, y: 0 }; tool.snapshot = [D.clone(img)];
  app.scene.begin('resize'); app.scene.touch(img);
  tool.cropMove({ x: 100, y: 50 });
  app.scene.commit();
  assert.equal(img.w, 100); assert.equal(img.x, 0);
  assert.deepEqual([...img.crop], [0, 0, 0.25, 1]);
  tool.snapshot = [D.clone(img)];
  tool.cropMove({ x: 900, y: 50 });
  assert.equal(img.w, 400, 'no further out than the picture goes');
  app.undo();
  app.select([]);
  assert.equal(app.cropping, null, 'selecting something else ends it');
});

test('Show it all puts the whole picture back where it lay, turned or not', () => {
  const { D, app, made: [img] } = rig(D => [D.make.image({ x: 100, y: 0, w: 100, h: 100, crop: [0.5, 0, 1, 1], rot: Math.PI / 2 })]);
  app.uncrop(img);
  assert.equal(img.crop, undefined);
  assert.equal(img.w, 200);
  // turned a quarter, the left half that came back lies above
  assert.ok(near(img.x + img.w / 2, 150) && near(img.y + img.h / 2, 0), `${img.x}, ${img.y}`);
});

test('a cropped picture exports clipped to its box', async () => {
  const { app } = rig(D => [D.make.image({ src: '', x: 0, y: 0, w: 100, h: 100, crop: [0.25, 0, 0.75, 1] })]);
  const svg = await app.renderer.toSVG(app.scene, app.scene.contentBounds(), { theme: 'light', dark: false, transparent: true });
  assert.match(svg, /<clipPath id="c[^"]*"><rect x="0" y="0" width="100" height="100"\/>/);
  assert.match(svg, /<image x="-50" y="0" width="200" height="100"/);
});

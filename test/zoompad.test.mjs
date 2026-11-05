/* The zoom pad (js/zoompad.js): what is written large in the strip goes on
   the board small, in the box the strip shows; written up to the strip's
   end, the box moves on along the line. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function rig() {
  const made = [];
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
      g.ResizeObserver = class { observe() {} disconnect() {} };
      // the strip is 900 × 240 on screen, from the window's corner; its listeners are kept to call
      const mk = g.document.createElement;
      g.document.createElement = tag => {
        const el = mk(tag), on = {};
        el.on = on;
        el.addEventListener = (t, fn) => { on[t] = fn; };
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 240 });
        el.setPointerCapture = () => {};
        el.offsetHeight = 280;
        made.push(el);
        return el;
      };
    }, 'press.js', 'zoompad.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  app.camera.x = 0; app.camera.y = 0; app.camera.zoom = 1;
  return { D, app, canvas: () => made.find(e => e.tagName === 'CANVAS') };
}
const pe = (x, y, over = {}) => ({ clientX: x, clientY: y, pointerId: 4, pointerType: 'pen', button: 0, buttons: 1, pressure: 0.5, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, ...over });

test('written in the strip, it lands on the board in the box, at a third of the size', () => {
  const { D, app, canvas } = rig();
  app.setTool('pen');
  D.zoompad.open(app);
  const b = { ...D.zoompad.box() }, cv = canvas();
  assert.equal(b.w, 300, 'three times larger: the box is a third of the strip');
  cv.on.pointerdown(pe(90, 60));
  for (let i = 1; i <= 10; i++) cv.on.pointermove(pe(90 + i * 6, 60 + i * 6));
  cv.on.pointerup(pe(150, 120));
  const s = app.scene.items.find(i => i.type === 'stroke');
  assert.ok(s, 'a stroke on the board');
  assert.ok(Math.abs(s.pts[0] - (b.x + 30)) < 1e-6 && Math.abs(s.pts[1] - (b.y + 20)) < 1e-6, `${s.pts[0]}, ${s.pts[1]}`);
  assert.equal(D.zoompad.box().x, b.x, 'not at the end of the strip: the box stays');
});

test('lifted near the end of the strip, the box moves on; past the line\'s end, a line down', () => {
  const { D, app, canvas } = rig();
  app.setTool('pen');
  D.zoompad.open(app);
  const cv = canvas(), b0 = { ...D.zoompad.box() };
  const write = x => { cv.on.pointerdown(pe(x, 100)); cv.on.pointermove(pe(x + 20, 80)); cv.on.pointerup(pe(x + 20, 80)); };
  write(800);
  assert.ok(D.zoompad.box().x > b0.x, 'moved on');
  for (let i = 0; i < 20; i++) write(800);
  assert.ok(D.zoompad.box().y > b0.y, 'and down a line once the line ran out');
  D.zoompad.close(app);
  assert.equal(D.zoompad.isOpen(), false);
});

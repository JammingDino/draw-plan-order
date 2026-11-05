/* The ruler and protractor (js/stencils.js): a stroke that starts at an
   edge follows it; a press on the body moves the stencil; the knob turns
   it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function rig() {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'stencils.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  app.camera.x = 0; app.camera.y = 0; app.camera.zoom = 1;
  return { D, app };
}
const pe = (x, y, over = {}) => ({ clientX: x, clientY: y, pointerId: 3, pointerType: 'pen', button: 0, buttons: 1, pressure: 0.5, type: 'pointermove', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...over });

test('a pen starting at the ruler\'s edge runs along it, set off by half its nib', () => {
  const { D, app } = rig();
  D.stencils.show(app, 'ruler');
  const S = D.stencils.state();
  S.x = 500; S.y = 400; S.ang = 0;
  app.setTool('pen'); app.opts.pen.size = 4;
  const route = D.ext.routes.find(Boolean);
  assert.equal(route(app, pe(400, 400 - 39 - 5)), null, 'the pen still draws');
  const ev = app.mkEv(pe(450, 330));
  assert.equal(ev.y, 400 - 39 - 3, 'kept against the top edge');
  assert.equal(ev.x, 450, 'free to run along it');
  // lifted: a hover is let alone again
  app.mkEv(pe(450, 330, { buttons: 0 }));
  assert.equal(app.mkEv(pe(450, 330)).y, 330);
});

test('a press on the body moves the ruler; one on the knob turns it', () => {
  const { D, app } = rig();
  D.stencils.show(app, 'ruler');
  const S = D.stencils.state();
  S.x = 500; S.y = 400; S.ang = 0;
  const route = D.ext.routes.find(Boolean);
  const mv = route(app, pe(500, 400));
  assert.ok(mv, 'taken');
  mv.down(app.mkEv(pe(500, 400))); mv.move(app.mkEv(pe(560, 420))); mv.up();
  assert.equal(S.x, 560); assert.equal(S.y, 420);
  const knob = { x: S.x + 860 / 2 - 34, y: S.y };
  const tn = route(app, pe(knob.x, knob.y));
  tn.down(app.mkEv(pe(knob.x, knob.y)));
  const a = -45 * Math.PI / 180, r = 860 / 2 - 34;
  tn.move(app.mkEv(pe(S.x + Math.cos(a) * r, S.y + Math.sin(a) * r + 3)));
  assert.ok(Math.abs(S.ang - a) < 1e-9, `settled on 45°: ${S.ang * 180 / Math.PI}`);
});

test('the protractor\'s curve keeps the pen on a circle, and hiding it lets the pen go', () => {
  const { D, app } = rig();
  D.stencils.show(app, 'protractor');
  const S = D.stencils.state();
  S.x = 0; S.y = 0; S.ang = 0;
  app.setTool('pen'); app.opts.pen.size = 2;
  const route = D.ext.routes.find(Boolean);
  route(app, pe(0, -212));
  const ev = app.mkEv(pe(100, -150));
  assert.ok(Math.abs(Math.hypot(ev.x, ev.y) - 212) < 1e-9, `on the circle: ${Math.hypot(ev.x, ev.y)}`);
  D.stencils.hide(app);
  assert.equal(app.mkEv(pe(100, -150)).x, 100);
  assert.equal(route(app, pe(0, -212)), null);
});

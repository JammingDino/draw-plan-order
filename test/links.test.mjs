/* Links (js/links.js): a thing linked to a page goes there when its
   badge is tapped; to another board, opens it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function rig() {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {}, list: async () => [{ id: 'other', name: 'Other' }] };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'ui.js', 'press.js', 'frames.js', 'links.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  app.camera.x = 0; app.camera.y = 0; app.camera.zoom = 1;
  return { D, app };
}
const pe = (x, y) => ({ clientX: x, clientY: y, pointerId: 2, pointerType: 'pen', button: 0, buttons: 1 });

test('a tap on the badge of a thing linked to a page goes to the page', async () => {
  const { D, app } = rig();
  const page = D.frames.make(app, { x: 0, y: 5000 }, { size: 'A4' });
  const t = D.make.shape({ kind: 'rect', x: 100, y: 100, w: 100, h: 50, link: { page: page.id } });
  app.scene.add(page); app.scene.add(t);
  const b = D.links.badgeAt(app, t);
  const route = D.ext.routes.find(r => r(app, pe(b.x, b.y)));
  assert.ok(route, 'the badge takes the press');
  route(app, pe(b.x, b.y)).up();
  await new Promise(r => setTimeout(r, 0));
  const c = app.camera.toWorld(640, 400);
  assert.ok(c.y > 5000, `on the page now: ${c.y}`);
});

test('a thing with no link wears no badge, and a press there is the tool\'s', () => {
  const { D, app } = rig();
  const t = D.make.shape({ kind: 'rect', x: 100, y: 100, w: 100, h: 50 });
  app.scene.add(t);
  const b = D.links.badgeAt(app, t);
  assert.ok(D.ext.routes.every(r => !r(app, pe(b.x, b.y))));
});

test('a link to another board opens it', async () => {
  const { D, app } = rig();
  let opened = null;
  app.openBoard = async id => { opened = id; };
  await D.links.follow(app, { link: { board: 'other', name: 'Other' } });
  assert.equal(opened, 'other');
});

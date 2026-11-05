/* Board history (js/history.js): copies kept as the board is saved,
   thinned as they age, and restored as one undo step. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

function rig() {
  const assets = new Map();
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {},
        putAsset: async (id, bytes, meta) => { assets.set(id, { bytes, meta }); },
        getAsset: async id => (assets.get(id) || {}).bytes || null,
        assetMeta: async id => (assets.get(id) || {}).meta || null,
        removeAsset: async id => { assets.delete(id); } };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'preview.js', 'history.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  return { D, app, assets };
}
const H = 3600e3, DAY = 24 * H;

test('the copies thin out with age: every one this hour, one per three hours today, one a day, one a week', () => {
  const { D } = rig();
  const now = 100 * DAY, list = [];
  for (let t = now - 70 * DAY; t <= now; t += 20 * 60e3) list.push({ at: t, asset: 'x' + t, n: 1 });
  const kept = D.history.thin(list, now);
  const age = h => now - h.at;
  assert.equal(kept.filter(h => age(h) < H).length, 3, 'every copy from the last hour (20 minutes apart)');
  assert.ok(kept.filter(h => age(h) >= H && age(h) < DAY).length <= 8);
  assert.ok(kept.filter(h => age(h) >= DAY && age(h) < 14 * DAY).length <= 14);
  assert.ok(kept.filter(h => age(h) >= 14 * DAY).length <= 8, 'no more than eight weeks back');
  assert.ok(kept.length < 40);
  for (let i = 1; i < kept.length; i++) assert.ok(kept[i].at > kept[i - 1].at, 'oldest first');
});

test('a copy is kept on save no more than every ten minutes, and restores as one undo step', async () => {
  const { D, app, assets } = rig();
  app.scene.add(D.make.shape({ kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
  await D.history.take(app);
  await D.history.take(app);
  assert.equal(app.board.history.length, 1, 'not twice in ten minutes');
  assert.equal(assets.size, 1);
  const first = app.board.history[0];
  app.scene.begin('more'); app.scene.add(D.make.shape({ kind: 'ellipse', x: 50, y: 0, w: 10, h: 10 })); app.scene.commit();
  const doc = JSON.parse(new TextDecoder().decode(await D.store.getAsset(first.asset)));
  D.history.restore(app, doc);
  assert.equal(app.scene.items.length, 1);
  assert.equal(app.scene.items[0].kind, 'rect');
  app.undo();
  assert.equal(app.scene.items.length, 2, 'undo brings back what was there');
});

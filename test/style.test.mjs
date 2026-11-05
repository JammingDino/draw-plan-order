/* Copy style, paste style (js/style.js): one thing's look put on
   others, as one undo step, carrying only what means the same on both. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

function rig(items = D => []) {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
    }, 'press.js', 'style.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  const made = items(D);
  for (const it of made) app.scene.add(it);
  return { D, app, scene: app.scene, made };
}

test('an arrow\'s look goes onto another arrow whole, as one undo step', () => {
  const { D, app, scene, made: [a, b] } = rig(D => [
    D.make.shape({ kind: 'arrow', x: 0, y: 0, w: 100, h: 0, color: '#e03131', size: 5, dash: 2, head1: 'dot', head2: 'open', headScale: 1.5 }),
    D.make.shape({ kind: 'arrow', x: 0, y: 50, w: 100, h: 0 })
  ]);
  assert.ok(D.style.copy(app, a));
  assert.equal(D.style.paste(app, [b]), 1);
  for (const k of ['color', 'size', 'dash', 'head1', 'head2', 'headScale']) assert.deepEqual(b[k], a[k], k);
  assert.equal(b.x, 0, 'where it is is not its look');
  app.undo();
  assert.equal(scene.get(b.id).color, '#111');
});

test('across kinds, only what means the same carries', () => {
  const { D, app, made: [rect, ink, note, txt, line] } = rig(D => [
    D.make.shape({ kind: 'rect', x: 0, y: 0, w: 50, h: 50, color: '#1971c2', fill: '#e8f7ee', size: 6, dash: 1, radius: 4 }),
    D.make.stroke({ pts: inked([0, 0, 10, 10]), size: 3 }),
    D.make.note({ x: 0, y: 100 }),
    D.make.text({ x: 0, y: 300, text: 'hi', size: 20 }),
    D.make.shape({ kind: 'line', x: 0, y: 400, w: 50, h: 0 })
  ]);
  D.style.copy(app, rect);
  D.style.paste(app, [ink, note, txt, line]);
  assert.equal(ink.color, '#1971c2'); assert.equal(ink.size, 6, 'a width is a width');
  assert.equal(ink.fill, undefined, 'ink has no fill');
  assert.equal(note.color, '#ffe58a', 'a note\'s colour is its paper, not an ink');
  assert.equal(txt.color, '#1971c2'); assert.equal(txt.size, 20, 'a font size is not a stroke width');
  assert.equal(line.fill, 'none', 'a line takes no fill'); assert.equal(line.radius, 10, 'nor corners');
  assert.equal(line.dash, 1);
});

test('Ctrl+Alt+C and Ctrl+Alt+V, and the long-press actions', () => {
  const { D, app, made: [a, b] } = rig(D => [
    D.make.shape({ kind: 'ellipse', x: 0, y: 0, w: 50, h: 50, color: '#2f9e44' }),
    D.make.shape({ kind: 'ellipse', x: 100, y: 0, w: 50, h: 50 })
  ]);
  const key = key => app.onKey({ key, code: 'Key' + key.toUpperCase(), ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, target: { matches: () => false }, preventDefault() {} });
  app.select([a]); key('c');
  app.select([b]); key('v');
  assert.equal(b.color, '#2f9e44');
  const ids = D.ext.pressActions.filter(x => !x.when || x.when({ app, selection: [b] })).map(x => x.id);
  assert.ok(ids.includes('style-copy') && ids.includes('style-paste'));
});

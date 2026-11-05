/* Recording (js/audio.js): strokes written while it records keep when
   they were written; the recording lands on the board as a clip, kept as
   one of the board's assets; "Play from here" is offered on that ink. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

function rig() {
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {}, putAsset: async () => {} };
      const q = g.document.querySelector;
      g.document.querySelector = sel => sel === '#sheet' ? { hidden: true } : q(sel);
      g.Blob = Blob; g.setInterval = setInterval; g.clearInterval = clearInterval;
      g.navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } };
      g.MediaRecorder = class {
        static isTypeSupported(t) { return t === 'audio/webm'; }
        constructor(s, o) { this.mimeType = o.mimeType; }
        start() { }
        stop() { this.ondataavailable({ data: new Blob([new Uint8Array([1, 2, 3])]) }); setTimeout(() => this.onstop(), 0); }
      };
    }, 'press.js', 'audio.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [], sheetKey: () => false, sheetOpen: false };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  return { D, app };
}

test('ink written while recording is kept in step with it, and the clip holds the sound', async () => {
  const { D, app } = rig();
  await D.audio.start(app);
  assert.equal(D.audio.recording(), true);
  const s = D.make.stroke({ pts: inked([0, 0, 50, 0]) });
  s._t0 = performance.now();
  app.scene.begin('draw'); app.scene.add(s); app.scene.commit();
  D.ext.emit('stroke', app, s);
  await D.audio.stop(app);
  const clip = app.scene.items.find(i => i.type === 'audio');
  assert.ok(clip && clip.asset, 'a clip, with its sound as an asset');
  assert.equal(clip.mime, 'audio/webm');
  assert.ok(app.board.assets.some(a => a.id === clip.asset), 'the board keeps the sound');
  assert.equal(s.rec.id, clip.id);
  assert.ok(s.rec.t >= 0 && s.rec.t < 1000);
  const offered = D.ext.pressActions.filter(a => a.when && a.when({ app, hit: s, selection: [] })).map(a => a.id);
  assert.ok(offered.includes('audio-from-here'));
});

test('ink written when nothing is recording is left as it was', () => {
  const { D, app } = rig();
  const s = D.make.stroke({ pts: inked([0, 0, 50, 0]) });
  D.ext.emit('stroke', app, s);
  assert.equal(s.rec, undefined);
  const offered = D.ext.pressActions.filter(a => a.when && a.when({ app, hit: s, selection: [] })).map(a => a.id);
  assert.ok(!offered.includes('audio-from-here'));
});

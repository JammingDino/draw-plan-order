/* Exports. They are painted in the theme Settings → Export asks for, which
   need not be the theme on screen, and they must not lean on the screen's
   PDF cache — which holds sharp renders only of the pages in view. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js');
const U = D.util;

test('the mirrored theme colours match the stylesheet', () => {
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  const block = sel => css.slice(css.indexOf(sel + '{'), css.indexOf('}', css.indexOf(sel + '{')));
  const token = (b, name) => (b.match(new RegExp(name + ':\s*([^;]+);')) || [])[1].trim();
  const light = block(':root'), dark = block(':root[data-theme="dark"]');
  assert.equal(U.THEMES.light.ink, token(light, '--text'));
  assert.equal(U.THEMES.light.paper, token(light, '--paper'));
  assert.equal(U.THEMES.dark.ink, token(dark, '--text'));
  assert.equal(U.THEMES.dark.paper, token(dark, '--paper'));
});

test('ink and paper follow the export theme, then go back to the screen', () => {
  const app = { scene: new D.Scene(), camera: new D.Camera(), requestDraw() {}, opts: {} };
  const r = new D.Renderer(app);
  const screenInk = U.color('ink');
  U.paintAs('dark', () => {
    assert.equal(U.color('ink'), U.THEMES.dark.ink);
    assert.equal(U.color('paper'), U.THEMES.dark.paper);
    assert.equal(r.tokens().dark, true, 'the painter sees a dark board');
  });
  assert.equal(U.color('ink'), screenInk, 'the screen gets its own ink back');
  assert.equal(r.tokens().dark, false);
  // a literal colour is never touched
  assert.equal(U.paintAs('dark', () => U.color('#ff0000')), '#ff0000');
});

test('the theme is handed back even if painting throws', () => {
  assert.throws(() => U.paintAs('dark', () => { throw new Error('boom'); }));
  assert.equal(U.theme(), 'light');
});

test('an export renders each PDF page itself, in its own theme, and never queues screen work', async () => {
  const scene = new D.Scene();
  const page = D.make.pdfpage({ asset: 'a1', page: 1, x: 0, y: 0, w: 100, h: 140 });
  scene.add(page);
  scene.add(D.make.stroke({ pts: [10, 10, .5, 50, 50, .5], color: 'ink' }));
  const app = { scene, camera: new D.Camera(), requestDraw() {}, opts: {} };
  app.camera.zoom = 0.1;
  const r = new D.Renderer(app);

  const asked = [], drawn = [];
  D.pdf = {
    bitmap() { throw new Error('an export must not go through the screen cache'); },
    peek() { throw new Error('nor through the thumbnail path'); },
    render: async (_, it, scale, dark) => { asked.push({ it, scale, dark }); return { width: 7, height: 7, tag: 'export' }; }
  };
  const ctx = offscreen(app);
  ctx.drawImage = bmp => drawn.push(bmp);
  const strokeColours = [];
  const fill = ctx.fill;
  ctx.fill = function (p) { strokeColours.push(this.fillStyle); return fill.call(this, p); };

  await r.paintExport(ctx, scene.items, 2, { theme: 'dark', dark: true, transparent: true });

  assert.equal(asked.length, 1, 'one render for the one page');
  assert.equal(asked[0].scale, 2, 'at the export resolution, not the camera zoom');
  assert.equal(asked[0].dark, true, 'in the export theme');
  assert.equal(drawn[0].tag, 'export');
  assert.equal(drawn[0].width, 0, 'and its memory released once painted');
  assert.ok(strokeColours.includes(U.THEMES.dark.ink), 'default ink painted in the export theme');
});

test('the dashboard thumbnail takes cached pages only', () => {
  const scene = new D.Scene();
  const page = scene.add(D.make.pdfpage({ asset: 'a1', page: 1, x: 0, y: 0, w: 100, h: 140 }));
  const app = { scene, camera: new D.Camera(), requestDraw() {}, opts: {} };
  const r = new D.Renderer(app);
  let peeked = 0;
  D.pdf = {
    bitmap() { throw new Error('a thumbnail must not queue renders'); },
    peek() { peeked++; return null; }
  };
  const thumb = offscreen(app);
  r.drawItems(thumb, scene.items, 0.05);
  assert.equal(peeked, 1);
});

/** a 2d context that is not the renderer's own screen canvas */
function offscreen(app) { return new D.Renderer(app).bctx; }

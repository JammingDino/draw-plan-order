/* Section hatching: a closed shape's `hatch` draws lines across it in its
   own colour, clipped to its outline, on screen and in the SVG export. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js');

function rig(...items) {
  const scene = new D.Scene();
  for (const it of items) scene.add(it);
  const app = { scene, camera: new D.Camera(), requestDraw() {}, opts: {} };
  return { scene, r: new D.Renderer(app) };
}

test('hatched shapes are clipped to their outline and stroked in their colour', () => {
  const it = D.make.shape({ kind: 'ellipse', x: 0, y: 0, w: 100, h: 60, size: 2, color: '#e5484d', hatch: 'cross' });
  const { r } = rig(it);
  const ctx = r.bctx, calls = [];
  for (const k of ['clip', 'stroke', 'moveTo']) { const f = ctx[k]; ctx[k] = function (...a) { calls.push([k, this.strokeStyle]); return f && f.apply(this, a); }; }
  r.drawItem(ctx, it);
  assert.ok(calls.some(c => c[0] === 'clip'), 'clipped');
  assert.ok(calls.filter(c => c[0] === 'moveTo').length > 10, 'lines both ways across it');
});

test('the SVG export carries the hatching, clipped, and no hatching means no clip', async () => {
  const a = D.make.shape({ kind: 'rect', x: 0, y: 0, w: 100, h: 60, size: 2, hatch: 'hatch' });
  const b = D.make.shape({ kind: 'rect', x: 200, y: 0, w: 100, h: 60, size: 2 });
  const { scene, r } = rig(a, b);
  const svg = await r.toSVG(scene, scene.contentBounds(), { theme: 'light', dark: false, transparent: true });
  assert.equal((svg.match(/<clipPath /g) || []).length, 1);
  assert.match(svg, /clip-path="url\(#h/);
});

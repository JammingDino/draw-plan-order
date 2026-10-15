/* The saved format (js/format.js): every board ever saved must still open.

   test/fixtures/boards/ holds boards as each version of the app saved
   them, one of every kind of item. Each must open, upgraded to the newest
   version, draw, export, and save again without losing anything. When the
   format changes, the old fixtures stay and a new one joins them — see the
   comment at the top of format.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'pdf.js', 'scene.js', 'camera.js', 'render.js', 'tools.js',
  'math.js', 'calc.js', 'cad.js', 'inkmath.js', 'frames.js', 'graph.js', 'symbols.js');
const F = D.format;

const DIR = new URL('./fixtures/boards/', import.meta.url);
const FIXTURES = readdirSync(DIR).filter(f => f.endsWith('.json')).sort()
  .map(name => ({ name, text: readFileSync(new URL(name, DIR), 'utf8') }));

const BUILT_IN = ['stroke', 'shape', 'text', 'note', 'node', 'edge', 'image', 'pdfpage'];

/* the scene lives in the harness's own realm; compare its objects as plain data */
const plain = o => JSON.parse(JSON.stringify(o));

/* a 2d context that takes any call: drawing must not throw, whatever it asks for */
function anyContext() {
  const fn = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'createPattern' || k === 'createLinearGradient') return () => ({ setTransform: fn, addColorStop: fn });
      return fn;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function painter(scene) {
  return new D.Renderer({ scene, camera: new D.Camera(), requestDraw() {}, opts: {}, getAsset: async () => null });
}

test('there is a fixture for this version of the format', () => {
  assert.ok(FIXTURES.some(f => f.name.startsWith(`v${F.VERSION}-`)),
    `save a board as test/fixtures/boards/v${F.VERSION}-….json (see format.js)`);
});

test('the newest fixture has one of every kind of item', () => {
  const newest = FIXTURES.filter(f => f.name.startsWith(`v${F.VERSION}-`));
  const types = new Set(newest.flatMap(f => JSON.parse(f.text).items.map(it => it.type)));
  for (const t of [...BUILT_IN, ...Object.keys(D.ext.items)])
    assert.ok(types.has(t), `no "${t}" item in the v${F.VERSION} fixtures: add one, so a change to it is caught`);
});

for (const fx of FIXTURES) {
  test(`${fx.name} opens, draws and saves again`, async () => {
    const scene = new D.Scene();
    scene.load(JSON.parse(fx.text));
    assert.equal(scene.loaded.newer, false);
    assert.equal(scene.v, F.VERSION);
    assert.ok(scene.items.length > 0);

    for (const it of scene.items) {
      const b = scene.bbox(it);
      assert.ok([b.x, b.y, b.x2, b.y2].every(Number.isFinite), `${it.id} (${it.type}) has a box`);
    }

    const r = painter(scene), ctx = anyContext();
    for (const it of scene.items) assert.doesNotThrow(() => r.drawItem(ctx, it), `${it.id} (${it.type}) draws`);
    const svg = await r.toSVG(scene, scene.contentBounds(), 'light');
    assert.match(svg, /^<svg/);

    // the saved bytes are the saved object, and a second load saves the same again
    const text = scene.docText();
    assert.deepEqual(JSON.parse(text), plain(scene.toJSON()));
    const again = new D.Scene(JSON.parse(text));
    assert.equal(again.docText(), text);
  });
}

test('a fixture of the current version saves back exactly as it was', () => {
  for (const fx of FIXTURES.filter(f => f.name.startsWith(`v${F.VERSION}-`))) {
    const scene = new D.Scene(JSON.parse(fx.text));
    assert.deepEqual(plain(scene.toJSON()), JSON.parse(fx.text), fx.name);
  }
});

test('a doc with no version is a version 1 doc', () => {
  assert.equal(F.versionOf({ items: [] }), 1);
  assert.equal(F.versionOf({ v: 'x', items: [] }), 1);
  const up = F.upgrade({ items: [] });
  assert.equal(up.from, 1);
  assert.equal(up.doc.v, F.VERSION);
  assert.equal(F.upgrade(null).doc.items.length, 0);
});

test('a board from a newer version keeps its version, its keys and its unknown items', () => {
  const newer = {
    v: F.VERSION + 1,
    layers: [{ id: 'L1', name: 'Ink' }],
    meta: { scale: { unit: 'm', k: 1, prec: 2 } },
    items: [
      { id: 'a', type: 'stroke', pts: [0, 0, 0.5, 10, 10, 0.5], color: 'ink', size: 3, alpha: 1, thinning: 0.6, blend: 'source-over', layer: 'L1' },
      { id: 'b', type: 'hologram', x: 0, y: 0, depth: 3 }
    ]
  };
  const scene = new D.Scene(JSON.parse(JSON.stringify(newer)));
  assert.equal(scene.loaded.newer, true);
  assert.equal(scene.loaded.from, F.VERSION + 1);
  assert.deepEqual(JSON.parse(scene.docText()), newer, 'saved back with nothing dropped');
  assert.deepEqual(plain(scene.toJSON()), newer);
});

test('an unknown top-level key on a current board survives a save', () => {
  const doc = { v: F.VERSION, notes: 'kept', items: [] };
  const scene = new D.Scene(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(JSON.parse(scene.docText()), doc);
});

test('a plain board still saves with the short header', () => {
  const scene = new D.Scene({ v: 1, items: [] });
  assert.equal(scene.docText(), '{"v":1,"items":[]}');
});

test('upgrade steps run in order, each from the version it is filed under', async () => {
  // format.js as it would be at version 3, with two steps filed
  const { readFileSync: read } = await import('node:fs');
  const vm = await import('node:vm');
  const src = read(new URL('../js/format.js', import.meta.url), 'utf8').replace('const VERSION = 1;', 'const VERSION = 3;');
  const g = { window: { DPO: {} } };
  vm.runInNewContext(src, g);
  const F3 = g.window.DPO.format;
  const ran = [];
  F3.UP[1] = doc => { ran.push(1); for (const it of doc.items) it.size *= 2; };
  F3.UP[2] = doc => { ran.push(2); doc.items = doc.items.filter(it => it.type !== 'gone'); };
  const up = F3.upgrade({ v: 1, items: [{ id: 'a', type: 'stroke', size: 3 }, { id: 'b', type: 'gone' }] });
  assert.deepEqual(ran, [1, 2]);
  assert.equal(up.from, 1);
  assert.equal(up.doc.v, 3);
  assert.equal(up.doc.items.length, 1);
  assert.equal(up.doc.items[0].size, 6);
  ran.length = 0;
  F3.upgrade({ v: 2, items: [] });
  assert.deepEqual(ran, [2], 'a v2 doc skips the v1 step');
  delete F3.UP[2];
  assert.throws(() => F3.upgrade({ v: 1, items: [] }), /no upgrade from board format 2/);
});

/* Searching the board (js/search.js): words in every kind of item, and in
   the text layer of imported PDFs, found in reading order. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeApp, inked } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'pdf.js', 'scene.js', 'camera.js', 'render.js', 'tools.js',
  'math.js', 'calc.js', 'cad.js', 'inkmath.js', 'frames.js', 'graph.js', 'symbols.js', 'search.js');
const S = D.search;

function board() {
  const app = fakeApp(D, { getAsset: async () => new Uint8Array([1]) });
  const sc = app.scene;
  sc.add(D.make.text({ id: 't1', x: 0, y: 300, w: 200, text: 'Reaction at A' }));
  sc.add(D.make.note({ id: 'n1', x: 400, y: 100, text: 'check the reaction sign' }));
  sc.add(D.make.node({ id: 'd1', x: 0, y: 600, text: 'Is it statically determinate?' }));
  sc.add(D.make.edge({ id: 'e1', from: { x: 0, y: 0 }, to: { x: 50, y: 50 }, label: 'reaction' }));
  sc.add({ id: 'k1', type: 'calc', x: 0, y: 800, text: 'R = 12 kN / 2', size: 16, res: [{ t: '6 kN' }], sig: '', alpha: 1 });
  sc.add({ id: 'f1', type: 'frame', x: -50, y: -50, w: 794, h: 1123, size: 'A4', orient: 'portrait', paper: 'plain', name: 'Tutorial 4', alpha: 1 });
  sc.add(D.make.stroke({ id: 's1', pts: inked([0, 0, 40, 40]) }));
  return app;
}

test('words in text boxes, notes, nodes, connector labels and calc blocks, in reading order, any case', async () => {
  const app = board();
  const hits = await S.find(app, 'reaction');
  assert.deepEqual([...hits.map(h => h.item.id)], ['e1', 'n1', 't1']);
  assert.equal(hits.find(h => h.item.id === 'n1').at, 10, 'where in its text');
  assert.deepEqual([...(await S.find(app, 'determinate')).map(h => h.item.id)], ['d1']);
});

test('a calc block is found by its working and by its answers', async () => {
  const app = board();
  assert.deepEqual([...(await S.find(app, '12 kn')).map(h => h.item.id)], ['k1']);
  assert.deepEqual([...(await S.find(app, '6 kN')).map(h => h.item.id)], ['k1']);
});

test('page names, and nothing for an empty search or ink', async () => {
  const app = board();
  assert.deepEqual([...(await S.find(app, 'tutorial')).map(h => h.item.id)], ['f1']);
  assert.equal((await S.find(app, '   ')).length, 0);
  assert.equal((await S.find(app, 'zebra')).length, 0);
});

test("a PDF page's own words are found where they sit on the page", async () => {
  const app = board();
  const page = D.make.pdfpage({ id: 'p1', asset: 'lec', page: 2, x: 1000, y: 0, w: 800, h: 1000 });
  app.scene.add(page);
  const was = S.pdfWords;
  let asked = 0;
  S.pdfWords = async (a, it) => { asked++; return it.page === 2 ? [{ str: 'The beam reaction is wL/2', x: 0.1, y: 0.2, w: 0.5, h: 0.02 }] : []; };
  try {
    const hits = (await S.find(app, 'reaction')).filter(h => h.item.id === 'p1');
    assert.equal(hits.length, 1);
    const b = hits[0].box, s = 'The beam reaction is wL/2', k = s.indexOf('reaction');
    assert.ok(Math.abs(b.x - (1000 + (0.1 + 0.5 * k / s.length) * 800)) < 1e-6, 'starts at the word, not the line');
    assert.ok(Math.abs(b.w - 0.5 * ('reaction'.length / s.length) * 800) < 1e-6, 'as wide as the word');
    assert.ok(Math.abs(b.y - 200) < 1e-6);
    await S.find(app, 'beam');
    assert.equal(asked, 1, 'the page is read once');
  } finally { S.pdfWords = was; }
});

test('a feature can say what its items read as', async () => {
  D.ext.items.widget = { searchText: it => 'gear ratio ' + it.n, bbox: it => ({ x: it.x, y: it.y, w: 10, h: 10 }), draw() {} };
  const app = board();
  app.scene.add({ id: 'w1', type: 'widget', x: 0, y: 2000, n: 3 });
  assert.deepEqual([...(await S.find(app, 'ratio 3')).map(h => h.item.id)], ['w1']);
  delete D.ext.items.widget;
});

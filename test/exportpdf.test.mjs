/* The PDF writer (js/exportpdf.js): a sheet per page, in the pages'
   order, the right size in points, and a file whose cross-reference
   table points where it says. The painting itself needs a real canvas;
   it is checked in the browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { load, inked } from './harness.mjs';

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'frames.js', g => {
  g.CompressionStream = CompressionStream; g.Response = Response; g.Blob = Blob;
}, 'exportpdf.js');
const P = D.exportPdf;
const text = b => Buffer.from(b).toString('latin1');

test('the sheets: each page, in order; with none, one round everything', () => {
  const scene = new D.Scene();
  scene.add(D.make.stroke({ pts: inked([0, 0, 100, 50]), size: 4 }));
  const one = P.plan(scene);
  assert.equal(one.length, 1);
  assert.ok(one[0].x < 0 && one[0].w > 100, 'a margin round the ink');
  const a = { id: 'a', type: 'frame', x: 0, y: 0, w: 794, h: 1123, size: 'A4', orient: 'portrait', paper: 'plain', name: '' };
  const b = { ...a, id: 'b', y: 1200 };
  scene.add(a, 0); scene.add(b, 1);
  assert.deepEqual([...P.plan(scene).map(s => s.frame.id)], ['a', 'b']);
  assert.deepEqual([...P.plan(scene, [b]).map(s => s.frame.id)], ['b'], 'or only the ones asked for');
});

test('the file: a page per sheet at its size in points, pictures deflated, and an honest xref', async () => {
  // a 3 × 2 picture: red, green, blue / white, black, grey
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255]);
  const data = await P.deflateRGB(rgba, 3, 2);
  assert.deepEqual([...inflateSync(Buffer.from(data))], [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 128, 128, 128]);
  const A4 = { w: 794 * 0.75, h: 1123 * 0.75 };
  const bytes = P.write([{ ...A4, img: { w: 3, h: 2, filter: 'FlateDecode', data } }, { ...A4, img: { w: 3, h: 2, filter: 'FlateDecode', data } }], { title: 'Statics — week 3 ✓' });
  const s = text(bytes);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\/Count 2/);
  assert.equal((s.match(/\/Type \/Page /g) || []).length, 2);
  assert.match(s, /\/MediaBox \[0 0 595\.5 842\.25\]/, 'A4 in points');
  // every xref entry points at the start of its object
  const at = +/startxref\n(\d+)/.exec(s)[1];
  assert.ok(s.slice(at).startsWith('xref'));
  const rows = s.slice(at).split('\n').slice(3).filter(l => / 00000 n $/.test(l));
  rows.forEach((row, i) => assert.ok(s.slice(+row.slice(0, 10)).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  // each stream's /Length is its length
  for (const m of s.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(s.slice(start + +m[1], start + +m[1] + 10), '\nendstream');
  }
  assert.match(s, /\/Title <FEFF0053/, 'the title in UTF-16, so any character survives');
});

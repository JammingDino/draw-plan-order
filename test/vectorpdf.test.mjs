/* The vector PDF (exportpdf.js vector()): an imported PDF page goes back
   as the original page, ink as paths, the rest as pictures between them,
   in board order. Run against the real pdf-lib; the painting of pictures
   needs a canvas, so it is stood in for here and checked in the browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { load, inked } from './harness.mjs';

const require = createRequire(import.meta.url);
const L = require('pdf-lib');
const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'frames.js', g => { g.PDFLib = L; }, 'exportpdf.js');
const P = D.exportPdf;

/** a w × h PNG of one colour, made by hand */
function png(w = 2, h = 2, rgba = [255, 0, 0, 128]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const chunk = (type, data) => {
    const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4);
    len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(0); for (let x = 0; x < w; x++) rows.push(...rgba); }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]));
}

/** a lecture handout: two A4 pages, words on the second */
async function lecture() {
  const doc = await L.PDFDocument.create();
  const font = await doc.embedFont(L.StandardFonts.Helvetica);
  doc.addPage([595.28, 841.89]);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Hello lecture', { x: 72, y: 720, size: 24, font });
  return doc.save();
}

const hex = s => [...Buffer.from(s, 'latin1')].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

function contentOf(doc, page) {
  const c = page.node.Contents();
  const streams = c instanceof L.PDFArray ? c.asArray().map(r => doc.context.lookup(r)) : [c];
  return streams.map(s => Buffer.from(L.decodePDFRawStream(s).decode()).toString('latin1')).join('\n');
}
function xobjects(doc, page) {
  const res = page.node.Resources(), xo = res && res.lookup(L.PDFName.of('XObject'));
  if (!xo) return [];
  return xo.entries().map(([name, ref]) => {
    const s = doc.context.lookup(ref);
    return { name: name.decodeText(), subtype: s.dict.lookup(L.PDFName.of('Subtype')).decodeText(), stream: s };
  });
}

async function board(srcBytes) {
  const scene = new D.Scene();
  const page = D.make.pdfpage({ id: 'pg', asset: 'handout', page: 2, pages: 2, label: 'handout.pdf', x: 0, y: 0, w: 595.28 * 96 / 72, h: 841.89 * 96 / 72, pw: 595.28, ph: 841.89 });
  scene.add(page);
  scene.add(D.make.stroke({ id: 'ink1', pts: inked([100, 100, 300, 140, 420, 120]), size: 3, color: '#e5484d' }));
  scene.add(D.make.text({ id: 'note', x: 100, y: 400, w: 200, text: 'F = ma' }));
  scene.add(D.make.stroke({ id: 'hl', pts: inked([90, 260, 500, 260]), size: 22, alpha: 0.4, color: '#ffe066', blend: 'multiply', thinning: 0 }));
  const painted = [];
  const app = { scene, getAsset: async id => id === 'handout' ? srcBytes : null };
  const hooks = { paint: async (items, crop) => { painted.push([...items.map(i => i.id)]); return { png: png(), x: crop.x, y: crop.y, w: crop.w, h: crop.h }; } };
  return { scene, app, hooks, painted };
}

test('layers: strokes run together, a PDF page stands alone, the rest is painted, in board order', () => {
  const s = id => ({ id, type: 'stroke', pts: [0, 0, 0.5, 1, 1, 0.5] });
  const items = [{ id: 'f', type: 'frame' }, { id: 'p', type: 'pdfpage' }, s('a'), s('b'), { id: 't', type: 'text' }, s('c'), { id: 'q', type: 'pdfpage' }];
  const got = P.layers(items, it => it.id === 'p').map(l => l.kind + ':' + l.items.map(i => i.id).join(''));
  assert.deepEqual([...got], ['paint:f', 'pdf:p', 'ink:ab', 'paint:t', 'ink:c', 'paint:q']);
});

test('an imported PDF page goes back as itself: its words stay words', async () => {
  const src = await lecture();
  const { app, hooks, painted, scene } = await board(src);
  const sheets = P.plan(scene);
  assert.equal(sheets.length, 1);
  const bytes = await P.vector(L, app, sheets, { title: 'Week 3' }, hooks);
  const out = await L.PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 1);
  const [page] = out.getPages();
  assert.ok(Math.abs(page.getWidth() - 595.28) < 0.01 && Math.abs(page.getHeight() - 841.89) < 0.01, 'the page at its own size');
  assert.equal(out.getTitle(), 'Week 3');

  const xo = xobjects(out, page);
  const form = xo.find(x => x.subtype === 'Form');
  assert.ok(form, 'the original page, copied in as a form');
  const formText = Buffer.from(L.decodePDFRawStream(form.stream).decode()).toString('latin1');
  assert.ok(formText.includes(hex('Hello lecture')) || formText.includes('Hello lecture'), 'with its text as text');

  assert.deepEqual(painted, [['note']], 'only the text box was painted');
  assert.equal(xo.filter(x => x.subtype === 'Image').length, 1);

  const ops = contentOf(out, page);
  // in board order: the page, the red ink, the painted note, then the highlighter
  const at = name => ops.indexOf('/' + name + ' Do');
  const img = xo.find(x => x.subtype === 'Image').name;
  const red = ops.indexOf('0.8980392156862745 0.2823529411764706 0.30196078431372547 rg');
  const gs = page.node.Resources().lookup(L.PDFName.of('ExtGState'));
  const multiply = [...ops.matchAll(/\/(\S+) gs/g)].find(m => {
    const st = gs.lookup(L.PDFName.of(m[1]));
    return st && String(st.lookup(L.PDFName.of('BM'))) === '/Multiply';
  });
  assert.ok(multiply, 'the highlighter multiplies');
  const hl = gs.lookup(L.PDFName.of(multiply[1]));
  assert.ok(Math.abs(hl.lookup(L.PDFName.of('ca')).asNumber() - 0.4) < 1e-6, 'and is see-through');
  assert.ok(at(form.name) >= 0 && at(form.name) < red, 'the page under the ink');
  assert.ok(red < at(img), 'the ink under the note');
  assert.ok(at(img) < multiply.index, 'the note under the highlighter');
  assert.ok(/\d m\n[\d.]+ [\d.]+ l\n/.test(ops), 'ink as paths, not pictures');
});

test('a PDF that cannot be copied from is painted instead, and the export still finishes', async () => {
  const { app, hooks, painted, scene } = await board(new Uint8Array([1, 2, 3, 4]));
  const bytes = await P.vector(L, app, P.plan(scene), {}, hooks);
  const out = await L.PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 1);
  assert.deepEqual(painted[0], ['pg'], 'the page painted');
});

test('a page turned on the board is painted, not copied square', async () => {
  const src = await lecture();
  const { app, hooks, painted, scene } = await board(src);
  scene.get('pg').rot = 0.3;
  await P.vector(L, app, P.plan(scene), {}, hooks);
  assert.deepEqual(painted[0], ['pg']);
});

test('ink is vector: the file barely grows with the zoom it is read at, and opaque ink of one colour is one fill', async () => {
  const scene = new D.Scene();
  scene.add({ id: 'f', type: 'frame', x: 0, y: 0, w: 794, h: 1123, size: 'A4', orient: 'portrait', paper: 'plain', name: '' });
  for (let i = 0; i < 30; i++) scene.add(D.make.stroke({ pts: inked([50, 40 + i * 30, 700, 50 + i * 30]), size: 3, color: '#14161c' }));
  const app = { scene, getAsset: async () => null };
  const bytes = await P.vector(L, app, P.plan(scene), {}, { paint: async (items, crop) => ({ png: png(), x: crop.x, y: crop.y, w: crop.w, h: crop.h }) });
  const out = await L.PDFDocument.load(bytes);
  const ops = contentOf(out, out.getPage(0));
  const fills = (ops.match(/\n\s*f\s*\n|\sf\n|\sf$/g) || []).length;
  assert.ok(fills <= 3, `the paper, then the ink in one fill (${fills})`);
  assert.ok(bytes.length < 60000, `${bytes.length} bytes`);
});

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

/** the copied form's matrix: pdf-lib writes translate, turn, scale and skew as cms before its Do */
function matrices(ops) {
  const at = ops.indexOf('/EmbeddedPdfPage');
  const before = ops.slice(0, at).split('\nq\n').pop();
  let M = [1, 0, 0, 1, 0, 0];
  for (const m of before.matchAll(/([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) cm/g)) {
    const [a, b, c, d, e, f] = m.slice(1).map(Number), [A, B, C, D, E, F] = M;
    M = [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
  }
  return M;
}
const apply = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];

test('a page turned on the board is copied, not painted, and turned with it', async () => {
  const src = await lecture();
  const { app, hooks, painted, scene } = await board(src);
  const pg = scene.get('pg');
  pg.rot = Math.PI / 2;
  // a sheet round the turned page, so the page is all there is to check
  const k = 72 / 96, cx = pg.x + pg.w / 2, cy = pg.y + pg.h / 2;
  const sheet = { x: cx - pg.h / 2, y: cy - pg.w / 2, w: pg.h, h: pg.w };
  const bytes = await P.vector(L, app, [sheet], {}, hooks);
  assert.ok(!painted.some(r => r.includes('pg')), 'the page is not painted');
  const out = await L.PDFDocument.load(bytes);
  const M = matrices(contentOf(out, out.getPage(0)));
  // a quarter turn clockwise as seen: the form's top-left lands top-right
  const [x, y] = apply(M, 0, 841.89);
  assert.ok(Math.abs(x - sheet.w * k) < 0.5 && Math.abs(y - sheet.h * k) < 0.5, `top-left at ${x}, ${y}`);
  const [x2, y2] = apply(M, 595.28, 0);
  assert.ok(Math.abs(x2) < 0.5 && Math.abs(y2) < 0.5, `bottom-right at ${x2}, ${y2}`);
});

test('a page with a /Rotate of its own is copied turned the way a reader shows it', async () => {
  const doc = await L.PDFDocument.create();
  const turned = doc.addPage([595.28, 841.89]);
  turned.setRotation(L.degrees(90));
  turned.drawRectangle({ x: 0, y: 0, width: 10, height: 10 });
  const src = await doc.save();
  const scene = new D.Scene();
  // shown landscape, as pdf.js measures a turned page
  const w = 841.89 * 96 / 72, h = 595.28 * 96 / 72;
  scene.add(D.make.pdfpage({ id: 'pg', asset: 'a', page: 1, pages: 1, x: 0, y: 0, w, h, pw: 841.89, ph: 595.28 }));
  const painted = [];
  const app = { scene, getAsset: async () => src };
  const bytes = await P.vector(L, app, [{ x: 0, y: 0, w, h }], {}, { paint: async items => { painted.push(items.map(i => i.id)); return null; } });
  assert.deepEqual(painted, []);
  const out = await L.PDFDocument.load(bytes);
  const M = matrices(contentOf(out, out.getPage(0)));
  // /Rotate 90 is clockwise: the stored page's top-left is shown top-right
  const [x, y] = apply(M, 0, 841.89);
  assert.ok(Math.abs(x - 841.89) < 0.5 && Math.abs(y - 595.28) < 0.5, `top-left at ${x}, ${y}`);
});

test('a blank page, with no drawing to copy, does not stop the export', async () => {
  const doc = await L.PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const src = await doc.save();
  const scene = new D.Scene();
  scene.add(D.make.pdfpage({ id: 'pg', asset: 'a', page: 1, pages: 1, x: 0, y: 0, w: 794, h: 1123, pw: 595.28, ph: 841.89 }));
  const bytes = await P.vector(L, { scene, getAsset: async () => src }, P.plan(scene), {}, { paint: async () => null });
  assert.equal((await L.PDFDocument.load(bytes)).getPageCount(), 1);
});

test('no limit on length: a long run is painted in full-resolution tiles, and a long sheet keeps its size', async () => {
  const scene = new D.Scene();
  // a strip of text boxes 30000 units long: past a canvas, and past 200 inches
  for (let i = 0; i < 30; i++) scene.add(D.make.text({ id: 't' + i, x: 20, y: 20 + i * 1000, w: 300, text: 'line ' + i }));
  const crops = [];
  const app = { scene, getAsset: async () => null };
  const bytes = await P.vector(L, app, P.plan(scene), {}, { paint: async (items, crop) => { crops.push(crop); return { png: png(), x: crop.x, y: crop.y, w: crop.w, h: crop.h }; } });
  assert.ok(crops.length > 1, 'cut into tiles');
  assert.ok(crops.every(c => c.w <= 1920 && c.h <= 1920), 'each one small enough to paint at 200 dpi');
  const out = await L.PDFDocument.load(bytes);
  const page = out.getPage(0);
  const unit = page.node.get(L.PDFName.of('UserUnit'));
  assert.ok(unit, 'written in bigger units');
  const u = unit.asNumber();
  assert.ok(page.getHeight() <= 14400, 'inside what a reader opens');
  const want = P.plan(scene)[0].h * 72 / 96;
  assert.ok(Math.abs(page.getHeight() * u - want) < 1, `at its true length (${page.getHeight() * u} of ${want})`);
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

test('a region of the board: one sheet at its actual size, or fitted to paper, turned its way, and clipped to it', async () => {
  const P2 = P.PAPER;
  const box = D.util.box(100, 100, 700, 400);
  const [actual] = P.plan(null, null, { box });
  assert.deepEqual([actual.x, actual.y, actual.w, actual.h], [100, 100, 600, 300], 'the region itself');
  assert.ok(!actual.clip && !actual.pt);

  const [a4] = P.plan(null, null, { box, paper: 'a4' });
  assert.deepEqual([a4.pt.w, a4.pt.h], [P2.a4[1], P2.a4[0]], 'a wide region lies on landscape paper');
  assert.ok(Math.abs(a4.w / a4.h - a4.pt.w / a4.pt.h) < 1e-9, 'the sheet has the paper’s shape');
  assert.ok(a4.x < box.x && a4.x + a4.w > box.x2 && a4.y <= box.y && a4.y + a4.h >= box.y2, 'and holds the region, with room round it');
  assert.ok(Math.abs((a4.x + a4.w / 2) - 400) < 1e-9 && Math.abs((a4.y + a4.h / 2) - 250) < 1e-9, 'centred on it');
  assert.equal(P.plan(null, null, { box: D.util.box(0, 0, 100, 500), paper: 'letter' })[0].pt.h, 792, 'a tall one on upright paper');
  assert.equal(P.plan(null, null, { box: D.util.box(0, 0, 0, 10) }).length, 0, 'an empty region is nothing to print');

  // in the file: the paper's size, and the drawing clipped to the region
  const scene = new D.Scene();
  scene.add(D.make.stroke({ id: 'in', pts: inked([150, 150, 600, 300]), size: 3 }));
  scene.add(D.make.stroke({ id: 'out', pts: inked([2000, 2000, 2100, 2050]), size: 3 }));
  const bytes = await P.vector(L, { scene }, [a4], {}, { paint: async () => null });
  const out = await L.PDFDocument.load(bytes);
  const [page] = out.getPages();
  assert.ok(Math.abs(page.getWidth() - P2.a4[1]) < 0.01 && Math.abs(page.getHeight() - P2.a4[0]) < 0.01);
  const ops = contentOf(out, page);
  assert.match(ops, /re\nW\nn/, 'a clip round the region');
  const clipAt = ops.indexOf('W\nn'), bg = ops.indexOf(' rg\n');
  assert.ok(bg < clipAt, 'after the paper, which fills the whole sheet');
  assert.ok(ops.lastIndexOf(' m\n') > clipAt, 'and before the ink, which is drawn inside it');
});

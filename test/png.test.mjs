/* The PNG writer (png.js): a picture handed over a strip at a time comes
   out as one valid PNG, so an export is not bounded by a canvas. Checked
   by decoding the file by hand with zlib. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync, crc32 } from 'node:zlib';
import { load } from './harness.mjs';

const D = load('util.js', g => Object.assign(g, { CompressionStream, Blob, DataView }), 'png.js');

/** the chunks of a PNG, checking each CRC on the way */
function chunks(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'the signature');
  const out = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    assert.equal(buf.readUInt32BE(o + 8 + len), crc32(buf.subarray(o + 4, o + 8 + len)), type + ' CRC');
    out.push({ type, data });
    o += 12 + len;
  }
  return out;
}

/** decoded RGBA, undoing the filters PNG allows (the writer uses Sub) */
function decode(buf) {
  const cs = chunks(buf), ih = cs[0].data;
  const w = ih.readUInt32BE(0), h = ih.readUInt32BE(4);
  assert.equal(ih[8], 8); assert.equal(ih[9], 6);
  assert.equal(cs[cs.length - 1].type, 'IEND');
  const raw = inflateSync(Buffer.concat(cs.filter(c => c.type === 'IDAT').map(c => c.data)));
  const stride = w * 4, px = Buffer.alloc(w * h * 4);
  assert.equal(raw.length, h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    assert.ok(f === 0 || f === 1, 'filter ' + f);
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i], left = f === 1 && i >= 4 ? px[y * stride + i - 4] : 0;
      px[y * stride + i] = (v + left) & 255;
    }
  }
  return { w, h, px };
}

const pixel = (x, y) => [x * 7 & 255, y * 13 & 255, (x + y) & 255, (x * y) & 255];

test('strips of rows come out as one picture, pixel for pixel', async () => {
  const w = 37, h = 23;
  async function* strips() {
    for (let top = 0; top < h; top += 5) {
      const n = Math.min(5, h - top), s = new Uint8ClampedArray(w * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < w; x++) s.set(pixel(x, top + y), (y * w + x) * 4);
      yield s;
    }
  }
  const blob = await D.png.write(w, h, strips());
  assert.equal(blob.type, 'image/png');
  const { w: W, h: H, px } = decode(Buffer.from(await blob.arrayBuffer()));
  assert.equal(W, w); assert.equal(H, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    assert.deepEqual([...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)], pixel(x, y), `at ${x}, ${y}`);
});

test('bigger than any canvas, in a strip at a time: 40000 px wide', async () => {
  const w = 40000, h = 64;
  function* strips() { for (let i = 0; i < 4; i++) yield new Uint8ClampedArray(w * 16 * 4).fill(i * 60); }
  const buf = Buffer.from(await (await D.png.write(w, h, strips())).arrayBuffer());
  const { w: W, px } = decode(buf);
  assert.equal(W, 40000);
  assert.equal(px[(63 * w + 39999) * 4], 180, 'the last strip, to the last pixel');
  assert.ok(buf.length < 100000, `flat colour compresses (${buf.length} bytes)`);
});

test('the wrong number of rows is an error, not a broken file', async () => {
  await assert.rejects(D.png.write(4, 4, [new Uint8ClampedArray(4 * 2 * 4)]), /2 rows of 4/);
  await assert.rejects(D.png.write(4, 1, [new Uint8ClampedArray(10)]), /part of a row/);
});

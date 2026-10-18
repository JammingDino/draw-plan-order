/* ── png.js ── a PNG written a strip at a time ─────────────────────────
   A canvas can only be so big (Chrome: 32767px a side, 268M pixels in
   all), and canvas.toBlob needs the whole picture on one. A PNG file has
   no such limit: its pixels are one deflate stream of rows, top to
   bottom. So the picture is handed over in strips of rows, painted
   however the caller likes (in tiles, say); each strip is filtered and
   pushed through CompressionStream('deflate'), which makes the zlib
   stream PNG wants, and what comes out is cut into IDAT chunks. Only one
   strip of raw pixels is ever in memory, so the size of the export is
   bounded by the file, not by a canvas.

   D.png.write(w, h, strips) → Promise<Blob>
     strips: an (async) iterable of RGBA (unpremultiplied, as
     getImageData gives) for whole rows, top to bottom, w * 4 bytes a row,
     h rows in all.                                                    */
(function (D) {
  'use strict';

  const CRC = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC[n] = c;
  }
  function crc32(bytes, c = -1) {
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return c;
  }

  const enc = new TextEncoder();
  /** one chunk: length, type, data, and the CRC of type and data */
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(enc.encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, ~crc32(out.subarray(4, 8 + data.length)) >>> 0);
    return out;
  }

  /**
   * Filter rows with PNG's Sub filter: each byte less the same channel of
   * the pixel to its left. It costs a subtraction a byte and lets the
   * flat stretches of a board — paper, a long stroke — compress to
   * almost nothing.
   */
  function filtered(rgba, w) {
    const stride = w * 4, rows = rgba.length / stride;
    const out = new Uint8Array(rows * (stride + 1));
    for (let y = 0; y < rows; y++) {
      const s = y * stride, o = y * (stride + 1);
      out[o] = 1;
      for (let i = 0; i < 4 && i < stride; i++) out[o + 1 + i] = rgba[s + i];
      for (let i = 4; i < stride; i++) out[o + 1 + i] = (rgba[s + i] - rgba[s + i - 4]) & 255;
    }
    return out;
  }

  async function write(w, h, strips) {
    if (!(w >= 1 && h >= 1 && w < 2 ** 31 && h < 2 ** 31)) throw new Error('a PNG cannot be that size');
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
    const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
    v.setUint32(0, w); v.setUint32(4, h);
    ihdr[8] = 8; ihdr[9] = 6;                   // 8 bits a channel, RGBA
    parts.push(chunk('IHDR', ihdr));

    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    // read as we write, or the compressor's queue fills and the writes stall
    const reading = (async () => {
      const reader = cs.readable.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value.length) parts.push(chunk('IDAT', value));
      }
    })();

    let rows = 0;
    try {
      for await (const strip of strips) {
        if (strip.length % (w * 4)) throw new Error('a strip of part of a row');
        rows += strip.length / (w * 4);
        if (rows > h) throw new Error('more rows than the picture has');
        await writer.ready;
        await writer.write(filtered(strip, w));
      }
      if (rows !== h) throw new Error(`${rows} rows of ${h}`);
      await writer.close();
    } catch (err) {
      writer.abort(err).catch(() => { });
      await reading.catch(() => { });
      throw err;
    }
    await reading;
    parts.push(chunk('IEND', new Uint8Array(0)));
    return new Blob(parts, { type: 'image/png' });
  }

  D.png = { write, crc32 };
})(window.DPO);

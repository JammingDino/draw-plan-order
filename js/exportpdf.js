/* ── exportpdf.js ── the board as a PDF, a sheet per page ─────────────
   Each page on the board (js/frames.js) — drawn with the page tool, or a
   page of an imported PDF — becomes a sheet of its own size, in reading
   order, so a marked-up PDF goes back as the same pages with the writing
   on them; a board with no pages comes out as one sheet round everything. A sheet is the board painted at 200 dpi, on
   light paper — it is for printing and handing in — and set into the
   PDF as a picture: lossless (deflated, as PNG is) when the page is ink
   and shapes, JPEG when it carries photos or PDF pages, which would
   otherwise come out several times the size.

   No library: the file is a dozen objects written out by hand — the
   catalogue, the page tree, and for each sheet its page, its one-line
   drawing and its picture — and a cross-reference table of where each
   starts. CompressionStream does the deflating; every browser the app
   runs in, and node, has it.

   D.exportPdf(app, { frames? }) → Promise   frames: only these pages
   D.exportPdf.plan(scene) → [{ x, y, w, h, frame? }]   the sheets
   D.exportPdf.write(sheets, info) → Uint8Array
     sheets: [{ w, h (points), img: { w, h, filter: 'FlateDecode'|'DCTDecode', data } }]   */
(function (D) {
  'use strict';
  const U = D.util;

  const DPI = 200;
  const PT = 72 / 96;                   // points in a board unit (a CSS px)
  const MAX_SIDE = 12000, MAX_AREA = 60e6;
  const PAD = 40;                        // round the content, for a board with no pages

  /** the sheets to print: the pages, or one round everything */
  function plan(scene, only) {
    const pages = only && only.length ? only : D.frames ? D.frames.sheets(scene) : [];
    if (pages.length) return pages.map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h, frame: f, pt: D.frames.pointsOf(f) }));
    const b = scene.contentBounds();
    if (!b) return [];
    return [{ x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 }];
  }

  /* ── the file ──────────────────────────────────────────────────── */
  const enc = new TextEncoder();
  /** text as a PDF string that keeps any character: UTF-16, big-endian, in hex */
  function pdfText(s) {
    let h = 'FEFF';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (c > 0xffff) { const v = c - 0x10000; h += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0'); }
      else h += c.toString(16).padStart(4, '0');
    }
    return '<' + h.toUpperCase() + '>';
  }
  const num = v => (Math.round(v * 1000) / 1000).toString();

  function write(sheets, info = {}) {
    const parts = [], offsets = [];
    let len = 0;
    const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, body, stream) => {
      offsets[n] = len;
      put(`${n} 0 obj\n`);
      if (stream) { put(body.replace(/>>$/, ` /Length ${stream.length} >>`) + '\nstream\n'); put(stream); put('\nendstream'); }
      else put(body);
      put('\nendobj\n');
    };
    put('%PDF-1.4\n%âãÏÓ\n');
    const n = sheets.length, info0 = 3 + n * 3;
    const kids = sheets.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    sheets.forEach((s, i) => {
      const p = 3 + i * 3, w = num(s.w), h = num(s.h);
      obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
      obj(p + 1, '<< >>', enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`));
      obj(p + 2, `<< /Type /XObject /Subtype /Image /Width ${s.img.w} /Height ${s.img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${s.img.filter} >>`, s.img.data);
    });
    obj(info0, `<< /Title ${pdfText(info.title || 'Board')} /Producer ${pdfText(info.producer || 'Workings')} >>`);
    const xref = len;
    let x = `xref\n0 ${info0 + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= info0; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    put(x);
    put(`trailer\n<< /Size ${info0 + 1} /Root 1 0 R /Info ${info0} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len);
    let o = 0;
    for (const b of parts) { out.set(b, o); o += b.length; }
    return out;
  }

  /** RGB(A) pixels → deflated RGB, as FlateDecode wants them */
  async function deflateRGB(rgba, w, h) {
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
    const cs = new CompressionStream('deflate');
    const out = new Response(new Blob([rgb]).stream().pipeThrough(cs));
    return new Uint8Array(await out.arrayBuffer());
  }

  /* ── painting a sheet ──────────────────────────────────────────── */
  async function sheet(app, s, look) {
    const r = app.renderer, scene = app.scene;
    const scale = Math.min(DPI / 96, MAX_SIDE / s.w, MAX_SIDE / s.h, Math.sqrt(MAX_AREA / (s.w * s.h)));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s.w * scale));
    c.height = Math.max(1, Math.round(s.h * scale));
    const ctx = c.getContext('2d');
    try {
      ctx.fillStyle = U.paintAs(look.theme, () => U.color('paper'));
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(scale, 0, 0, scale, -s.x * scale, -s.y * scale);
      ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const box = U.box(s.x, s.y, s.x + s.w, s.y + s.h);
      const items = scene.items.filter(it => U.boxesOverlap(scene.bbox(it), box));
      r.printing = true;
      try { await r.paintExport(ctx, items, scale, look); } finally { r.printing = false; }
      const photo = items.some(it => it.type === 'image' || it.type === 'pdfpage');
      let img;
      if (photo || typeof CompressionStream !== 'function') {
        const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
        if (!blob) throw new Error('the page was too big to draw');
        img = { w: c.width, h: c.height, filter: 'DCTDecode', data: new Uint8Array(await blob.arrayBuffer()) };
      } else {
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        img = { w: c.width, h: c.height, filter: 'FlateDecode', data: await deflateRGB(px, c.width, c.height) };
      }
      return { w: s.pt ? s.pt.w : s.w * PT, h: s.pt ? s.pt.h : s.h * PT, img };
    } finally { c.width = 0; c.height = 0; }
  }

  let busy = false;
  async function exportPdf(app, opts = {}) {
    const sheets = plan(app.scene, opts.frames);
    if (!sheets.length) { app.toast('Nothing to export'); return null; }
    if (busy) return null;
    busy = true;
    const look = { theme: 'light', dark: false, transparent: false };
    const say = t => app.ui && app.ui.toast ? app.ui.toast(t, null, null, 60000) : null;
    try {
      const out = [];
      for (let i = 0; i < sheets.length; i++) {
        if (sheets.length > 1) say(`Exporting page ${i + 1} of ${sheets.length}…`);
        else say('Exporting…');
        out.push(await sheet(app, sheets[i], look));
      }
      const name = (app.board && app.board.name) || 'Board';
      const bytes = write(out, { title: name });
      if (opts.download !== false) save(new Blob([bytes], { type: 'application/pdf' }), safeName(opts.frames && opts.frames.length === 1 && D.frames ? D.frames.nameOf(app.scene, opts.frames[0]) : name) + '.pdf');
      if (app.ui && app.ui.hideToast) app.ui.hideToast();
      app.toast(sheets.length > 1 ? `Exported ${sheets.length} pages` : 'Exported');
      return bytes;
    } catch (err) {
      console.error(err);
      app.toast('The export did not finish: ' + (err.message || err));
      return null;
    } finally { busy = false; }
  }

  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const safeName = s => String(s || 'board').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'board';

  exportPdf.plan = plan;
  exportPdf.write = write;
  exportPdf.deflateRGB = deflateRGB;
  D.exportPdf = exportPdf;

  D.ext.pressActions.push({
    id: 'export-pdf', label: 'Export PDF', icon: 'M6 3h9l4 4v14H6z|M15 3v4h4|M12 10v7|M9 14l3 3 3-3', order: 90,
    when: ctx => ctx.source === 'menu' && !ctx.selection.length,
    run: ctx => exportPdf(ctx.app)
  });
})(window.DPO);

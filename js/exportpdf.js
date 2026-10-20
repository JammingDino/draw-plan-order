/* ── exportpdf.js ── the board as a PDF, a sheet per page ─────────────
   Each page on the board (js/frames.js) — drawn with the page tool, or a
   page of an imported PDF — becomes a sheet of its own size, in reading
   order, so a marked-up PDF goes back as the same pages with the writing
   on them; a board with no pages comes out as one sheet round everything.
   Sheets are on light paper, whatever the theme: they are for printing
   and handing in.

   ── Vector, mostly ────────────────────────────────────────────────────
   A sheet is built in the board's own order, back to front, from three
   kinds of layer:

     a page of an imported PDF   the original page itself, copied out of
                                 the PDF, so its text stays text: sharp at
                                 any zoom, selectable and searchable, and
                                 no bigger than it was — turned, if it is
                                 turned on the board or has a /Rotate
     ink                        each stroke as the filled outline it is on
                                 screen, highlighters with their see-through
                                 and multiply, so it is sharp at any zoom
     everything else             (text boxes, notes, shapes, graphs, ruled
                                 paper…) painted at 200 dpi into a
                                 see-through picture cropped to what it
                                 holds, between the layers it sits between

   The file is made by pdf-lib (vendor/pdf-lib, MIT), loaded the first
   time something is exported. What it cannot copy — a PDF that is
   encrypted or damaged — is painted instead, as everything else is. If
   pdf-lib cannot be loaded at all, the whole export falls back to the
   old way below: each sheet one 200 dpi picture, in a file written by
   hand.

   ── No limit on size ──────────────────────────────────────────────────
   A canvas has a ceiling, so a painted run goes in as tiles that each
   fit, every one at the full 200 dpi, rather than as one picture that
   got blurrier the longer the board was. And a sheet past 200 inches —
   the most a PDF page can be in its ordinary units — is written in
   bigger ones (/UserUnit), so a long board comes out as one long page
   at its true size instead of one a reader refuses.

   ── The raster writer (the fallback) ─────────────────────────────────
   No library: the file is a dozen objects written out by hand — the
   catalogue, the page tree, and for each sheet its page, its one-line
   drawing and its picture — and a cross-reference table of where each
   starts. CompressionStream does the deflating.

   D.exportPdf(app, { frames? }) → Promise   frames: only these pages
   D.exportPdf.plan(scene) → [{ x, y, w, h, frame? }]   the sheets
   D.exportPdf.layers(items, canCopy) → [{ kind: 'pdf'|'ink'|'paint', items }]
   D.exportPdf.vector(L, app, sheets, info, hooks?) → Promise<Uint8Array>
     L: pdf-lib; hooks.paint(items, crop) → { png, x, y, w, h } | null,
     how a run of painted items becomes a picture (a canvas, in the app)
   D.exportPdf.write(sheets, info) → Uint8Array
     sheets: [{ w, h (points), img: { w, h, filter: 'FlateDecode'|'DCTDecode', data } }]   */
(function (D) {
  'use strict';
  const U = D.util, FH = D.freehand;

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

  /* ── the vector file ───────────────────────────────────────────── */
  const LIB = 'vendor/pdf-lib/pdf-lib.min.js';
  let libLoading = null;
  function lib() {
    const g = typeof window !== 'undefined' ? window : globalThis;
    if (g.PDFLib) return Promise.resolve(g.PDFLib);
    if (libLoading) return libLoading;
    libLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL(LIB, document.baseURI).href;
      s.async = true;
      s.onload = () => g.PDFLib ? resolve(g.PDFLib) : reject(new Error('pdf-lib did not load'));
      s.onerror = () => { libLoading = null; s.remove(); reject(new Error('Could not load the PDF library')); };
      document.head.appendChild(s);
    });
    return libLoading;
  }

  /* Ink that goes in as paths: a stroke with its points, not turned as a
     box (strokes never are — their points are turned instead). */
  const isInk = it => it.type === 'stroke' && it.pts && it.pts.length >= 3;

  /**
   * The sheet's items as layers, in board order: consecutive strokes
   * together as ink, PDF pages that can be copied on their own, and the
   * rest gathered into runs to paint. `canCopy(it)` says whether a PDF
   * page can go in as itself.
   */
  function layers(items, canCopy) {
    const out = [];
    for (const it of items) {
      const kind = isInk(it) ? 'ink' : it.type === 'pdfpage' && canCopy(it) ? 'pdf' : 'paint';
      const last = out[out.length - 1];
      if (last && last.kind === kind && kind !== 'pdf') last.items.push(it);
      else out.push({ kind, items: [it] });
    }
    return out;
  }

  /** a CSS colour as 0–1 rgb and alpha, by way of a canvas, which knows them all */
  let probe = null;
  function rgbaOf(c) {
    let s = String(c || '').trim();
    if (!/^#|^rgb/i.test(s) && typeof document !== 'undefined') {
      probe = probe || document.createElement('canvas').getContext('2d');
      probe.fillStyle = '#000'; probe.fillStyle = s; s = String(probe.fillStyle);
    }
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = [...h].map(x => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    }
    m = /^rgba?\(([^)]+)\)/i.exec(s);
    if (m) {
      const [r, g, b, a] = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      return { r: r / 255, g: g / 255, b: b / 255, a: a == null || isNaN(a) ? 1 : a };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  const f2 = v => (Math.round(v * 100) / 100).toString();
  /** a stroke's outline as SVG path data, in board units */
  function strokePath(it) {
    const polys = FH.shapes(it.pts, { size: it.size, thinning: it.thinning, taper: it.taper || 0, cap: it.cap !== false });
    let d = '';
    for (const p of polys) {
      if (p.length < 6) continue;
      d += 'M' + f2(p[0]) + ' ' + f2(p[1]);
      for (let i = 2; i < p.length; i += 2) d += 'L' + f2(p[i]) + ' ' + f2(p[i + 1]);
      d += 'Z';
    }
    return d;
  }

  /**
   * Draw a run of strokes onto `page`. Opaque strokes of one colour are
   * filled as one path, which looks the same (an opaque union is a union)
   * and is a fraction of the file; see-through ones go one by one, so two
   * that overlap darken where they cross, as they do on the board.
   */
  function drawInk(L, page, strokes, at) {
    let batch = '', key = null, colour = null;
    const flush = () => {
      if (batch) page.drawSvgPath(batch, { ...at, color: L.rgb(colour.r, colour.g, colour.b), borderWidth: 0 });
      batch = ''; key = null;
    };
    for (const it of strokes) {
      const c = rgbaOf(U.color(it.color));
      const alpha = (it.alpha ?? 1) * c.a;
      const d = strokePath(it);
      if (!d) continue;
      if (alpha >= 1 && (it.blend || 'source-over') === 'source-over') {
        const k = c.r + ',' + c.g + ',' + c.b;
        if (k !== key) { flush(); key = k; colour = c; }
        batch += d;
        continue;
      }
      flush();
      page.drawSvgPath(d, {
        ...at, color: L.rgb(c.r, c.g, c.b), opacity: alpha, borderWidth: 0,
        ...(it.blend === 'multiply' ? { blendMode: L.BlendMode.Multiply } : {})
      });
    }
    flush();
  }

  /* An imported PDF, opened once per export. null when it cannot be
     copied from (encrypted, damaged, missing): its pages are painted. */
  async function sourceOf(L, app, cache, asset) {
    if (cache.has(asset)) return cache.get(asset);
    let src = null;
    try {
      const bytes = await app.getAsset(asset);
      if (bytes && bytes.length) src = await L.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) { console.warn('[dpo] PDF export: painting the pages of', asset, 'instead:', err && err.message); src = null; }
    cache.set(asset, src);
    return src;
  }

  async function vector(L, app, sheets, info = {}, hooks = {}) {
    const scene = app.scene;
    const paint = hooks.paint || ((items, crop) => paintRun(app, items, crop));
    const doc = await L.PDFDocument.create();
    doc.setTitle(String(info.title || 'Board'));
    doc.setProducer(String(info.producer || 'Workings'));
    doc.setCreator('Workings');

    // the PDFs whose pages are on these sheets, opened before anything is drawn
    const sources = new Map(), copies = new Map();
    for (const s of sheets) {
      const box = U.box(s.x, s.y, s.x + s.w, s.y + s.h);
      for (const it of scene.items) if (it.type === 'pdfpage' && it.asset && U.boxesOverlap(scene.bbox(it), box)) await sourceOf(L, app, sources, it.asset);
    }
    const canCopy = it => {
      const src = sources.get(it.asset);
      return !!src && it.page >= 1 && it.page <= src.getPageCount();
    };

    const paper = rgbaOf(U.paintAs('light', () => U.color('paper')));
    for (const s of sheets) {
      const W = s.pt ? s.pt.w : s.w * PT, H = s.pt ? s.pt.h : s.h * PT, k = W / s.w;
      const page = doc.addPage();
      page.setSize(W, H);
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: L.rgb(paper.r, paper.g, paper.b), borderWidth: 0 });
      // board (x, y) → page: x right from the sheet's left, y up from its foot
      const at = { x: -s.x * k, y: H + s.y * k, scale: k };
      const box = U.box(s.x, s.y, s.x + s.w, s.y + s.h);
      const items = scene.items.filter(it => U.boxesOverlap(scene.bbox(it), box));

      for (const layer of layers(items, canCopy)) {
        if (layer.kind === 'ink') { U.paintAs('light', () => drawInk(L, page, layer.items, at)); continue; }
        if (layer.kind === 'pdf') {
          const it = layer.items[0], key = it.asset + '#' + it.page;
          let copy = copies.get(key);
          if (!copy) {
            const src = sources.get(it.asset), sp = src.getPage(it.page - 1);
            // a blank page has no drawing at all, and pdf-lib will not embed one
            if (!sp.node.Contents()) continue;
            const cb = sp.getCropBox();
            const emb = await doc.embedPage(sp, { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
            copy = { emb, turn: ((sp.getRotation().angle % 360) + 360) % 360 };
            copies.set(key, copy);
          }
          page.drawPage(copy.emb, placePage(L, copy, it, scene, s, k, H));
          continue;
        }
        // painted: cropped to what the run covers on this sheet
        let crop = null;
        for (const it of layer.items) crop = U.unionBox(crop, scene.bbox(it));
        crop = crop && intersect(crop, box);
        if (!crop || crop.w <= 0 || crop.h <= 0) continue;
        for (const part of tiles(crop)) {
          const pic = await paint(layer.items, part);
          if (!pic || !pic.png) continue;
          const img = await doc.embedPng(pic.png);
          page.drawImage(img, { x: (pic.x - s.x) * k, y: H - (pic.y - s.y + pic.h) * k, width: pic.w * k, height: pic.h * k });
        }
      }
      bigUnits(L, page);
    }
    return doc.save();
  }

  /**
   * drawPage's options for a copied page, so that it fills the item's
   * box on the sheet. The copy is the page as stored, before its own
   * /Rotate (embedding ignores it), so that turn goes back on here, with
   * any turn it has on the board. Both are clockwise as seen; PDF turns
   * the other way.
   */
  function placePage(L, { emb, turn }, it, scene, s, k, H) {
    const side = turn % 180 !== 0;
    const sx = (side ? it.h : it.w) * k / emb.width, sy = (side ? it.w : it.h) * k / emb.height;
    const b = it.rot ? scene.bbox(it) : null;
    const c = b && b.local ? U.boxCenter(b.local) : { x: it.x + it.w / 2, y: it.y + it.h / 2 };
    const a = -(turn * Math.PI / 180 + (it.rot || 0)), cos = Math.cos(a), sin = Math.sin(a);
    // the form's middle, turned and scaled, has to land on the item's middle
    const hx = sx * emb.width / 2, hy = sy * emb.height / 2;
    const cx = (c.x - s.x) * k, cy = H - (c.y - s.y) * k;
    return {
      x: cx - (cos * hx - sin * hy), y: cy - (sin * hx + cos * hy),
      xScale: sx, yScale: sy, rotate: L.radians(a), opacity: it.alpha ?? 1
    };
  }

  /* A painted run is cut into tiles of this many board units: 4000 px at
     200 dpi exactly, and on whole units, so neighbours meet on a pixel
     edge and nothing is painted twice. */
  const TILE = 1920;
  function tiles(crop) {
    const x0 = Math.floor(crop.x - 2), y0 = Math.floor(crop.y - 2);
    const x1 = Math.ceil(crop.x2 + 2), y1 = Math.ceil(crop.y2 + 2);
    const out = [];
    for (let y = y0; y < y1; y += TILE)
      for (let x = x0; x < x1; x += TILE) out.push(U.box(x, y, Math.min(x1, x + TILE), Math.min(y1, y + TILE)));
    return out;
  }

  /* 14400 (200 in) is the longest page side readers promise to open. A
     longer sheet keeps its true size by counting in bigger units: its
     drawing is scaled down by u, and /UserUnit says a unit is u points. */
  const PAGE_LIMIT = 14400;
  function bigUnits(L, page) {
    const side = Math.max(page.getWidth(), page.getHeight());
    if (side <= PAGE_LIMIT) return;
    const u = Math.ceil(side / PAGE_LIMIT);
    page.scale(1 / u, 1 / u);
    page.node.set(L.PDFName.of('UserUnit'), L.PDFNumber.of(u));
  }

  function intersect(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    return x2 > x && y2 > y ? U.box(x, y, x2, y2) : null;
  }

  /** one tile of a run of items painted at 200 dpi on a see-through canvas, as PNG bytes */
  async function paintRun(app, items, crop) {
    const x = Math.floor(crop.x), y = Math.floor(crop.y);
    const w = Math.ceil(crop.x2) - x, h = Math.ceil(crop.y2) - y;
    const scale = DPI / 96;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    const r = app.renderer;
    try {
      ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      r.printing = true;
      try { await r.paintExport(ctx, items, scale, { theme: 'light', dark: false, transparent: true }); } finally { r.printing = false; }
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      if (!blob) throw new Error('the page was too big to draw');
      return { png: new Uint8Array(await blob.arrayBuffer()), x, y, w, h };
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
      const name = (app.board && app.board.name) || 'Board';
      let bytes = null;
      say(sheets.length > 1 ? `Exporting ${sheets.length} pages…` : 'Exporting…');
      let L = null;
      try { L = await lib(); } catch (err) { console.warn('[dpo] PDF export: no pdf-lib, every sheet a picture', err); }
      if (L) bytes = await vector(L, app, sheets, { title: name });
      else {
        const out = [];
        for (let i = 0; i < sheets.length; i++) {
          if (sheets.length > 1) say(`Exporting page ${i + 1} of ${sheets.length}…`);
          out.push(await sheet(app, sheets[i], look));
        }
        bytes = write(out, { title: name });
      }
      if (app.ui && app.ui.hideToast) app.ui.hideToast();
      // for the export dialog, which saves it where it was asked to and says so itself
      if (opts.download === false) return bytes;
      save(new Blob([bytes], { type: 'application/pdf' }), fileName(app, opts.frames));
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
  /** what the file is called: the page's name when it is one page of the board, else the board's */
  const fileName = (app, frames) => safeName(frames && frames.length === 1 && D.frames ? D.frames.nameOf(app.scene, frames[0]) : (app.board && app.board.name) || 'Board') + '.pdf';

  exportPdf.plan = plan;
  exportPdf.fileName = fileName;
  exportPdf.layers = layers;
  exportPdf.vector = vector;
  exportPdf.write = write;
  exportPdf.deflateRGB = deflateRGB;
  D.exportPdf = exportPdf;

  D.ext.pressActions.push({
    id: 'export-pdf', label: 'Export PDF', icon: 'M6 3h9l4 4v14H6z|M15 3v4h4|M12 10v7|M9 14l3 3 3-3', order: 90,
    when: ctx => ctx.source === 'menu' && !ctx.selection.length,
    run: ctx => ctx.app.openExport ? ctx.app.openExport('pdf') : exportPdf(ctx.app)
  });
})(window.DPO);

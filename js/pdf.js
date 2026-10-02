/* ── pdf.js ── dropping a PDF onto the board ─────────────────────────
   Pages are not flattened into images at import time. The document is
   stored once and each page is rendered on demand at a resolution that
   suits the current zoom, so a 150-page PDF costs one copy of the file
   rather than 150 bitmaps, and it stays sharp when you zoom in to
   annotate it.

   Three things keep a long document usable, and all three matter:

   1. The cache is budgeted in BYTES, not in pages. A single A4 page at
      scale 4 is about 4000x5600x4 = 90MB, so a 48-page cache could reach
      several gigabytes and the tab died long before page 150.

   2. Requested scales are snapped to a ladder. Without that, every pixel
      of pen-zoom asks for a resolution nothing has, and the renderer
      thrashes re-rendering the same page forever.

   3. Every page keeps a cheap thumbnail, and only the handful actually
      on screen get a sharp render. Scrolling a long document then always
      has something to draw immediately, and work for pages that have
      scrolled away is cancelled rather than finished pointlessly.

   pdf.js is vendored under vendor/pdfjs so the desktop app works with no
   network at all. It is loaded the first time a PDF appears.         */
(function (D) {
  'use strict';
  const U = D.util;
  const P = D.pdf = {};

  /* ── budgets ─────────────────────────────────────────────────────
     Sized for a laptop, not a workstation. The sharp cache holds the
     few pages you are looking at; the thumbnail cache holds every page
     of a long document at a resolution where 150 of them still fit. */
  const HI_BUDGET      = 256 * 1024 * 1024; // sharp renders, total bytes
  const THUMB_BUDGET   =  64 * 1024 * 1024; // placeholders, total bytes
  const MAX_PAGE_BYTES =  64 * 1024 * 1024; // ceiling for any one bitmap
  const THUMB_SCALE    = 0.28;              // device px per world px
  const MAX_SCALE      = 4;                 // resolution ceiling overall
  const MAX_INFLIGHT   = 2;                 // concurrent page renders
  const STALE_MS       = 1500;              // unasked-for this long, drop it

  /* Snapping requests to a ladder is what stops zoom from thrashing: a
     pinch that drifts from 1.9 to 2.1 should not re-render anything. */
  const LADDER = [0.5, 0.75, 1, 1.5, 2, 3, 4];
  const snap = s => LADDER.find(v => v >= s) ?? MAX_SCALE;

  /* ── dark paper ──────────────────────────────────────────────────
     A white A4 page on a dark board is a floodlight. Rather than dim
     it (which greys the ink along with the paper) the page is rendered
     normally and then luminance-inverted: paper goes dark, black text
     goes light, and the hue-rotate puts colours back where they were,
     so a red stamp stays red instead of turning cyan.

     PAPER_DARK is then floored over the result with 'lighten', which
     lifts the now-pure-black background to a soft near-black without
     touching anything brighter than it. Pre-filling the render canvas
     is not enough on its own: most PDFs paint their own white page
     rectangle over whatever is underneath. */
  const PAPER_DARK = '#191b1f';
  const DARK_FILTER = 'invert(1) hue-rotate(180deg)';

  const isDark = () => document.documentElement?.dataset?.theme === 'dark';

  let lib = null;                 // the pdf.js module, once loaded
  const docs = new Map();         // assetId → Promise<PDFDocumentProxy>
  const hi = new Map();           // "asset:page" → {bitmap, scale, at, bytes}
  const thumbs = new Map();       // "asset:page" → {bitmap, scale, at, bytes}
  const wanted = new Map();       // key → {scale, at}: what recent frames asked for
  const inflight = new Map();     // token → {key, task, cancelled}
  const queue = [];               // pending render jobs

  P.available = () => true;

  const bytesOf = b => (b ? b.width * b.height * 4 : 0);
  const sum = m => { let n = 0; for (const v of m.values()) n += v.bytes || 0; return n; };

  async function load() {
    if (lib) return lib;
    // a bare specifier here would resolve against js/, not the page
    lib = await import(new URL('vendor/pdfjs/pdf.min.mjs', document.baseURI).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
    return lib;
  }

  /** open (and keep) a document from raw bytes */
  async function open(assetId, bytes) {
    if (docs.has(assetId)) return docs.get(assetId);
    const p = (async () => {
      const l = await load();
      const base = new URL('vendor/pdfjs/', document.baseURI).href;
      return l.getDocument({
        data: bytes.slice(0),
        isEvalSupported: false,
        // both are vendored: without the base-14 font data a page using
        // Helvetica never finishes rendering, and CJK needs the cmaps
        standardFontDataUrl: base + 'standard_fonts/',
        cMapUrl: base + 'cmaps/',
        cMapPacked: true
      }).promise;
    })();
    docs.set(assetId, p);
    return p;
  }
  P.open = open;

  /* ── import ──────────────────────────────────────────────────────── */

  /**
   * Lay an already-stored document out down the canvas.
   *
   * Split out from import so a PDF that is already in the vault can be
   * attached by reference: the host answers getAsset for it, and no copy
   * of a 15MB lecture set is made just to draw on top of it.
   *
   * Page sizes are fetched in parallel batches rather than one after
   * another. getPage is cheap, but 150 sequential awaits still stall the
   * UI long enough to feel broken on a drop.
   *
   * @returns the created page items
   */
  P.attach = async (app, assetId, label, at) => {
    app.toast(`Reading ${label}…`);
    const bytes = await app.getAsset(assetId);
    if (!bytes) { app.toast(`Could not read ${label}`); return []; }

    const doc = await open(assetId, bytes);
    const n = doc.numPages;
    const file = { name: label };

    const sizes = new Array(n);
    const BATCH = 16;
    for (let start = 0; start < n; start += BATCH) {
      const end = Math.min(n, start + BATCH);
      await Promise.all(Array.from({ length: end - start }, async (_, k) => {
        const idx = start + k;
        const page = await doc.getPage(idx + 1);
        const vp = page.getViewport({ scale: 1 });
        sizes[idx] = { w: vp.width, h: vp.height };
      }));
      if (n > 40) app.toast(`Reading ${file.name}… ${end}/${n}`);
      /* Hand the frame back so the progress toast actually paints and the
         window stays responsive while a long document is measured. */
      await new Promise(r => setTimeout(r, 0));
    }

    const gap = 28;
    const items = [];
    let y = at.y;
    for (let i = 0; i < n; i++) {
      const s = sizes[i];
      const w = Math.min(s.w, 1000);
      const h = s.h * (w / s.w);
      items.push(D.make.pdfpage({
        asset: assetId, page: i + 1, pages: n, label: file.name,
        x: at.x - w / 2, y, w, h
      }));
      y += h + gap;
    }

    app.scene.begin('add pdf');
    for (const it of items) app.scene.add(it, 0);      // behind anything already drawn
    app.scene.commit();
    app.afterEdit();
    app.toast(`${file.name} · ${n} page${n === 1 ? '' : 's'}`);
    return items;
  };

  /**
   * Import a PDF dropped onto the board: store the bytes as a board
   * asset, then lay it out.
   */
  P.import = async (app, file, at) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const assetId = U.uid();
    await app.putAsset(assetId, bytes, { name: file.name, type: 'application/pdf' });
    return P.attach(app, assetId, file.name, at);
  };

  /* ── the drawing path ────────────────────────────────────────────── */

  /**
   * The bitmap to paint for a page right now.
   *
   * Never blocks and never throws: it returns the best thing already in
   * memory (a sharp render, else a thumbnail, else null for the caller
   * to draw its placeholder) and schedules whatever is missing. The
   * renderer calls this once per visible page per frame, which is also
   * how we learn which pages are on screen.
   */
  P.bitmap = (app, item, wantScale) => {
    const key = item.asset + ':' + item.page;
    const now = performance.now();
    const want = Math.min(snap(wantScale), maxScaleFor(item));
    const dark = isDark();

    // record interest — sweep() uses this to cancel work for pages that left
    wanted.set(key, { scale: want, at: now });

    const sharp = inTheme(hi.get(key), dark);
    if (sharp && sharp.bitmap && sharp.scale >= want) {
      sharp.at = now;
      return sharp.bitmap;
    }

    const thumb = inTheme(thumbs.get(key), dark);
    if (thumb) thumb.at = now;

    if (!sharp || !sharp.failed) {
      if (!thumb) request(app, item, key, THUMB_SCALE, true, dark);
      request(app, item, key, want, false, dark);
    }

    /* Prefer a stale sharp render over a thumbnail: a page held at the
       previous zoom still looks far better than a blurry placeholder. */
    if (sharp && sharp.bitmap) return sharp.bitmap;
    return thumb ? thumb.bitmap : null;
  };

  /* A bitmap baked for the other theme is worse than nothing: it would
     flash a white page on a dark board for as long as the re-render
     takes. A failure is a property of the page, not of the theme. */
  const inTheme = (e, dark) => (e && (e.failed || e.dark === dark)) ? e : null;

  /** Resolution ceiling for this page, so one huge page cannot eat the budget. */
  function maxScaleFor(item) {
    const aspect = item.h / Math.max(1, item.w);
    // bytes = (w*s) * (w*s*aspect) * 4  →  s = sqrt(bytes / (4 * w^2 * aspect))
    const s = Math.sqrt(MAX_PAGE_BYTES / (4 * item.w * item.w * Math.max(0.1, aspect)));
    return Math.max(0.5, Math.min(MAX_SCALE, s));
  }

  function request(app, item, key, scale, isThumb, dark) {
    const token = key + (isThumb ? ':t' : ':' + scale.toFixed(2)) + (dark ? ':d' : ':l');
    if (inflight.has(token)) return;
    if (queue.some(j => j.token === token)) return;
    queue.push({ token, key, item, scale, isThumb, dark, at: performance.now(), app });
    pump();
  }

  /**
   * How much this job deserves the next render slot.
   *
   * What matters first is whether the page is on screen *now*, not
   * whether the job is cheap. Ranking thumbnails above everything meant
   * that scrolling to page 145 of a 150-page document put 150 cheap
   * thumbnails ahead of the sharp render of the page being looked at, so
   * the page under the pen stayed blurry while the renderer worked
   * through pages nobody could see.
   *
   * Within the pages that are on screen the thumbnail does come first,
   * because it is one quick render that gets something visible up while
   * the sharp version is still being painted.
   *
   * Score 0 means nothing is looking at it and it is not worth doing.
   */
  function score(job, now) {
    const w = wanted.get(job.key);
    const fresh = w && now - w.at <= STALE_MS;
    if (fresh) return job.isThumb ? 3 : 2;
    return job.isThumb ? 1 : 0;   // stale thumbnails are background fill
  }

  function pump() {
    while (inflight.size < MAX_INFLIGHT && queue.length) {
      const now = performance.now();
      let best = 0, bestScore = score(queue[0], now);
      for (let i = 1; i < queue.length; i++) {
        const sc = score(queue[i], now);
        /* Ties go to the most recent request: mid-scroll, that is the
           one still under the pen. */
        if (sc > bestScore || (sc === bestScore && queue[i].at > queue[best].at)) {
          best = i; bestScore = sc;
        }
      }
      const job = queue.splice(best, 1)[0];
      if (bestScore === 0) continue;   // scrolled away while it sat in the queue
      run(job);
    }
  }

  /** an OffscreenCanvas where the platform has one, else a DOM canvas */
  function surface(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /**
   * Turn a rendered light page into a dark one, in place.
   *
   * Canvas 2D filters are the GPU's job, so this is two composited
   * draws rather than a pass over twenty million pixels. Where filter
   * is unsupported we still invert — via 'difference' against white —
   * and simply lose the hue correction, which is a far better failure
   * than handing back a page that blinds you.
   */
  function darken(c, w, h) {
    const ctx = c.getContext('2d', { alpha: false });
    const tmp = surface(w, h);
    const t = tmp.getContext('2d', { alpha: false });
    t.drawImage(c, 0, 0);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if ('filter' in ctx) {
      ctx.filter = DARK_FILTER;
      ctx.drawImage(tmp, 0, 0);
      ctx.filter = 'none';
    } else {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    // floor the paper at a soft near-black; anything brighter is ink
    ctx.globalCompositeOperation = 'lighten';
    ctx.fillStyle = PAPER_DARK;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    tmp.width = 0; tmp.height = 0;   // free the copy now, not at the next GC
  }

  /**
   * Paint one page into a fresh surface: `scale` device px per world px,
   * light or dark paper. `slot` (optional) is told the render task so the
   * caller can cancel it; null comes back if it was cancelled meanwhile.
   */
  async function renderPage(app, item, scale, dark, slot) {
    const bytes = await app.getAsset(item.asset);
    if (!bytes) return null;
    const doc = await open(item.asset, bytes);
    const page = await doc.getPage(item.page);
    const base = page.getViewport({ scale: 1 });
    // item.w is the page width in world units; scale is device px per world px
    const vp = page.getViewport({ scale: (item.w / base.width) * scale });

    /* OffscreenCanvas where we can: no DOM node per cached page, and
       drawImage takes it directly. */
    const w = Math.max(1, Math.round(vp.width));
    const h = Math.max(1, Math.round(vp.height));
    const c = surface(w, h);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    /* pdf.js paces its painting with requestAnimationFrame, which stops
       while the window is hidden or minimised, so a render started then
       never finishes. Cancel it rather than leaving the slot occupied
       forever — the first frame after the window comes back asks again
       (App.bindInput retries on visibilitychange). */
    const task = page.render({ canvasContext: ctx, viewport: vp });
    if (slot) slot.task = task;
    const stall = setTimeout(() => { try { task.cancel(); } catch (_) { } }, 20000);
    try { await task.promise; } finally { clearTimeout(stall); }
    if (slot && slot.cancelled) return null;
    if (dark) darken(c, w, h);
    return c;
  }

  /**
   * A page rendered for an export: at the export's resolution and in
   * its theme, whatever the screen is showing, and kept out of the
   * caches — an export is a one-off, and parking twenty full-resolution
   * pages in the sharp cache would evict everything on screen. The
   * caller owns the surface and should free it (width = 0) when done.
   * Null if the page cannot be rendered.
   */
  P.render = async (app, item, scale, dark) => {
    try { return await renderPage(app, item, Math.min(scale, maxScaleFor(item)), !!dark); }
    catch (e) { console.warn('[dpo] export render', e); return null; }
  };

  /**
   * The best bitmap already in memory for a page, without asking for
   * anything. For painters that are not the screen (the dashboard
   * thumbnail): they must not queue renders or mark pages as on screen.
   */
  P.peek = (item, dark) => {
    const key = item.asset + ':' + item.page;
    const sharp = inTheme(hi.get(key), !!dark);
    if (sharp && sharp.bitmap) return sharp.bitmap;
    const thumb = inTheme(thumbs.get(key), !!dark);
    return thumb ? thumb.bitmap : null;
  };

  async function run(job) {
    const { app, item, key, scale, token, isThumb, dark } = job;
    const slot = { key, task: null, cancelled: false };
    inflight.set(token, slot);
    try {
      const c = await renderPage(app, item, scale, dark, slot);
      if (!c) return;

      const entry = { bitmap: c, scale, dark, at: performance.now(), bytes: bytesOf(c) };
      if (isThumb) { thumbs.set(key, entry); trim(thumbs, THUMB_BUDGET); }
      else { hi.set(key, entry); trim(hi, HI_BUDGET); }
      app.requestDraw();
    } catch (e) {
      /* A cancelled render is how we stop wasted work; it is not a
         failure and must not poison the cache. */
      const msg = String((e && e.message) || e);
      if (slot.cancelled || /cancel/i.test(msg)) return;
      const prev = hi.get(key);
      // a failed re-render must not throw away a good bitmap we already have
      if (!prev || !prev.bitmap) {
        hi.set(key, {
          bitmap: null, scale: MAX_SCALE, at: performance.now(),
          bytes: 0, failed: true, err: msg
        });
      } else prev.err = msg;
    } finally {
      inflight.delete(token);
      pump();
    }
  }

  /**
   * Drop in-flight and queued work for pages nothing has asked about
   * recently. Called from the draw loop, after the frame that recorded
   * which pages are visible.
   */
  P.sweep = () => {
    const now = performance.now();
    for (const [key, w] of wanted) if (now - w.at > STALE_MS * 4) wanted.delete(key);

    for (const slot of inflight.values()) {
      const w = wanted.get(slot.key);
      if (w && now - w.at <= STALE_MS) continue;
      slot.cancelled = true;
      try { slot.task && slot.task.cancel(); } catch (_) { }
    }
    /* Queued-but-unstarted jobs for pages that scrolled away cost nothing
       to discard, and discarding them is what keeps a fast scroll from
       leaving a minute of stale work behind it.

       Thumbnails get a much longer grace period, because filling them in
       for pages you have passed is genuinely useful background work —
       but they are not exempt. Without a ceiling, flicking through a
       150-page document leaves 150 queued thumbnails that the queue can
       never drain faster than you can scroll. */
    for (let i = queue.length - 1; i >= 0; i--) {
      const j = queue[i];
      const w = wanted.get(j.key);
      const age = w ? now - w.at : Infinity;
      if (age > (j.isThumb ? STALE_MS * 8 : STALE_MS)) queue.splice(i, 1);
    }
  };

  /** Evict least-recently-used entries until the map is inside its budget. */
  function trim(map, budget) {
    let total = sum(map);
    if (total <= budget) return;
    const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k, v] of oldest) {
      if (total <= budget) break;
      total -= v.bytes || 0;
      // free the backing store eagerly rather than waiting for GC
      if (v.bitmap && v.bitmap.width) { v.bitmap.width = 0; v.bitmap.height = 0; }
      map.delete(k);
    }
  }

  /**
   * The board flipped between light and dark: every cached bitmap was
   * baked for the old one.
   *
   * Only the bitmaps go — the open documents stay, so re-rendering the
   * handful of pages actually on screen costs a frame or two rather
   * than re-parsing a 15MB file.
   */
  P.themeChanged = () => {
    for (const m of [hi, thumbs]) {
      for (const [k, v] of m) {
        if (v.failed) continue;
        if (v.bitmap && v.bitmap.width) { v.bitmap.width = 0; v.bitmap.height = 0; }
        m.delete(k);
      }
    }
    /* Work already started is painting for the theme we just left; let
       it finish into a cache entry that inTheme will ignore rather than
       tearing it down mid-render. The next frame asks again. */
    if (D.app) D.app.requestDraw();
  };

  /** forget everything for a document (used when its board closes) */
  P.forget = assetId => {
    docs.delete(assetId);
    for (const m of [hi, thumbs]) {
      for (const k of [...m.keys()]) if (k.startsWith(assetId + ':')) m.delete(k);
    }
    for (const k of [...wanted.keys()]) if (k.startsWith(assetId + ':')) wanted.delete(k);
  };

  P.clear = () => {
    for (const slot of inflight.values()) {
      slot.cancelled = true;
      try { slot.task && slot.task.cancel(); } catch (_) { }
    }
    queue.length = 0;
    docs.clear(); hi.clear(); thumbs.clear(); wanted.clear();
  };

  /* visible for diagnostics: what is cached, at what resolution */
  P.stats = () => ({
    docs: [...docs.keys()],
    inflight: [...inflight.keys()],
    queued: queue.length,
    hiMB: +(sum(hi) / 1048576).toFixed(1),
    thumbMB: +(sum(thumbs) / 1048576).toFixed(1),
    cache: [...hi.entries()].map(([k, v]) => ({
      k, scale: +v.scale.toFixed(2), px: v.bitmap && v.bitmap.width,
      failed: !!v.failed, err: v.err
    }))
  });

})(window.DPO);

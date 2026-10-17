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

   A whole page can only be held so sharp (MAX_SCALE, and MAX_PAGE_BYTES
   for a big one). Zoomed in past that, the page stays a vector all the
   same: the part of it on screen is rendered on its own, from the PDF's
   own drawing, at the screen's resolution (P.detail), and painted over
   the whole-page bitmap. However far in you go, text and lines are as
   sharp as the screen can show them.

   pdf.js is vendored under vendor/pdfjs so the desktop app works with no
   network at all. It is loaded the first time a PDF appears.         */
(function (D) {
  'use strict';
  const U = D.util;
  const P = {};
  D.pdf = P;

  /* ── budgets ─────────────────────────────────────────────────────
     Sized for a laptop, not a workstation. The sharp cache holds the
     few pages you are looking at; the thumbnail cache holds every page
     of a long document at a resolution where 150 of them still fit. */
  const HI_BUDGET      = 256 * 1024 * 1024; // sharp renders, total bytes
  const THUMB_BUDGET   =  64 * 1024 * 1024; // placeholders, total bytes
  const MAX_PAGE_BYTES =  64 * 1024 * 1024; // ceiling for any one bitmap
  const THUMB_SCALE    = 0.28;              // device px per world px
  const MAX_SCALE      = 4;                 // resolution ceiling overall
  const DETAIL_BUDGET  =  96 * 1024 * 1024; // on-screen parts past MAX_SCALE
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
  const details = new Map();      // "asset:page" → {bitmap, scale, box, at, bytes}: the part on screen
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
  /* A PDF point is 1/72 in; a board unit is a CSS px, 1/96 in. Pages
     come in at that, so an A4 PDF is exactly as big as an A4 page drawn
     with the page tool, and prints back at its own size. */
  const PX_PER_PT = 96 / 72;

  P.attach = async (app, assetId, label, at, opts = {}) => {
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
    /* Added from the menu to a board that has pages already, it goes on
       after the last of them, as more pages; dropped, it lands where it
       was dropped. */
    const last = opts.flow && D.frames ? D.frames.sheets(app.scene).slice(-1)[0] : null;
    let y = last ? last.y + last.h + gap * 2 : at.y;
    for (let i = 0; i < n; i++) {
      const s = sizes[i];
      const w = Math.min(s.w * PX_PER_PT, 2000);
      const h = s.h * (w / s.w);
      items.push(D.make.pdfpage({
        asset: assetId, page: i + 1, pages: n, label: file.name,
        x: last ? last.x : at.x - w / 2, y, w, h, pw: s.w, ph: s.h
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
  P.import = async (app, file, at, opts = {}) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const assetId = U.uid();
    await app.putAsset(assetId, bytes, { name: file.name, type: 'application/pdf' });
    return P.attach(app, assetId, file.name, at, opts);
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

  /* ── past the whole-page ceiling ─────────────────────────────────── */

  /* Detail scales are snapped too, to quarter-octaves, rounding up so the
     part on screen is never softer than the screen. */
  const detailStep = s => Math.pow(2, Math.ceil(Math.log2(s) * 4 - 1e-9) / 4);
  const covers = (a, b) => a.x <= b.x + 1e-6 && a.y <= b.y + 1e-6 && a.x2 >= b.x2 - 1e-6 && a.y2 >= b.y2 - 1e-6;
  /* Good enough to keep: at least as sharp as asked, and not so much
     sharper that it is a zoom or two out of date. */
  const serves = (e, vis, scale, dark) => e && e.dark === dark && e.scale >= scale && e.scale <= scale * 2.01 && covers(e.box, vis);

  /**
   * The part of a page on screen, rendered at the screen's resolution,
   * once the zoom is past what the whole page can be held at.
   *
   * `view` is the board area on screen, in the page's own unturned
   * frame. Like bitmap(), it never blocks: it returns the latest part
   * already rendered ({ bitmap, box } with box in board units, to be
   * painted over the whole page) or null, and asks for a new part when
   * that one no longer covers the screen at this zoom. The part asked
   * for runs half a screen past each edge, so a pan has some way to go
   * before the next one is needed.
   */
  P.detail = (app, item, wantScale, view) => {
    if (wantScale <= Math.min(MAX_SCALE, maxScaleFor(item))) return null;
    const key = item.asset + ':' + item.page, dark = isDark();
    const vis = clip(view, item);
    const have = details.get(key);
    const usable = have && have.bitmap && have.dark === dark ? have : null;
    if (usable) usable.at = performance.now();
    if (!vis) return usable;

    const scale = detailStep(wantScale);
    if (serves(usable, vis, scale, dark)) return usable;
    // already on its way
    const pend = queue.find(j => j.key === key && j.win) || [...inflight.values()].find(s => s.key === key && s.win && !s.cancelled);
    if (pend && serves({ box: pend.win, scale: pend.scale, dark: pend.dark }, vis, scale, dark)) return usable;

    // a bigger margin than the bitmap budget allows shrinks until it fits
    let m = 0.5, win = null;
    for (; m >= 0; m -= 0.25) {
      const px = vis.w * scale * (1 + 2 * m), py = vis.h * scale * (1 + 2 * m);
      if (px * py * 4 <= MAX_PAGE_BYTES || m <= 0) {
        win = clip({ x: vis.x - vis.w * m, y: vis.y - vis.h * m, x2: vis.x2 + vis.w * m, y2: vis.y2 + vis.h * m }, item);
        break;
      }
    }
    // what this replaces is not worth finishing
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].key === key && queue[i].win) queue.splice(i, 1);
    for (const s of inflight.values()) if (s.key === key && s.win) { s.cancelled = true; try { s.task && s.task.cancel(); } catch (_) { } }
    const token = key + ':w' + scale.toFixed(3) + ':' + [win.x, win.y, win.x2, win.y2].map(v => v.toFixed(1)).join(',') + (dark ? ':d' : ':l');
    queue.push({ token, key, item, scale, isThumb: false, dark, at: performance.now(), app, win });
    pump();
    return usable;
  };

  /** a box ({x, y, x2, y2}) cut down to the page; null if it misses it */
  function clip(b, item) {
    const x = Math.max(b.x, item.x), y = Math.max(b.y, item.y);
    const x2 = Math.min(b.x2, item.x + item.w), y2 = Math.min(b.y2, item.y + item.h);
    return x2 > x && y2 > y ? { x, y, x2, y2, w: x2 - x, h: y2 - y } : null;
  }

  /**
   * The device-pixel rectangle of `win` inside the whole page rendered at
   * `scale`, snapped out to whole pixels, and the board box it covers.
   */
  function windowPx(item, win, scale) {
    const ox = Math.floor((win.x - item.x) * scale), oy = Math.floor((win.y - item.y) * scale);
    const w = Math.max(1, Math.ceil((win.x2 - item.x) * scale) - ox), h = Math.max(1, Math.ceil((win.y2 - item.y) * scale) - oy);
    return { ox, oy, w, h, box: { x: item.x + ox / scale, y: item.y + oy / scale, w: w / scale, h: h / scale } };
  }

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
   * `win` (optional, a board box on the page) renders only that part of
   * it — the page's own drawing, cut to the window, not a crop of a
   * bitmap — and its exact board box is left on `slot.box`.
   */
  async function renderPage(app, item, scale, dark, slot, win) {
    const bytes = await app.getAsset(item.asset);
    if (!bytes) return null;
    const doc = await open(item.asset, bytes);
    const page = await doc.getPage(item.page);
    const base = page.getViewport({ scale: 1 });
    // item.w is the page width in world units; scale is device px per world px
    const vp = page.getViewport({ scale: (item.w / base.width) * scale });

    /* OffscreenCanvas where we can: no DOM node per cached page, and
       drawImage takes it directly. */
    const part = win ? windowPx(item, win, scale) : null;
    const w = part ? part.w : Math.max(1, Math.round(vp.width));
    const h = part ? part.h : Math.max(1, Math.round(vp.height));
    if (part && slot) slot.box = part.box;
    const c = surface(w, h);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    /* pdf.js paces its painting with requestAnimationFrame, which stops
       while the window is hidden or minimised, so a render started then
       never finishes. Cancel it rather than leaving the slot occupied
       forever — the first frame after the window comes back asks again
       (App.bindInput retries on visibilitychange). */
    const task = page.render(part
      ? { canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -part.ox, -part.oy] }
      : { canvasContext: ctx, viewport: vp });
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
    const { app, item, key, scale, token, isThumb, dark, win } = job;
    const slot = { key, task: null, cancelled: false, win, scale, dark };
    inflight.set(token, slot);
    try {
      const c = await renderPage(app, item, scale, dark, slot, win);
      if (!c) return;

      const entry = { bitmap: c, scale, dark, at: performance.now(), bytes: bytesOf(c) };
      if (win) {
        const old = details.get(key);
        if (old && old.bitmap && old.bitmap !== c) { old.bitmap.width = 0; old.bitmap.height = 0; }
        const b = slot.box;
        details.set(key, { ...entry, box: { x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h, w: b.w, h: b.h } });
        trim(details, DETAIL_BUDGET);
      } else if (isThumb) { thumbs.set(key, entry); trim(thumbs, THUMB_BUDGET); }
      else { hi.set(key, entry); trim(hi, HI_BUDGET); }
      // the page looks different now, which the scene cannot know
      if (app.renderer && app.renderer.invalidate) app.renderer.invalidate();
      app.requestDraw();
    } catch (e) {
      /* A cancelled render is how we stop wasted work; it is not a
         failure and must not poison the cache. */
      const msg = String((e && e.message) || e);
      if (slot.cancelled || /cancel/i.test(msg)) return;
      // a part that will not render leaves the whole page, which did
      if (win) return;
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
    for (const m of [hi, thumbs, details]) {
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
    for (const m of [hi, thumbs, details]) {
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
    docs.clear(); hi.clear(); thumbs.clear(); details.clear(); wanted.clear();
  };

  /* visible for diagnostics: what is cached, at what resolution */
  P.stats = () => ({
    docs: [...docs.keys()],
    inflight: [...inflight.keys()],
    queued: queue.length,
    hiMB: +(sum(hi) / 1048576).toFixed(1),
    thumbMB: +(sum(thumbs) / 1048576).toFixed(1),
    detailMB: +(sum(details) / 1048576).toFixed(1),
    cache: [...hi.entries()].map(([k, v]) => ({
      k, scale: +v.scale.toFixed(2), px: v.bitmap && v.bitmap.width,
      failed: !!v.failed, err: v.err
    }))
  });

})(window.DPO);

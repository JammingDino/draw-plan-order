/* ── render.js ── canvas painting ───────────────────────────────────
   #base holds the committed scene, #live holds the in-flight stroke,
   marquees, selection handles and other transient chrome. Keeping the
   two apart means the pen never waits on a full scene redraw.        */
(function (D) {
  'use strict';
  const U = D.util, FH = D.freehand;
  const XT = D.ext.items;      // item types registered by feature files (ext.js)

  /* Decoded pictures, by asset id (or, for a picture still carried inline,
     its data URL): { img, ready }. Emptied when the board changes. */
  const imgCache = new Map();

  /* ── level of detail ──────────────────────────────────────────────
     A stroke is normally a filled outline: a quad per segment plus a disc
     at every join, which is what gives it pressure, taper and round ends.
     That is the right picture at reading size and a ridiculous one when
     the nib is thinner than a pixel — a page of dense working zoomed out
     hands the rasteriser a few hundred thousand path operations to draw
     something the size of a postage stamp, and the board goes sticky
     exactly when the user is trying to find their place in it.

     Below the threshold none of that detail can land on a pixel anyway,
     so the stroke is drawn as its centreline instead: simplified to the
     resolution actually on offer, and stroked at the nib's width. Same
     ink, same colour, same place, a fraction of the geometry.          */
  const LOD_NIB_PX = 1.5;      // nib width below which no detail survives
  const LOD_TOL_PX = 0.35;     // how far the centreline may be moved
  const LOD_MIN_PX = 0.9;      // never draw thinner than this, or it fades
  const LOD_RUN = 200;         // strokes per batched path, at most

  /* Zoom is snapped to third-octave steps before it reaches the cache, so
     a pinch rebuilds the simplified paths a handful of times instead of
     on every frame. */
  const ZOOM_SETTLE = 150;      // ms after the last zoom step before painting sharp
  const ZOOM_STRETCH = 2;       // how far the last sharp picture may be scaled

  const zoomBucket = z => Math.round(Math.log2(z) * 3);
  const bucketZoom = b => 2 ** (b / 3);

  class Renderer {
    constructor(app) {
      this.app = app;
      this.base = document.getElementById('base');
      this.live = document.getElementById('live');
      this.bctx = this.base.getContext('2d');
      this.lctx = this.live.getContext('2d');
      this.dpr = 1;
      this.w = 0; this.h = 0;
      this.grid = 'dots';
      this.resize();
      addEventListener('resize', () => { this.resize(); app.requestDraw(); });
    }

    resize() {
      const dpr = this.dpr = Math.min(devicePixelRatio || 1, 2.5);
      const w = this.w = innerWidth, h = this.h = innerHeight;
      for (const c of [this.base, this.live]) {
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        c.style.width = w + 'px'; c.style.height = h + 'px';
      }
    }

    worldTransform(ctx) {
      const c = this.app.camera, d = this.dpr;
      ctx.setTransform(c.zoom * d, 0, 0, c.zoom * d, c.x * d, c.y * d);
    }

    /* ── scene ────────────────────────────────────────────────────── */
    /**
     * Repaint the board. `scroll` is the caller's word that nothing but
     * the camera's position may have changed since the last paint (see
     * App.requestPan); the painter still checks, and repaints everything
     * whenever anything else differs.
     */
    drawScene(scroll) {
      const cam = this.app.camera, editor = this.app.editor, scene = this.app.scene;
      this.endZoom();
      const st = {
        x: cam.x, y: cam.y, zoom: cam.zoom, dpr: this.dpr, w: this.w, h: this.h,
        theme: U.theme(), grid: this.grid, v: scene.version, edit: editor && editor.item,
        edits: scene.edits, count: scene.items.length
      };
      if (this.lift) {
        if (this.paintLift()) { this._painted = null; return; }
        this.liftEnd();                  // the view moved under the drag: paint it properly
      }
      const was = this._painted;
      this._painted = st;
      const damage = scene.takeDamage ? scene.takeDamage() : true;
      if (was && this.addedOnly(was, st)) return;
      if (was && damage && damage !== true && this.repaintDamage(was, st, damage)) return;
      if (scroll && was && this.scrollFrom(was, st)) return;
      this.paintAll();
    }

    /** the next paint must be a whole one: something changed that the scene cannot see */
    invalidate() { this._painted = null; }

    /* ── zooming ──────────────────────────────────────────────────────
       A wheel or a pinch zooms a step every frame, and every step was a
       repaint of everything in view at the new scale: the most expensive
       picture the app draws, sixty times a second, mostly in the GPU
       process where the battery pays for it. While a zoom is under way
       the last sharp picture is scaled instead — one textured copy — and
       the board is painted properly ZOOM_SETTLE ms after the zoom stops.
       Past ZOOM_STRETCH either way the scaled copy would be visibly soft,
       so it is painted properly then and the zoom carries on from there.
       Zooming out leaves plain paper at the edges until it settles. */
    drawZoom() {
      const cam = this.app.camera, d = this.dpr;
      let z = this.zoomShot;
      const fresh = z && z.w === this.w && z.h === this.h && z.dpr === d && z.theme === U.theme() &&
        z.v === this.app.scene.version;
      if (!fresh) {
        // the picture to scale from: what is on screen, if it is a whole one
        const was = this._painted;
        if (z || !was || this.lift) { this.drawScene(); return this.takeZoomShot(this._painted); }
        z = this.takeZoomShot(was);
        if (!z) return this.drawScene();
      }
      const r = cam.zoom / z.zoom;
      if (r > ZOOM_STRETCH || r < 1 / ZOOM_STRETCH) { this.drawScene(); this.takeZoomShot(this._painted); return; }

      const ctx = this.bctx, css = this.tokens();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = css.paper;
      ctx.fillRect(0, 0, this.base.width, this.base.height);
      ctx.setTransform(r, 0, 0, r, (cam.x - z.x * r) * d, (cam.y - z.y * r) * d);
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(z.canvas, 0, 0);
      ctx.restore();
      this._painted = null;            // what is on screen is no longer a sharp picture of anything
      this.lastDrawn = 0;

      clearTimeout(this._zoomSettle);
      this._zoomSettle = setTimeout(() => { this.endZoom(); this.app.requestDraw(); }, ZOOM_SETTLE);
    }

    /** keep a copy of the screen, painted for camera state `st`, to scale from */
    takeZoomShot(st) {
      if (!st) return null;
      const c = (this.zoomShot && this.zoomShot.canvas) || document.createElement('canvas');
      if (c.width !== this.base.width || c.height !== this.base.height) { c.width = this.base.width; c.height = this.base.height; }
      const g = c.getContext('2d');
      g.globalCompositeOperation = 'copy';
      g.drawImage(this.base, 0, 0);
      return this.zoomShot = { canvas: c, x: st.x, y: st.y, zoom: st.zoom, w: this.w, h: this.h, dpr: this.dpr, theme: U.theme(), v: this.app.scene.version };
    }

    endZoom() {
      clearTimeout(this._zoomSettle);
      if (!this.zoomShot) return;
      const c = this.zoomShot.canvas;
      this.zoomShot = null;
      c.width = c.height = 0;          // a screen-sized copy is worth handing back straight away
    }

    /**
     * Items were only added on top since the last paint — a stroke just
     * drawn, a shape, a pasted picture — so paint those over the picture
     * already there. A stroke used to cost a repaint of the whole board
     * as the pen lifted, which zoomed out on a dense board was a stall of
     * half a second or more after every stroke.
     *
     * Scene.edits stands still only while nothing already on the board
     * has changed, moved, gone or been reordered, so the old picture is
     * still right underneath. Async arrivals that change how an item
     * looks (a PDF render, a decoded picture) call invalidate().
     */
    addedOnly(was, st) {
      if (st.v === was.v || st.edits !== was.edits || st.count <= was.count) return false;
      for (const k of ['x', 'y', 'zoom', 'dpr', 'w', 'h', 'theme', 'grid', 'edit']) if (was[k] !== st[k]) return false;
      const scene = this.app.scene, cam = this.app.camera;
      const view = cam.viewport(this.w, this.h, 80);
      const fresh = scene.items.slice(was.count).filter(it => U.boxesOverlap(view, scene.bbox(it)));
      const ctx = this.bctx;
      ctx.save();
      this.worldTransform(ctx);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      this.drawItems(ctx, fresh);
      ctx.restore();
      this.lastDrawn = fresh.length;
      return true;
    }

    /**
     * Only some strokes changed, all within `box` (world units; see
     * Scene.takeDamage): repaint that rectangle of the screen and leave
     * the rest. The eraser used to cost a repaint of the whole view per
     * nibble. Anything about the view itself changing, or a damaged area
     * covering most of it anyway, and the caller repaints everything.
     */
    repaintDamage(was, st, box) {
      for (const k of ['x', 'y', 'zoom', 'dpr', 'w', 'h', 'theme', 'grid', 'edit']) if (was[k] !== st[k]) return false;
      const cam = this.app.camera, d = this.dpr;
      // a little spare: anti-aliasing reaches a pixel past the edge
      const a = cam.toScreen(box.x, box.y), b = cam.toScreen(box.x2, box.y2);
      const x0 = Math.max(0, Math.floor(a.x * d) - 3), y0 = Math.max(0, Math.floor(a.y * d) - 3);
      const x1 = Math.min(this.base.width, Math.ceil(b.x * d) + 3), y1 = Math.min(this.base.height, Math.ceil(b.y * d) + 3);
      if (x1 <= x0 || y1 <= y0) { this.lastDrawn = 0; return true; }          // all of it off screen
      if ((x1 - x0) * (y1 - y0) > this.base.width * this.base.height * 0.6) return false;
      this.lastDrawn = this.paintRegion(x0, y0, x1 - x0, y1 - y0);
      return true;
    }

    /**
     * A pan, painted as a pan: the picture already on the canvas is
     * shifted by however far the camera moved, and only the strips that
     * uncovered are painted. Panning used to repaint everything visible on
     * every frame — on a dense board zoomed out, tens of thousands of
     * strokes, sixty times a second, which is where panning went heavy.
     *
     * Only when the shift is a whole number of device pixels, so the old
     * pixels land exactly where a fresh paint would put them (pans are
     * made in whole device pixels for this; App.panScreen). Anything else
     * — a zoom, an edit, a resize, a theme — and the caller repaints.
     */
    scrollFrom(was, st) {
      for (const k of ['zoom', 'dpr', 'w', 'h', 'theme', 'grid', 'v', 'edit']) if (was[k] !== st[k]) return false;
      const fx = (st.x - was.x) * st.dpr, fy = (st.y - was.y) * st.dpr;
      const dx = Math.round(fx), dy = Math.round(fy);
      if (Math.abs(fx - dx) > 1e-6 || Math.abs(fy - dy) > 1e-6) return false;
      const W = this.base.width, H = this.base.height;
      if (Math.abs(dx) * 3 > W || Math.abs(dy) * 3 > H) return false;   // mostly new anyway
      if (!dx && !dy) { this.notePages(); return true; }

      const ctx = this.bctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(this.base, dx, dy);
      ctx.restore();

      let drawn = 0;
      if (dx) drawn += this.paintRegion(dx > 0 ? 0 : W + dx, 0, Math.abs(dx), H);
      if (dy) drawn += this.paintRegion(0, dy > 0 ? 0 : H + dy, W, Math.abs(dy));
      this.lastDrawn = drawn;
      this.notePages();
      return true;
    }

    /** paint one rectangle of the canvas (device pixels) from scratch */
    paintRegion(x, y, w, h) {
      const ctx = this.bctx, d = this.dpr, cam = this.app.camera;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const css = this.tokens();
      ctx.fillStyle = css.paper;
      ctx.fillRect(x / d, y / d, w / d, h / d);
      this.drawGrid(ctx, css);
      this.worldTransform(ctx);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // padded as paintAll pads the view, so a shadow reaching in is drawn
      const a = cam.toWorld(x / d - 80, y / d - 80), b = cam.toWorld((x + w) / d + 80, (y + h) / d + 80);
      const items = this.app.scene.near(U.box(a.x, a.y, b.x, b.y));
      this.drawItems(ctx, items);
      ctx.restore();
      return items.length;
    }

    /* A PDF page learns it is on screen by being painted (D.pdf.bitmap),
       and stops being rendered for once it has gone unasked for a while.
       A pan paints only the strips, so the pages still in view say so
       here — or a long pan would cancel their sharp renders. */
    notePages() {
      const scene = this.app.scene, cam = this.app.camera;
      if (!this._pdfs || this._pdfs.v !== scene.version)
        this._pdfs = { v: scene.version, list: scene.items.filter(i => i.type === 'pdfpage') };
      if (!this._pdfs.list.length) return;
      const view = cam.viewport(this.w, this.h, 80);
      for (const it of this._pdfs.list)
        if (U.boxesOverlap(view, scene.bbox(it))) D.pdf.bitmap(this.app, it, cam.zoom * this.dpr);
    }

    paintAll(keep) {
      const ctx = this.bctx, app = this.app, cam = app.camera;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);

      const css = this.tokens();
      ctx.fillStyle = css.paper;
      ctx.fillRect(0, 0, this.w, this.h);
      this.drawGrid(ctx, css);

      this.worldTransform(ctx);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const view = cam.viewport(this.w, this.h, 80);
      let visible = app.scene.near(view);
      if (keep) visible = visible.filter(keep);
      this.lastDrawn = visible.length;
      this.drawItems(ctx, visible);
    }

    /* ── dragging a selection ─────────────────────────────────────────
       A drag moved its items a little every frame, and every frame the
       whole view was repainted: each stroke on screen re-rasterised,
       sixty times a second, for a picture in which almost nothing
       changes. Lifted, the board is painted once without the selection
       and the selection once on its own, and a frame of the drag is two
       copies, the selection's offset by however far it has gone — next
       to nothing for the GPU, whatever the board holds. Dropping it
       paints everything properly again.

       Only where that picture is exact: a connector attached to a moving
       node bends rather than moves, grid snapping moves items by
       different amounts, and a selection reaching far off screen would
       be dragged into view unpainted. Those keep the plain repaint. */
    liftBegin(items) {
      const app = this.app, scene = app.scene, cam = app.camera, d = this.dpr;
      if (!items.length || !this.base.width) return false;
      const ids = new Set(items.map(i => i.id));
      for (const e of scene.items) {
        if (e.type === 'edge' && !ids.has(e.id) && ((e.from.id && ids.has(e.from.id)) || (e.to.id && ids.has(e.to.id)))) return false;
        // an arrow or a dimension attached to something moving bends with it, like a connector
        if (e._ends && e.type !== 'edge' && !ids.has(e.id) && D.refsOf(e).some(r => ids.has(r.id))) return false;
      }
      /* and one of the moving items still attached to something left
         behind is drawn where that keeps it, not shifted with the rest */
      for (const it of items) if (D.refsOf(it).some(r => !ids.has(r.id))) return false;
      if (app.opts.general.snapGrid && items.some(i => i.type !== 'stroke' && i.type !== 'edge')) return false;

      const PAD = 0.25;
      const W = this.base.width, H = this.base.height, px = Math.round(W * PAD), py = Math.round(H * PAD);
      const v = cam.viewport(this.w, this.h, 0);
      const room = U.box(v.x - v.w * PAD, v.y - v.h * PAD, v.x2 + v.w * PAD, v.y2 + v.h * PAD);
      let box = null;
      for (const it of items) box = U.unionBox(box, scene.bbox(it));
      if (!box || box.x < room.x || box.y < room.y || box.x2 > room.x2 || box.y2 > room.y2) return false;

      const set = new Set(items);
      this.paintAll(it => !set.has(it));
      const under = document.createElement('canvas');
      under.width = W; under.height = H;
      under.getContext('2d').drawImage(this.base, 0, 0);

      const sel = document.createElement('canvas');
      sel.width = W + px * 2; sel.height = H + py * 2;
      const g = sel.getContext('2d');
      g.setTransform(cam.zoom * d, 0, 0, cam.zoom * d, cam.x * d + px, cam.y * d + py);
      g.lineCap = 'round'; g.lineJoin = 'round';
      this.drawItems(g, items.slice().sort((a, b) => a._z - b._z));

      this.lift = { under, sel, px, py, x: cam.x, y: cam.y, zoom: cam.zoom, w: this.w, h: this.h, dpr: d, theme: U.theme(), dx: 0, dy: 0 };
      this._painted = null;
      return true;
    }

    /** a frame of a lifted drag; false if the view no longer matches the lift */
    paintLift() {
      const L = this.lift, cam = this.app.camera;
      if (cam.x !== L.x || cam.y !== L.y || cam.zoom !== L.zoom || this.w !== L.w || this.h !== L.h || this.dpr !== L.dpr || U.theme() !== L.theme) return false;
      const ctx = this.bctx, k = cam.zoom * L.dpr;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(L.under, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      // whole device pixels: the selection's pixels land exactly, never resampled
      ctx.drawImage(L.sel, Math.round(L.dx * k) - L.px, Math.round(L.dy * k) - L.py);
      ctx.restore();
      this.lastDrawn = 0;
      return true;
    }

    liftEnd() {
      if (!this.lift) return;
      const L = this.lift;
      this.lift = null;
      L.under.width = L.under.height = 0; L.sel.width = L.sel.height = 0;   // give the memory back now
      this._painted = null;
    }

    /* The theme tokens the painter needs, read once per theme rather than
       once per frame: getComputedStyle forces a style recalc, and at the
       top of drawScene that lands on every pan, zoom and wheel tick. */
    tokens() {
      const th = U.theme();
      if (this._tok && this._tok.theme === th) return this._tok;
      /* An export painting in the theme that is not on screen: CSS only
         knows the one that is, so take the mirrored colours (U.THEMES).
         Not cached — it lasts one export, and the screen wants its own
         tokens back the moment it is over. */
      if (th !== (document.documentElement.dataset.theme || 'light')) {
        const t = U.THEMES[th === 'dark' ? 'dark' : 'light'];
        return { theme: th, dark: th === 'dark', paper: t.paper, grid: '#0000', accent: '#4f6bff', panel: t.paper, muted: '#8a8f98' };
      }
      const cs = getComputedStyle(document.documentElement);
      const v = (n, d) => cs.getPropertyValue(n).trim() || d;
      return this._tok = {
        theme: th, dark: th === 'dark',
        paper: v('--paper', '#fff'), grid: v('--grid', '#0001'),
        accent: v('--accent', '#4f6bff'), panel: v('--panel-solid', '#fff'),
        muted: v('--muted', '#8a8f98')
      };
    }
    /** call when the palette changes for a reason other than the theme flag */
    invalidateStyle() { this._tok = null; this._gridPat = null; }

    drawGrid(ctx, css) {
      if (this.grid === 'none') return;
      const cam = this.app.camera;
      const color = css.grid;
      let step = 25;
      while (step * cam.zoom < 14) step *= 4;
      while (step * cam.zoom > 90) step /= 2;
      const s = step * cam.zoom;
      const ox = cam.x % s, oy = cam.y % s;
      ctx.save();
      if (this.grid === 'dots') {
        const r = Math.min(1.6, Math.max(0.7, cam.zoom));
        /* One tiled fill instead of an arc per dot: a dense grid on a large
           display is tens of thousands of separate fills per frame, which is
           what makes panning feel heavy long before the drawing does. */
        const T = Math.max(2, Math.round(s));
        const pat = this.dotPattern(color, T, r);
        if (pat) {
          ctx.fillStyle = pat;
          const tx = ox - T / 2, ty = oy - T / 2;
          ctx.translate(tx, ty);
          ctx.fillRect(-tx, -ty, this.w, this.h);
        } else {
          ctx.fillStyle = color;
          const p = new Path2D();
          for (let x = ox; x < this.w + s; x += s)
            for (let y = oy; y < this.h + s; y += s) { p.moveTo(x + r, y); p.arc(x, y, r, 0, 6.284); }
          ctx.fill(p);
        }
      } else {
        /* 'lines' is squared paper, 'lined' is ruled paper: ruled gets the
           horizontals only. Both used to draw both — the two branches that
           chose between them were identical, and the verticals were
           unconditional — so Ruled rendered as an exact copy of Grid. */
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath();
        if (this.grid !== 'lined')
          for (let x = ox; x < this.w + s; x += s) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, this.h); }
        for (let y = oy; y < this.h + s; y += s) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(this.w, Math.round(y) + .5); }
        ctx.stroke();
      }
      ctx.restore();
    }

    /** a one-dot tile for the dot grid, cached until spacing or theme moves */
    dotPattern(color, T, r) {
      const key = `${T}|${r}|${color}|${this.dpr}`;
      if (this._gridPat && this._gridPat.key === key) return this._gridPat.pat;
      try {
        const d = this.dpr;
        const c = document.createElement('canvas');
        c.width = c.height = Math.max(1, Math.round(T * d));
        const g = c.getContext('2d');
        g.setTransform(d, 0, 0, d, 0, 0);
        g.fillStyle = color;
        g.beginPath(); g.arc(T / 2, T / 2, r, 0, 6.284); g.fill();
        const pat = this.bctx.createPattern(c, 'repeat');
        // the tile is in device pixels; the painter works in CSS pixels
        if (pat && pat.setTransform) pat.setTransform(new DOMMatrix([1 / d, 0, 0, 1 / d, 0, 0]));
        else return null;
        this._gridPat = { key, pat };
        return pat;
      } catch (_) { return null; }
    }

    /**
     * Paint a run of items, batching the ones that have dropped to their
     * centreline.
     *
     * Consecutive strokes sharing a colour and width become one path and
     * one stroke() call. It has to be a *consecutive* run, not a grouping
     * by colour, or the paint order changes and a red annotation drawn
     * over black working would slide underneath it. In practice handwriting
     * arrives in long same-coloured runs, so the batches are long.
     *
     * `zoom` is a parameter rather than read from the camera because the
     * dashboard thumbnail paints the whole board at its own scale — the
     * densest picture the app ever draws, and the one that most wants the
     * cheap path.
     */
    drawItems(ctx, items, zoom = this.app.camera.zoom) {
      let run = null, batched = 0, simplified = 0;
      this.paintZoom = zoom;     // for the few painters that draw hairlines

      /* A run is stroked with bevel joins and kept to a couple of hundred
         strokes. Both are invisible at these widths — under a pixel and a
         half, no join shape survives — and both matter to the rasteriser,
         which outlines a stroked path before filling it: round joins at
         every vertex, and one path spanning the whole screen, made a
         zoomed-out repaint of a dense board several times slower. */
      const flush = () => {
        if (!run) return;
        ctx.strokeStyle = run.color;
        ctx.lineWidth = run.width;
        const join = ctx.lineJoin;
        ctx.lineJoin = 'bevel';
        ctx.stroke(run.path);
        ctx.lineJoin = join;
        run = null;
        batched++;
      };

      for (const it of items) {
        const lod = it.type === 'stroke' ? this.strokeLod(it, zoom) : null;
        if (!lod) { flush(); this.drawItem(ctx, it); continue; }
        if (!run || run.color !== lod.color || run.width !== lod.width || run.n >= LOD_RUN) {
          flush();
          run = { color: lod.color, width: lod.width, path: new Path2D(), n: 0 };
        }
        run.n++;
        if (lod.dx || lod.dy) run.path.addPath(lod.path, new DOMMatrix([1, 0, 0, 1, lod.dx, lod.dy]));
        else run.path.addPath(lod.path);
        simplified++;
      }
      flush();
      // for the frame counter: how much of the board went down the cheap path
      this.lastSimplified = simplified;
      this.lastBatches = batched;
    }

    /**
     * The cheap form of a stroke, or null if it still deserves its outline.
     *
     * Only opaque, normally-composited strokes qualify. A highlighter is
     * translucent and multiplied, and its outline is one path precisely so
     * that overlapping itself does not darken; stroking a centreline would
     * bring that darkening back, so highlighters keep their outline however
     * small they get.
     */
    strokeLod(it, zoom) {
      if ((it.alpha ?? 1) < 1) return null;
      if (this.blendFor(it) !== 'source-over') return null;
      if (it.size * zoom >= LOD_NIB_PX) return null;

      const b = zoomBucket(zoom);
      /* Two zooms are kept, the latest and the one before (as `prev`, so
         whatever clears _lod clears both). The dashboard thumbnail paints
         the whole board at its own tiny scale every few seconds while you
         draw, and with one slot each of those evicted the screen's paths:
         zoomed out on a big board, the next frame re-simplified every
         visible stroke — about 260ms instead of 40. */
      let held = it._lod;
      if (held && held.b !== b && held.prev && held.prev.b === b) {
        const p = held.prev;
        held.prev = null; p.prev = held;
        it._lod = held = p;
      }
      if (!held || held.b !== b) {
        const z = bucketZoom(b);
        const xy = U.simplify(it.pts, LOD_TOL_PX / z, 3);
        const path = new Path2D();
        if (xy.length >= 4) {
          path.moveTo(xy[0], xy[1]);
          for (let i = 2; i < xy.length; i += 2) path.lineTo(xy[i], xy[i + 1]);
        } else if (xy.length === 2) {
          // a tap: a subpath of zero length still paints a dot under a round cap
          path.moveTo(xy[0], xy[1]); path.lineTo(xy[0], xy[1]);
        }
        if (held) held.prev = null;
        it._lod = { b, path, width: Math.max(it.size, LOD_MIN_PX / z), x: it.pts[0], y: it.pts[1], prev: held || null };
      }
      // moved since it was built: see drawStroke
      const L = it._lod;
      return { path: L.path, width: L.width, color: U.color(it.color), dx: it.pts[0] - L.x || 0, dy: it.pts[1] - L.y || 0 };
    }

    /* ── item painting ────────────────────────────────────────────── */
    drawItem(ctx, it) {
      ctx.save();
      ctx.globalAlpha = it.alpha ?? 1;
      if (it.rot) {
        const b = this.app && this.app.scene ? this.app.scene.bbox(it) : null;
        if (b && b.local) {
          const c = U.boxCenter(b.local);
          ctx.translate(c.x, c.y); ctx.rotate(it.rot); ctx.translate(-c.x, -c.y);
        }
      }
      switch (it.type) {
        case 'stroke': this.drawStroke(ctx, it); break;
        case 'shape': this.drawShape(ctx, it); break;
        case 'text': this.drawText(ctx, it); break;
        case 'note': this.drawNote(ctx, it); break;
        case 'node': this.drawNode(ctx, it); break;
        case 'edge': this.drawEdge(ctx, it); break;
        case 'image': this.drawImage(ctx, it); break;
        case 'pdfpage': this.drawPdfPage(ctx, it); break;
        default: { const x = XT[it.type]; if (x) x.draw(ctx, it, this); }
      }
      ctx.restore();
    }

    /* multiply reads as a real highlighter on white paper but turns to mud on
       a dark board — there, plain alpha is the honest equivalent */
    blendFor(it) {
      if (it.blend === 'multiply') return this.tokens().dark ? 'source-over' : 'multiply';
      return it.blend || 'source-over';
    }

    drawStroke(ctx, it) {
      if (!it._path) {
        const poly = FH.shapes(it.pts, { size: it.size, thinning: it.thinning, taper: it.taper || 0, cap: it.cap !== false });
        it._path = FH.path(poly);
        it._at = [it.pts[0], it.pts[1]];
      }
      /* A drag moves strokes without re-outlining them (Scene.touchMoved):
         the outline is the same shape wherever it is, so it is drawn from
         where it was built, shifted by however far the stroke has gone.
         drawItem's save/restore puts the transform back. */
      const at = it._at;
      if (at) {
        const dx = it.pts[0] - at[0], dy = it.pts[1] - at[1];
        if (dx || dy) ctx.translate(dx, dy);
      }
      ctx.globalCompositeOperation = this.blendFor(it);
      ctx.fillStyle = U.color(it.color);
      ctx.fill(it._path);
    }

    shapePath(it) {
      const p = new Path2D();
      const { kind } = it;
      let { x, y, w, h } = it;
      if (kind === 'line' || kind === 'arrow') { p.moveTo(x, y); p.lineTo(x + w, y + h); return p; }
      if (kind === 'moment') {
        const A = D.arcOf(it);
        // canvas angles run clockwise on screen; the arc's run anticlockwise
        p.ellipse(A.cx, A.cy, A.rx, A.ry, 0, -A.a0, -(A.a0 + A.sweep), A.sweep > 0);
        return p;
      }
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }
      if (kind === 'ellipse') p.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 6.2832);
      else if (kind === 'diamond') { p.moveTo(x + w / 2, y); p.lineTo(x + w, y + h / 2); p.lineTo(x + w / 2, y + h); p.lineTo(x, y + h / 2); p.closePath(); }
      else if (kind === 'triangle') { p.moveTo(x + w / 2, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.closePath(); }
      else if (kind === 'rect') p.roundRect(x, y, w, h, Math.min(it.radius || 0, w / 2, h / 2));
      return p;
    }

    strokeStyleFor(ctx, it) {
      ctx.lineWidth = it.size;
      ctx.strokeStyle = U.color(it.color);
      ctx.setLineDash(dashFor(it.dash, it.size));
      ctx.lineCap = 'round';
    }

    drawShape(ctx, it) {
      if (D.isLine(it) || it.kind === 'moment') return this.drawLine(ctx, it);
      const p = this.shapePath(it);
      if (it.fill && it.fill !== 'none') { ctx.fillStyle = U.color(it.fill); ctx.fill(p); }
      this.strokeStyleFor(ctx, it);
      ctx.stroke(p);
      ctx.setLineDash([]);
    }

    /* A line, arrow, curve, polyline or moment arrow: the shaft, cut back
       where a head covers its end (a round cap poking through the point
       of a filled head is what made arrows look blunt), then the heads.
       The geometry is shared with the SVG export (lineParts), so the two
       always agree. */
    drawLine(ctx, it) {
      const L = lineParts(this.app.scene, it);
      if (!L) return;
      this.strokeStyleFor(ctx, it);
      ctx.beginPath();
      traceShaft(ctx, L);
      ctx.stroke();
      ctx.setLineDash([]);
      paintHeads(ctx, L.heads, U.color(it.color), it.size);
    }

    /** one arrowhead of the default kind, as connectors draw them */
    arrowHead(ctx, fx, fy, tx, ty, size, color) {
      paintHeads(ctx, [headGeom('filled', tx, ty, Math.atan2(ty - fy, tx - fx), size, 1)], U.color(color), size);
    }

    /* The text being typed into is shown by the editor's textarea, which
       sits exactly over it. Painting it on the canvas as well gave two
       copies, and the browser's line box never puts glyphs on precisely
       the pixel the canvas's 'top' baseline does, so they doubled up a
       couple of pixels apart: the ghosting. On screen the textarea is the
       only copy; thumbnails and exports still get the text. */
    editing(ctx, it) { return ctx === this.bctx && this.app.editor && this.app.editor.item === it; }

    drawText(ctx, it) {
      if (this.editing(ctx, it)) return;
      const L = this.app.scene.layout(it);
      ctx.font = L.font;
      ctx.fillStyle = U.color(it.color);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = it.align || 'left';
      const w = it.autoWidth ? L.width : it.w;
      const ax = it.align === 'center' ? it.x + w / 2 : it.align === 'right' ? it.x + w : it.x;
      L.lines.forEach((ln, i) => ctx.fillText(ln, ax, it.y + i * L.lh + L.base));
    }

    drawNote(ctx, it) {
      const p = new Path2D();
      p.roundRect(it.x, it.y, it.w, it.h, 6);
      ctx.save();
      ctx.shadowColor = '#0000002e'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
      ctx.fillStyle = U.color(it.color); ctx.fill(p);
      ctx.restore();
      if (this.editing(ctx, it)) return;
      const pad = 14;
      const t = { text: it.text, x: it.x + pad, y: it.y + pad, w: it.w - pad * 2, size: it.size, color: it.textColor || '#22252c', align: it.align, font: it.font };
      const L = this.app.scene.layout(t);
      ctx.font = L.font; ctx.fillStyle = U.color(t.color); ctx.textBaseline = 'alphabetic'; ctx.textAlign = t.align || 'left';
      const ax = t.align === 'center' ? t.x + t.w / 2 : t.align === 'right' ? t.x + t.w : t.x;
      L.lines.forEach((ln, i) => { if (t.y + (i + 1) * L.lh < it.y + it.h) ctx.fillText(ln, ax, t.y + i * L.lh + L.base); });
    }

    nodePath(it) {
      const p = new Path2D();
      const { x, y, w, h, kind } = it;
      if (kind === 'decision') { p.moveTo(x + w / 2, y); p.lineTo(x + w, y + h / 2); p.lineTo(x + w / 2, y + h); p.lineTo(x, y + h / 2); p.closePath(); }
      else if (kind === 'terminal') p.roundRect(x, y, w, h, h / 2);
      else if (kind === 'data') { p.moveTo(x + h * .28, y); p.lineTo(x + w, y); p.lineTo(x + w - h * .28, y + h); p.lineTo(x, y + h); p.closePath(); }
      else p.roundRect(x, y, w, h, 12);
      return p;
    }

    drawNode(ctx, it) {
      const p = this.nodePath(it);
      if (it.fill && it.fill !== 'none') { ctx.fillStyle = U.color(it.fill); ctx.fill(p); }
      ctx.lineWidth = it.size; ctx.strokeStyle = U.color(it.color); ctx.stroke(p);
      if (!it.text || this.editing(ctx, it)) return;
      const pad = it.kind === 'decision' ? it.w * 0.2 : 12;
      const t = { text: it.text, x: it.x + pad, y: 0, w: it.w - pad * 2, size: it.textSize || 15, align: 'center', font: it.font };
      const L = this.app.scene.layout(t);
      ctx.font = L.font; ctx.fillStyle = U.color(it.textColor || it.color); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
      const top = it.y + (it.h - L.lines.length * L.lh) / 2;
      L.lines.forEach((ln, i) => ctx.fillText(ln, it.x + it.w / 2, top + i * L.lh + L.base));
    }

    drawEdge(ctx, it) {
      const pts = this.app.scene.edgePath(it);
      if (pts.length < 4) return;
      ctx.lineWidth = it.size; ctx.strokeStyle = U.color(it.color);
      ctx.setLineDash(it.dash === 1 ? [it.size * 3, it.size * 2.4] : dashFor(it.dash, it.size));
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      if (it.style === 'elbow') {
        // rounded elbows
        const r = 8;
        for (let i = 2; i < pts.length - 2; i += 2) {
          const px = pts[i - 2], py = pts[i - 1], cx = pts[i], cy = pts[i + 1], nx = pts[i + 2], ny = pts[i + 3];
          const d1 = Math.hypot(cx - px, cy - py), d2 = Math.hypot(nx - cx, ny - cy);
          const r1 = Math.min(r, d1 / 2), r2 = Math.min(r, d2 / 2);
          if (d1 < 0.01 || d2 < 0.01) continue;
          ctx.lineTo(cx - (cx - px) / d1 * r1, cy - (cy - py) / d1 * r1);
          ctx.quadraticCurveTo(cx, cy, cx + (nx - cx) / d2 * r2, cy + (ny - cy) / d2 * r2);
        }
        ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
      } else {
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const n = pts.length;
      if (it.arrowEnd) this.arrowHead(ctx, pts[n - 4], pts[n - 3], pts[n - 2], pts[n - 1], it.size, it.color);
      if (it.arrowStart) this.arrowHead(ctx, pts[2], pts[3], pts[0], pts[1], it.size, it.color);
      if (it.label) {
        const mid = midOf(pts);
        const t = { text: it.label, size: it.labelSize || 13, w: 400, autoWidth: true, font: it.font };
        const L = this.app.scene.layout(t);
        ctx.font = L.font;
        const pad = 4, wdt = L.width + pad * 2;
        ctx.fillStyle = this.tokens().paper;
        ctx.beginPath(); ctx.roundRect(mid.x - wdt / 2, mid.y - L.lh / 2, wdt, L.lh, 4); ctx.fill();
        ctx.fillStyle = U.color(it.color); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(it.label, mid.x, mid.y + 1);
      }
    }

    drawImage(ctx, it) {
      const p = this.picture(it);
      if (p.img) ctx.drawImage(p.img, it.x, it.y, it.w, it.h);
      else { ctx.fillStyle = '#8884'; ctx.fillRect(it.x, it.y, it.w, it.h); }
    }

    /**
     * A picture's decoded form, started on first sight: { img, ready }.
     * img stays null until it has decoded; ready settles when it has (or
     * cannot), which is what an export waits on — a picture never yet
     * scrolled into view would otherwise export as a grey box.
     */
    picture(it) {
      const key = it.asset || it.src || '';
      let p = imgCache.get(key);
      if (p) return p;
      p = { img: null, ready: null };
      imgCache.set(key, p);
      const done = img => { p.img = img; this.invalidate(); this.app.requestDraw(); };
      if (it.asset) {
        p.ready = Promise.resolve(this.app.getAsset(it.asset))
          .then(bytes => bytes && U.decodeImage(new Blob([bytes], { type: it.mime || '' })))
          .then(d => { if (d) done(d.img); })
          .catch(err => console.warn('[dpo] picture', it.asset, err));
      } else if (key) {
        p.ready = new Promise(res => {
          const img = new Image();
          img.onload = () => { done(img); res(); };
          img.onerror = () => res();
          img.src = key;
        });
      } else p.ready = Promise.resolve();
      return p;
    }

    /** a picture moved out to an asset keeps the copy already decoded */
    renamePicture(from, to) {
      const p = imgCache.get(from);
      if (p && !imgCache.has(to)) imgCache.set(to, p);
      imgCache.delete(from);
    }

    /** a different board: release the pictures decoded for this one */
    forgetPictures() {
      for (const p of imgCache.values()) if (p.img && p.img.close) p.img.close();
      imgCache.clear();
    }

    /** a page of a dropped PDF: paper, drop shadow, then the rendered page */
    drawPdfPage(ctx, it) {
      /* The sheet under the bitmap has to match the paper the bitmap
         was baked with, or every page flashes white for the frame
         before its render lands. */
      const dark = this.tokens().dark;
      ctx.save();
      ctx.shadowColor = dark ? '#00000059' : '#00000026'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
      ctx.fillStyle = dark ? '#191b1f' : '#ffffff';
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.restore();

      const bmp = this.pageBitmap(ctx, it);
      if (bmp) ctx.drawImage(bmp, it.x, it.y, it.w, it.h);
      else {
        ctx.fillStyle = dark ? '#ffffff1f' : '#00000012';
        ctx.font = `${Math.max(11, it.w * 0.022)}px ${D.FONT_STACK}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${it.label || 'PDF'} · page ${it.page}`, it.x + it.w / 2, it.y + it.h / 2);
      }
      ctx.strokeStyle = dark ? '#ffffff1f' : '#0000001f';
      ctx.lineWidth = 1 / (this.paintZoom || this.app.camera.zoom);
      ctx.strokeRect(it.x, it.y, it.w, it.h);
    }

    /**
     * What to paint for a PDF page, which depends on what is painting.
     *
     * The screen asks D.pdf.bitmap, which also schedules a sharper render
     * and records the page as on screen. Nothing else may: the dashboard
     * thumbnail paints the whole board, and going through bitmap() made
     * every refresh of it — every few seconds of drawing — queue a render
     * of every page of every PDF on the board and mark them all as being
     * looked at, so the sweep could not cancel them and the sharp cache
     * churned out the pages actually on screen. Off screen, the painter
     * takes whatever is already cached. An export brings its own renders
     * (`this.pages`), made at the export's resolution and theme.
     */
    pageBitmap(ctx, it) {
      if (this.pages) return this.pages.get(it) || null;
      if (ctx === this.bctx || ctx === this.lctx) {
        // roughly one bitmap pixel per screen pixel, and no more
        return D.pdf.bitmap(this.app, it, this.app.camera.zoom * this.dpr);
      }
      return D.pdf.peek ? D.pdf.peek(it, this.tokens().dark) : null;
    }

    /* ── live layer ───────────────────────────────────────────────── */
    clearLive() {
      const ctx = this.lctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.live.width, this.live.height);
    }

    liveWorld() { const ctx = this.lctx; this.worldTransform(ctx); return ctx; }
    liveScreen() { const ctx = this.lctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); return ctx; }

    /* Handles grow under a finger or a pen (app.coarse): an 8px square is
       a mouse's target, not a nib's. */
    handleSize() { return this.app.coarse ? 13 : 8; }

    /**
     * The handles of a single line or arrow, in screen space: one at each
     * end, one on each corner of a polyline, and the bend handle in the
     * middle of a plain or curved line. Lines are edited by these instead
     * of a box's eight, which could only stretch them.
     */
    lineHandles(it) {
      const cam = this.app.camera, scene = this.app.scene;
      const pts = scene.linePath(it), n = pts.length;
      const s = p => cam.toScreen(p.x, p.y);
      const out = [
        { k: 'p0', ...s({ x: pts[0], y: pts[1] }), bound: !!it.bind1 },
        { k: 'p1', ...s({ x: pts[n - 2], y: pts[n - 1] }), bound: !!it.bind2 }
      ];
      if (it.via) for (let i = 0; i < it.via.length; i += 2) out.push({ k: 'v' + i / 2, ...s({ x: it.via[i], y: it.via[i + 1] }) });
      else out.push({ k: 'bend', ...s(D.pointAlong(pts, 0.5)) });
      return out;
    }

    /** selection outline + resize handles, drawn in screen space */
    drawSelection(sel, opts = {}) {
      if (!sel.length) return;
      const ctx = this.liveScreen(), cam = this.app.camera, scene = this.app.scene;
      const acc = this.tokens().accent;
      if (sel.length === 1 && D.isLine(sel[0]) && opts.handles !== false) return this.drawLineSelection(ctx, sel[0], acc);
      ctx.save();
      ctx.strokeStyle = acc;
      ctx.lineWidth = 1;

      let box = null;
      /* a box round each item helps to tell a few apart; round hundreds of
         strokes it is noise, and a frame's worth of drawing every frame */
      const each = (sel.length > 1 && sel.length <= 120) || opts.showEach;
      for (const it of sel) {
        const b = scene.bbox(it);
        box = U.unionBox(box, b);
        if (each) {
          ctx.setLineDash([4, 4]); ctx.globalAlpha = .55;
          if (b.local) this.turnedRect(ctx, b.local, it.rot, 2);       // a turned one, turned
          else {
            const a = cam.toScreen(b.x, b.y), c = cam.toScreen(b.x2, b.y2);
            ctx.strokeRect(a.x - 2, a.y - 2, c.x - a.x + 4, c.y - a.y + 4);
          }
          ctx.globalAlpha = 1; ctx.setLineDash([]);
        }
      }
      const fr = this.app.selRot && this.app.selectionFrame ? this.app.selectionFrame() : null;
      if (fr && fr.rot) { const out = this.drawTurnedFrame(ctx, fr, opts, acc); ctx.restore(); return out; }
      const a = cam.toScreen(box.x, box.y), c = cam.toScreen(box.x2, box.y2);
      const x = a.x - 5, y = a.y - 5, w = c.x - a.x + 10, h = c.y - a.y + 10;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, w, h);

      if (opts.handles !== false) {
        const hs = this.handleSize();
        ctx.fillStyle = this.tokens().panel;
        for (const [hx, hy] of [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]]) {
          ctx.beginPath(); ctx.roundRect(hx - hs / 2, hy - hs / 2, hs, hs, 2); ctx.fill(); ctx.stroke();
        }
        // the turn handle: a ring on a stalk above the top edge
        const t = this.turnHandle({ x, y, w, h });
        ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(t.x, t.y + t.r); ctx.stroke();
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.5, -2.4, 1.2); ctx.stroke();
      }
      ctx.restore();
      return { x, y, w, h };
    }

    /** a world box turned by `rot` about its middle, outlined on the screen layer, grown by `pad` px */
    turnedRect(ctx, L, rot, pad) {
      const cam = this.app.camera, z = cam.zoom, cx = L.x + L.w / 2, cy = L.y + L.h / 2;
      const hw = L.w / 2 + pad / z, hh = L.h / 2 + pad / z;
      const q = D.turnPoints([cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh], cx, cy, rot);
      ctx.beginPath();
      for (let i = 0; i < 8; i += 2) { const p = cam.toScreen(q[i], q[i + 1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
      ctx.closePath(); ctx.stroke();
    }

    /** where the handles of a turned frame sit, on the screen: { k, x, y } and the frame in screen px */
    frameHandles(fr) {
      const cam = this.app.camera, z = cam.zoom, c = cam.toScreen(fr.cx, fr.cy);
      const w = fr.w * z + 10, h = fr.h * z + 10, cs = Math.cos(fr.rot), sn = Math.sin(fr.rot);
      const at = (u, v) => ({ x: c.x + u * cs - v * sn, y: c.y + u * sn + v * cs });
      const hw = w / 2, hh = h / 2;
      const pts = [['nw', -hw, -hh], ['n', 0, -hh], ['ne', hw, -hh], ['e', hw, 0], ['se', hw, hh], ['s', 0, hh], ['sw', -hw, hh], ['w', -hw, 0]]
        .map(([k, u, v]) => Object.assign({ k }, at(u, v)));
      const t = this.turnHandle({ x: 0, y: 0, w: 0, h: 0 }), lift = -t.y;           // the stalk's length, as on a square box
      return { c, w, h, rot: fr.rot, pts, turn: Object.assign(at(0, -hh - lift), { r: t.r }), stalk: at(0, -hh) };
    }

    drawTurnedFrame(ctx, fr, opts, acc) {
      const F = this.frameHandles(fr), hs = this.handleSize();
      const corners = [F.pts[0], F.pts[2], F.pts[4], F.pts[6]];
      ctx.strokeStyle = acc; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
      if (opts.handles !== false) {
        ctx.fillStyle = this.tokens().panel;
        for (const p of F.pts) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(F.rot);
          ctx.beginPath(); ctx.roundRect(-hs / 2, -hs / 2, hs, hs, 2); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
        const t = F.turn;
        ctx.beginPath(); ctx.moveTo(F.stalk.x, F.stalk.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.5, -2.4, 1.2); ctx.stroke();
      }
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, frame: F };
    }

    /* A selected line: its centreline traced faintly, a round handle at
       each end (filled when that end is attached to something), a square
       on each corner of a polyline and a diamond for bending. The box it
       hands back carries the handles, for the select tool to find. */
    drawLineSelection(ctx, it, acc) {
      const cam = this.app.camera, scene = this.app.scene, hs = this.handleSize();
      const pts = scene.linePath(it);
      ctx.save();
      ctx.strokeStyle = acc; ctx.lineWidth = 1; ctx.globalAlpha = .5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) { const p = cam.toScreen(pts[i], pts[i + 1]); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const handles = this.lineHandles(it), panel = this.tokens().panel;
      for (const h of handles) {
        ctx.beginPath();
        if (h.k === 'bend') { const r = hs * .62; ctx.moveTo(h.x, h.y - r); ctx.lineTo(h.x + r, h.y); ctx.lineTo(h.x, h.y + r); ctx.lineTo(h.x - r, h.y); ctx.closePath(); }
        else if (h.k[0] === 'v') ctx.roundRect(h.x - hs / 2, h.y - hs / 2, hs, hs, 2);
        else ctx.arc(h.x, h.y, hs * .58, 0, 6.284);
        ctx.fillStyle = h.bound ? acc : panel;
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      let b = null;
      for (const h of handles) b = U.unionBox(b, U.box(h.x, h.y, h.x, h.y));
      return { x: b.x, y: b.y, w: b.w, h: b.h, line: handles };
    }

    /** the eight handle positions in screen space for a selection box */
    handleRects(box) {
      if (box.line) return [];                 // a line has its own handles (lineHandles)
      const hs0 = this.app.coarse ? 22 : 11;
      if (box.frame) {
        const F = box.frame, ts = Math.max(hs0, F.turn.r * 2 + 4);
        return F.pts.map(p => ({ k: p.k, x: p.x - hs0 / 2, y: p.y - hs0 / 2, w: hs0, h: hs0 }))
          .concat({ k: 'turn', x: F.turn.x - ts / 2, y: F.turn.y - ts / 2, w: ts, h: ts });
      }
      const { x, y, w, h } = box, hs = hs0;
      const pts = [
        ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + h / 2],
        ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2]
      ];
      const t = this.turnHandle(box), ts = Math.max(hs, t.r * 2 + 4);
      return pts.map(([k, px, py]) => ({ k, x: px - hs / 2, y: py - hs / 2, w: hs, h: hs }))
        .concat({ k: 'turn', x: t.x - ts / 2, y: t.y - ts / 2, w: ts, h: ts });
    }

    /** where the turn handle sits over a selection box (screen px) */
    turnHandle(box) {
      const coarse = this.app.coarse;
      return { x: box.x + box.w / 2, y: box.y - (coarse ? 34 : 24), r: coarse ? 9 : 6 };
    }

    /* ── export ───────────────────────────────────────────────────── */
    /* An export is painted in the theme Settings → Export asks for, which
       need not be the one on screen: "ink" and "paper" resolve for it, and
       PDF pages are rendered light or dark to match. `look` is
       { theme, dark, transparent }, from App.exportLook. */

    /**
     * Paint `items` onto an export canvas whose transform is already set,
     * at `zoom` device px per world unit.
     *
     * PDF pages are rendered for the export one at a time, at its
     * resolution, rather than taken from the screen's cache: the cache
     * holds sharp renders only of the pages on screen, so an export used
     * to come out with every other page as a blurry thumbnail or a grey
     * placeholder. One page at a time keeps a long document's memory flat.
     *
     * Painting is synchronous between the awaits, which is what makes
     * borrowing the theme safe: the screen never draws while it is lent.
     */
    async paintExport(ctx, items, zoom, look) {
      await Promise.all(items.filter(it => it.type === 'image').map(it => this.picture(it).ready));
      const paint = fn => U.paintAs(look.theme, fn);
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const r = run; run = [];
        paint(() => this.drawItems(ctx, r, zoom));
      };
      for (const it of items) {
        if (it.type !== 'pdfpage') { run.push(it); continue; }
        flush();
        const bmp = await D.pdf.render(this.app, it, zoom, look.dark);
        this.pages = new Map([[it, bmp]]);
        try { paint(() => { this.paintZoom = zoom; this.drawItem(ctx, it); }); }
        finally {
          this.pages = null;
          if (bmp && bmp.width) { bmp.width = 0; bmp.height = 0; }
        }
      }
      flush();
    }

    async toSVG(scene, box, look) {
      const pad = 40;
      const b = U.growBox(box, pad);

      /* The parts that take waiting for, gathered before the theme is
         borrowed: PDF pages rendered in the export's theme, and pictures
         as data URLs so the file stands on its own. */
      const hrefs = new Map();
      for (const it of scene.items) {
        if (it.type === 'pdfpage') {
          const bmp = await D.pdf.render(this.app, it, 2, look.dark);
          if (bmp) { hrefs.set(it, bitmapToDataUrl(bmp)); bmp.width = 0; bmp.height = 0; }
        } else if (it.type === 'image') hrefs.set(it, await this.imageHref(it));
      }

      return U.paintAs(look.theme, () => {
        const out = [];
        out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(b.w)}" height="${Math.round(b.h)}" viewBox="${U.round(b.x)} ${U.round(b.y)} ${U.round(b.w)} ${U.round(b.h)}">`);
        if (!look.transparent)
          out.push(`<rect x="${U.round(b.x)}" y="${U.round(b.y)}" width="${U.round(b.w)}" height="${U.round(b.h)}" fill="${U.color('paper')}"/>`);
        for (const it of scene.items) {
          const s = svgItem(this, scene, it, hrefs), b = it.rot && s ? scene.bbox(it) : null;
          if (b && b.local) {
            const c = U.boxCenter(b.local);
            out.push(`<g transform="rotate(${U.round(it.rot * 180 / Math.PI, 3)} ${U.round(c.x, 2)} ${U.round(c.y, 2)})">${s}</g>`);
          } else out.push(s);
        }
        out.push('</svg>');
        return out.join('\n');
      });
    }

    /** a picture's source as something an SVG can carry */
    async imageHref(it) {
      if (!it.asset) return it.src || '';
      const bytes = await this.app.getAsset(it.asset);
      return bytes ? `data:${it.mime || 'image/png'};base64,${D.store.toB64(bytes)}` : '';
    }
  }

  function midOf(pts) {
    const total = U.pathLength(pts); let d = 0;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const l = U.dist(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      if (d + l >= total / 2) {
        const t = (total / 2 - d) / (l || 1);
        return { x: U.lerp(pts[i], pts[i + 2], t), y: U.lerp(pts[i + 1], pts[i + 3], t) };
      }
      d += l;
    }
    return { x: pts[0], y: pts[1] };
  }

  function svgItem(r, scene, it, hrefs) {
    const a = it.alpha ?? 1;
    const op = a < 1 ? ` opacity="${a}"` : '';
    switch (it.type) {
      case 'stroke': {
        // the same outline the canvas fills, taper and caps included
        const poly = FH.shapes(it.pts, { size: it.size, thinning: it.thinning, taper: it.taper || 0, cap: it.cap !== false });
        const blend = r.blendFor(it) === 'multiply' ? ' style="mix-blend-mode:multiply"' : '';
        return `<path d="${FH.svgPath(poly)}" fill="${U.color(it.color)}"${op}${blend}/>`;
      }
      case 'shape': {
        const dash = svgDash(dashFor(it.dash, it.size));
        const col = U.color(it.color);
        if (D.isLine(it) || it.kind === 'moment') {
          const L = lineParts(scene, it);
          if (!L) return '';
          return `<g${op}><path d="${svgShaft(L)}" fill="none" stroke="${col}" stroke-width="${it.size}" stroke-linejoin="round" stroke-linecap="round"${dash}/>` +
            svgHeads(L.heads, col, it.size) + '</g>';
        }
        const pts = scene.outlinePoints(it).map(v => U.round(v, 1));
        const d = 'M' + pts.filter((_, i) => i % 2 === 0).map((x, i) => `${x},${pts[i * 2 + 1]}`).join('L');
        const fill = it.fill && it.fill !== 'none' ? U.color(it.fill) : 'none';
        return `<path d="${d}" fill="${fill}" stroke="${col}" stroke-width="${it.size}" stroke-linejoin="round" stroke-linecap="round"${dash}${op}/>`;
      }
      case 'edge': {
        const raw = scene.edgePath(it), pts = raw.map(v => U.round(v, 1)), n = raw.length;
        const d = 'M' + pts.filter((_, i) => i % 2 === 0).map((x, i) => `${x},${pts[i * 2 + 1]}`).join('L');
        const dash = svgDash(it.dash === 1 ? [it.size * 3, it.size * 2.4] : dashFor(it.dash, it.size));
        // the heads the canvas draws, which the export used to leave off
        const heads = [];
        if (n >= 4 && it.arrowEnd) heads.push(headGeom('filled', raw[n - 2], raw[n - 1], Math.atan2(raw[n - 1] - raw[n - 3], raw[n - 2] - raw[n - 4]), it.size, 1));
        if (n >= 4 && it.arrowStart) heads.push(headGeom('filled', raw[0], raw[1], Math.atan2(raw[1] - raw[3], raw[0] - raw[2]), it.size, 1));
        return `<g${op}><path d="${d}" fill="none" stroke="${U.color(it.color)}" stroke-width="${it.size}" stroke-linecap="round"${dash}/>` +
          svgHeads(heads, U.color(it.color), it.size) + '</g>';
      }
      case 'note':
        return `<g${op}><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="6" fill="${U.color(it.color)}"/>` +
          svgText(scene, { ...it, x: it.x + 14, y: it.y + 14, w: it.w - 28, color: it.textColor || '#22252c' }) + '</g>';
      case 'node': {
        const pts = scene.outlinePoints({ ...it, type: 'shape', kind: it.kind === 'decision' ? 'diamond' : 'rect' }).map(v => U.round(v, 1));
        const d = 'M' + pts.filter((_, i) => i % 2 === 0).map((x, i) => `${x},${pts[i * 2 + 1]}`).join('L') + 'Z';
        const L = scene.layout({ text: it.text, size: it.textSize || 15, w: it.w - 20 });
        const top = it.y + (it.h - L.lines.length * L.lh) / 2 + L.base;
        const tx = L.lines.map((ln, i) => `<text x="${it.x + it.w / 2}" y="${top + i * L.lh}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${it.textSize || 15}" fill="${U.color(it.textColor || it.color)}">${U.escapeXml(ln)}</text>`).join('');
        return `<g${op}><path d="${d}" fill="${U.color(it.fill)}" stroke="${U.color(it.color)}" stroke-width="${it.size}"/>${tx}</g>`;
      }
      case 'text': return svgText(scene, it, op);
      case 'image': return `<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" href="${U.escapeXml(hrefs.get(it) || '')}" preserveAspectRatio="none"${op}/>`;
      case 'pdfpage': {
        const href = hrefs.get(it);
        return href
          ? `<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" href="${href}" preserveAspectRatio="none"${op}/>`
          : `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${r.tokens().dark ? '#191b1f' : '#fff'}" stroke="#0003"/>`;
      }
      default: {
        const x = XT[it.type];
        // its opacity is applied here, as drawItem applies it on canvas
        const out = x && x.svg ? x.svg(it, r) : '';
        return out && op ? `<g${op}>${out}</g>` : out || '';
      }
    }
    return '';
  }

  /* ── line styles and arrowheads ───────────────────────────────────
     Shared by the canvas and the SVG export, so a drawing exports as it
     looks. Patterns and heads are in world units and scale with the
     stroke, as drafting conventions put them: a centre line's dash and
     dot, a hidden line's short dashes. Round caps lengthen every dash by
     a stroke width, so the gaps are set wider than they look. */
  function dashFor(dash, size) {
    const s = Math.max(size || 2, 1.5);
    switch (dash) {
      case 1: return [s * 3, s * 2.2];                          // dashed
      case 2: return [0.1, s * 2.2];                            // dotted
      case 3: return [s * 7, s * 2.6, 0.1, s * 2.6];            // centre line: long dash, dot
      case 4: return [s * 1.6, s * 2.2];                        // hidden line: short dashes
      default: return [];
    }
  }
  const svgDash = da => da.length ? ` stroke-dasharray="${da.map(v => U.round(v, 2)).join(',')}"` : '';

  /**
   * One arrowhead, as primitives in world units: `fill` polygons, `line`
   * polylines stroked at the shaft's width (times `weight`), and `dot`s —
   * plus `back`, how far the shaft should stop short of the tip to stay
   * inside the head. (tx, ty) is the tip, `ang` the way the head points.
   */
  function headGeom(style, tx, ty, ang, size, scale, spread) {
    const len = D.headLen(size, scale), c = Math.cos(ang), s = Math.sin(ang);
    const at = (back, side) => [tx - c * back - s * side, ty - s * back + c * side];
    switch (style) {
      case 'filled': {
        const w = len * Math.tan(spread || 0.4);
        return { fill: [[tx, ty, ...at(len, w), ...at(len, -w)]], back: len * 0.6 };
      }
      case 'open': {
        const w = len * Math.tan(spread ? spread * 1.1 : 0.45);
        return { line: [[...at(len, w), tx, ty, ...at(len, -w)]], back: 0 };
      }
      case 'half': {
        const w = len * Math.tan(0.45);
        return { fill: [[tx, ty, ...at(len, w), ...at(len * 0.8, 0)]], back: len * 0.3 };
      }
      case 'tick': {
        // the architect's slash: 45° across the end, a little heavier than the line
        const r = len * 0.42, k = Math.SQRT1_2;
        return { line: [[tx - (c - s) * k * r, ty - (s + c) * k * r, tx + (c - s) * k * r, ty + (s + c) * k * r]], weight: 1.5, back: 0 };
      }
      case 'dot': return { dot: [[tx, ty, Math.max(2.5, (size || 2) * 1.5) * (scale || 1)]], back: 0 };
      default: return null;
    }
  }

  function paintHeads(ctx, heads, col, size) {
    ctx.fillStyle = col; ctx.strokeStyle = col;
    for (const h of heads) {
      if (!h) continue;
      if (h.fill) for (const p of h.fill) {
        ctx.beginPath(); ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.closePath(); ctx.fill();
      }
      if (h.line) for (const p of h.line) {
        ctx.lineWidth = size * (h.weight || 1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.stroke();
      }
      if (h.dot) for (const [x, y, r] of h.dot) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
    }
  }

  function svgHeads(heads, col, size) {
    let out = '';
    const P = p => p.map(v => U.round(v, 2));
    for (const h of heads) {
      if (!h) continue;
      if (h.fill) for (const p of h.fill) out += `<path d="M${P(p).join(' ')}Z" fill="${col}"/>`;
      if (h.line) for (const p of h.line) out += `<path d="M${P(p).join(' ')}" fill="none" stroke="${col}" stroke-width="${U.round(size * (h.weight || 1), 2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (h.dot) for (const [x, y, r] of h.dot) out += `<circle cx="${U.round(x, 2)}" cy="${U.round(y, 2)}" r="${U.round(r, 2)}" fill="${col}"/>`;
    }
    return out;
  }

  /**
   * A line-like shape resolved for painting: { pts | quad | arc, heads }.
   * `pts` is a polyline, `quad` a curve [a, c, b], `arc` a moment's arc,
   * each already cut back at an end that has a head over it. Null if there
   * is nothing to draw.
   */
  function lineParts(scene, it) {
    const [h1, h2] = D.headsOf(it);
    if (it.kind === 'moment') {
      const A = D.arcOf(it);
      if (!(A.rx > 0 && A.ry > 0) || !A.sweep) return null;
      const r = (A.rx + A.ry) / 2, dir = Math.sign(A.sweep);
      const len = D.headLen(it.size, it.headScale);
      /* each head points along the chord it covers rather than along the
         tangent at its tip, which is what makes it sit on a tight arc */
      const head = (style, t, out) => {
        if (style === 'none') return { g: null, cut: 0 };
        const tip = D.arcPoint(A, t), from = D.arcPoint(A, t - out * Math.min(len / r, Math.abs(A.sweep) / 2));
        const g = headGeom(style, tip.x, tip.y, Math.atan2(tip.y - from.y, tip.x - from.x), it.size, it.headScale);
        return { g, cut: g ? Math.min(g.back / r, Math.abs(A.sweep) / 3) : 0 };
      };
      const e = head(h2, A.a0 + A.sweep, dir), s = head(h1, A.a0, -dir);
      return { arc: { ...A, a0: A.a0 + s.cut * dir, sweep: A.sweep - (s.cut + e.cut) * dir }, heads: [s.g, e.g] };
    }
    const [a, b] = scene.lineEnds(it);
    const via = D.viaOf(it, a, b);
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1e-9 && !via) return null;
    const c = !via && D.curveCtrl(a, b, it.curve);
    // the way each head points: along the last stretch of the line
    let from0, from1;
    if (via) { from0 = { x: via[0], y: via[1] }; from1 = { x: via[via.length - 2], y: via[via.length - 1] }; }
    else if (c) { from0 = c; from1 = c; }
    else { from0 = b; from1 = a; }
    const g1 = h1 !== 'none' ? headGeom(h1, a.x, a.y, Math.atan2(a.y - from0.y, a.x - from0.x), it.size, it.headScale) : null;
    const g2 = h2 !== 'none' ? headGeom(h2, b.x, b.y, Math.atan2(b.y - from1.y, b.x - from1.x), it.size, it.headScale) : null;
    // the shaft stops short under a head, but never by more than half its first or last stretch
    const cut = (p, q, d) => {
      const l = U.dist(p.x, p.y, q.x, q.y);
      if (!d || !l) return p;
      const f = Math.min(d, l / 2) / l;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
    };
    const p0 = cut(a, from0, g1 && g1.back), p1 = cut(b, from1, g2 && g2.back);
    if (c) return { quad: [p0, c, p1], heads: [g1, g2] };
    const pts = [p0.x, p0.y];
    if (via) pts.push(...via);
    pts.push(p1.x, p1.y);
    return { pts, heads: [g1, g2] };
  }

  function traceShaft(ctx, L) {
    if (L.arc) { const A = L.arc; ctx.ellipse(A.cx, A.cy, A.rx, A.ry, 0, -A.a0, -(A.a0 + A.sweep), A.sweep > 0); return; }
    if (L.quad) { const [a, c, b] = L.quad; ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); return; }
    const p = L.pts;
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  }

  function svgShaft(L) {
    const r = v => U.round(v, 2);
    if (L.arc) {
      const A = L.arc, p = D.arcPoint(A, A.a0), q = D.arcPoint(A, A.a0 + A.sweep);
      // an anticlockwise arc on screen is SVG's negative sweep
      const large = Math.abs(A.sweep) > Math.PI ? 1 : 0, sweepFlag = A.sweep > 0 ? 0 : 1;
      return `M${r(p.x)},${r(p.y)} A${r(A.rx)},${r(A.ry)} 0 ${large} ${sweepFlag} ${r(q.x)},${r(q.y)}`;
    }
    if (L.quad) { const [a, c, b] = L.quad; return `M${r(a.x)},${r(a.y)} Q${r(c.x)},${r(c.y)} ${r(b.x)},${r(b.y)}`; }
    const p = L.pts;
    let d = `M${r(p[0])},${r(p[1])}`;
    for (let i = 2; i < p.length; i += 2) d += `L${r(p[i])},${r(p[i + 1])}`;
    return d;
  }

  D.dashFor = dashFor;
  D.svgDash = svgDash;
  D.headGeom = headGeom;
  D.paintHeads = paintHeads;
  D.svgHeads = svgHeads;
  D.lineParts = lineParts;

  /** OffscreenCanvas has no toDataURL, so copy through a normal one */
  function bitmapToDataUrl(bmp) {
    try {
      if (bmp.toDataURL) return bmp.toDataURL('image/png');
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      return c.toDataURL('image/png');
    } catch (_) { return null; }
  }

  function svgText(scene, it, op = '') {
    const L = scene.layout(it);
    const family = it.font === 'hand' ? 'Segoe Print, Bradley Hand, cursive' : 'Segoe UI, sans-serif';
    const w = it.autoWidth ? L.width : it.w;
    const anchor = it.align === 'center' ? 'middle' : it.align === 'right' ? 'end' : 'start';
    const ax = it.align === 'center' ? it.x + w / 2 : it.align === 'right' ? it.x + w : it.x;
    return `<g${op}>` + L.lines.map((ln, i) =>
      `<text x="${U.round(ax, 1)}" y="${U.round(it.y + i * L.lh + L.base, 1)}" text-anchor="${anchor}" font-family="${family}" font-size="${it.size}" fill="${U.color(it.color)}" xml:space="preserve">${U.escapeXml(ln)}</text>`).join('') + '</g>';
  }

  D.Renderer = Renderer;
})(window.DPO);

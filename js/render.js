/* ── render.js ── canvas painting ───────────────────────────────────
   #base holds the committed scene, #live holds the in-flight stroke,
   marquees, selection handles and other transient chrome. Keeping the
   two apart means the pen never waits on a full scene redraw.        */
(function (D) {
  'use strict';
  const U = D.util, FH = D.freehand;

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
      const st = {
        x: cam.x, y: cam.y, zoom: cam.zoom, dpr: this.dpr, w: this.w, h: this.h,
        theme: U.theme(), grid: this.grid, v: scene.version, edit: editor && editor.item,
        edits: scene.edits, count: scene.items.length
      };
      const was = this._painted;
      this._painted = st;
      if (was && this.addedOnly(was, st)) return;
      if (scroll && was && this.scrollFrom(was, st)) return;
      this.paintAll();
    }

    /** the next paint must be a whole one: something changed that the scene cannot see */
    invalidate() { this._painted = null; }

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

    paintAll() {
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
      const visible = app.scene.near(view);
      this.lastDrawn = visible.length;
      this.drawItems(ctx, visible);
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
      switch (it.type) {
        case 'stroke': this.drawStroke(ctx, it); break;
        case 'shape': this.drawShape(ctx, it); break;
        case 'text': this.drawText(ctx, it); break;
        case 'note': this.drawNote(ctx, it); break;
        case 'node': this.drawNode(ctx, it); break;
        case 'edge': this.drawEdge(ctx, it); break;
        case 'image': this.drawImage(ctx, it); break;
        case 'pdfpage': this.drawPdfPage(ctx, it); break;
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
      ctx.setLineDash(it.dash ? (it.dash === 1 ? [it.size * 3, it.size * 2.2] : [0.1, it.size * 2.2]) : []);
      ctx.lineCap = it.dash === 2 ? 'round' : 'round';
    }

    drawShape(ctx, it) {
      const p = this.shapePath(it);
      if (it.fill && it.fill !== 'none') { ctx.fillStyle = U.color(it.fill); ctx.fill(p); }
      this.strokeStyleFor(ctx, it);
      ctx.stroke(p);
      ctx.setLineDash([]);
      if (it.kind === 'arrow') this.arrowHead(ctx, it.x, it.y, it.x + it.w, it.y + it.h, it.size, it.color);
      if (it.kind === 'line' && it.arrowStart) this.arrowHead(ctx, it.x + it.w, it.y + it.h, it.x, it.y, it.size, it.color);
    }

    arrowHead(ctx, fx, fy, tx, ty, size, color) {
      const a = Math.atan2(ty - fy, tx - fx);
      const len = Math.max(9, size * 3.4), spread = 0.42;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.cos(a - spread) * len, ty - Math.sin(a - spread) * len);
      ctx.lineTo(tx - Math.cos(a + spread) * len, ty - Math.sin(a + spread) * len);
      ctx.closePath();
      ctx.fillStyle = U.color(color); ctx.fill();
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
      ctx.setLineDash(it.dash ? [it.size * 3, it.size * 2.4] : []);
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
          .then(bytes => bytes && createImageBitmap(new Blob([bytes], { type: it.mime || '' })))
          .then(img => { if (img) done(img); })
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

    /** selection outline + resize handles, drawn in screen space */
    drawSelection(sel, opts = {}) {
      if (!sel.length) return;
      const ctx = this.liveScreen(), cam = this.app.camera, scene = this.app.scene;
      const acc = this.tokens().accent;
      ctx.save();
      ctx.strokeStyle = acc;
      ctx.lineWidth = 1;

      let box = null;
      for (const it of sel) {
        const b = scene.bbox(it);
        box = U.unionBox(box, b);
        if (sel.length > 1 || opts.showEach) {
          const a = cam.toScreen(b.x, b.y), c = cam.toScreen(b.x2, b.y2);
          ctx.setLineDash([4, 4]); ctx.globalAlpha = .55;
          ctx.strokeRect(a.x - 2, a.y - 2, c.x - a.x + 4, c.y - a.y + 4);
          ctx.globalAlpha = 1; ctx.setLineDash([]);
        }
      }
      const a = cam.toScreen(box.x, box.y), c = cam.toScreen(box.x2, box.y2);
      const x = a.x - 5, y = a.y - 5, w = c.x - a.x + 10, h = c.y - a.y + 10;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, w, h);

      if (opts.handles !== false) {
        const hs = 8;
        ctx.fillStyle = this.tokens().panel;
        for (const [hx, hy] of [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]]) {
          ctx.beginPath(); ctx.roundRect(hx - hs / 2, hy - hs / 2, hs, hs, 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
      return { x, y, w, h };
    }

    /** the eight handle positions in screen space for a selection box */
    handleRects(box) {
      const { x, y, w, h } = box, hs = 11;
      const pts = [
        ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + h / 2],
        ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2]
      ];
      return pts.map(([k, px, py]) => ({ k, x: px - hs / 2, y: py - hs / 2, w: hs, h: hs }));
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
        for (const it of scene.items) out.push(svgItem(this, scene, it, hrefs));
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
        const pts = scene.outlinePoints(it).map(v => U.round(v, 1));
        const d = 'M' + pts.filter((_, i) => i % 2 === 0).map((x, i) => `${x},${pts[i * 2 + 1]}`).join('L');
        const dash = it.dash ? ` stroke-dasharray="${it.size * 3},${it.size * 2}"` : '';
        const fill = it.fill && it.fill !== 'none' ? U.color(it.fill) : 'none';
        return `<path d="${d}" fill="${fill}" stroke="${U.color(it.color)}" stroke-width="${it.size}" stroke-linejoin="round" stroke-linecap="round"${dash}${op}/>`;
      }
      case 'edge': {
        const pts = scene.edgePath(it).map(v => U.round(v, 1));
        const d = 'M' + pts.filter((_, i) => i % 2 === 0).map((x, i) => `${x},${pts[i * 2 + 1]}`).join('L');
        return `<path d="${d}" fill="none" stroke="${U.color(it.color)}" stroke-width="${it.size}"${op}/>`;
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
    }
    return '';
  }

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

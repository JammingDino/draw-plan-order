/* ── tools.js ── one small state machine per tool ────────────────────
   Every tool implements: down(ev) move(ev) up(ev) cancel() paint(r)
   `ev` carries world + screen coords, pressure and modifier state.   */
(function (D) {
  'use strict';
  const U = D.util, FH = D.freehand, RG = D.recognize, mk = D.make;

  const HOLD_MS = 550;          // hold-still-to-snap delay
  const HOLD_SLOP = 7;          // px of wobble allowed while holding

  /* Picking up a PDF page or picture with the select tool: press and
     hold this long, within this much wobble. A quicker drag selects
     what is written on it instead. */
  const PICKUP_MS = 300;
  const PICKUP_SLOP = 6;        // screen px
  const GRAB_TOL = 14;          // screen px: how near ink on a page must be to win

  /* ══ pen / highlighter ══════════════════════════════════════════ */
  class PenTool {
    constructor(app, kind) { this.app = app; this.kind = kind; this.incremental = false; }

    get opt() { return this.app.opts[this.kind]; }

    down(ev) {
      const o = this.opt;
      const a = this.app;
      this.item = mk.stroke({
        color: o.color, size: o.size, alpha: o.alpha,
        thinning: this.kind === 'highlighter' ? 0 : o.thinning,
        blend: this.kind === 'highlighter' ? 'multiply' : 'source-over',
        taper: this.kind === 'highlighter' ? 0 : o.size * 2.5
      });
      this.raw = [];
      this.sm = null;
      this.snapped = null;
      this.holdAt = null;
      this.lastDrawn = 0;
      this.incremental = o.alpha >= 1 && this.kind !== 'highlighter';
      this.push(ev);
      a.renderer.clearLive();
      this.armHold(ev);
    }

    push(ev) {
      const p = ev.pressure;
      const n = this.raw.length;
      // half a screen pixel, but never finer than the nib can actually resolve —
      // otherwise zooming in floods the stroke with near-duplicate samples
      const min = Math.max(0.55 / this.app.camera.zoom, FH.spacing(this.opt.size) * 0.5);
      if (n >= 3 && U.dist(this.raw[n - 3], this.raw[n - 2], ev.x, ev.y) < min) {
        this.raw[n - 1] = Math.max(this.raw[n - 1], p);           // same spot: just take the harder press
        return false;
      }
      this.raw.push(ev.x, ev.y, p);
      /* Extend the smoothed copy rather than rebuilding it: filtering the
         whole stroke on every sample is quadratic, and a pen at 240Hz makes
         that felt well before the stroke looks long. */
      if (this.raw.length <= 6) { this.sm = null; this.item.pts = this.raw.slice(); }
      else if (!this.sm || this.sm.length + 3 !== this.raw.length) this.item.pts = this.sm = FH.smooth(this.raw);
      else this.item.pts = FH.smoothStep(this.raw, this.sm);
      this.item._path = null; this.item._lod = null; this.item._b = null;
      return true;
    }

    armHold(ev) {
      clearTimeout(this.holdTimer);
      this.holdOrigin = { x: ev.sx, y: ev.sy };
      if (!this.app.opts.general.holdToSnap || this.kind === 'highlighter') return;
      this.holdTimer = setTimeout(() => this.trySnap(), HOLD_MS);
    }

    trySnap() {
      if (!this.item || this.raw.length < 12) return;
      const shape = RG.recognise(this.item.pts, { snapAngle: true });
      if (!shape) return;
      this.snapped = shape;
      this.incremental = false;
      this.app.haptic();
      this.app.hint(this.holdOrigin.x, this.holdOrigin.y, labelFor(shape.kind));
      this.app.requestDrawLive();
    }

    move(ev) {
      if (!this.item) return;
      let moved = false;
      for (const s of ev.samples) moved = this.push(s) || moved;
      if (!moved) return;
      if (U.dist(ev.sx, ev.sy, this.holdOrigin.x, this.holdOrigin.y) > HOLD_SLOP) {
        if (this.snapped) { this.snapped = null; this.app.hideHint(); this.incremental = false; }
        this.armHold(ev);
      }
      this.app.requestDrawLive();
    }

    up(ev) {
      clearTimeout(this.holdTimer);
      this.app.hideHint();
      const app = this.app, scene = app.scene, o = this.opt;
      const item = this.item;
      this.item = null;
      app.renderer.clearLive();
      if (!item) return;

      /* hold-to-snap → clean geometry */
      if (this.snapped) {
        const s = this.snapped;
        const g = shapeFromRecognised(s, o);
        scene.begin('snap shape'); scene.add(g); scene.commit();
        app.finishCreate(g);
        app.afterEdit();
        return;
      }

      /* scribble-to-erase */
      if (app.opts.general.scribbleErase && this.kind === 'pen') {
        const sc = RG.scribble(item.pts);
        if (sc.is) {
          const hit = scene.itemsCrossing(sc.poly, item.size, it => it !== item && D.erasable(it));
          if (hit.length) {
            scene.begin('scribble erase');
            for (const h of hit) scene.remove(h);
            scene.commit();
            app.toast(`Rubbed out ${hit.length} item${hit.length > 1 ? 's' : ''}`, 'Undo', () => app.undo());
            app.afterEdit();
            return;
          }
        }
      }

      if (U.pathLength(RG.xy(item.pts)) < 1.2 && item.pts.length <= 6) {
        // a tap: leave a dot rather than nothing
      }
      scene.begin('draw'); scene.add(item); scene.commit();
      app.afterEdit();
    }

    cancel() { clearTimeout(this.holdTimer); this.item = null; this.app.renderer.clearLive(); this.app.hideHint(); }

    paint(r) {
      if (!this.item) return;
      if (this.snapped) {
        r.clearLive();
        const ctx = r.liveWorld();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        r.drawItem(ctx, shapeFromRecognised(this.snapped, this.opt));
        return;
      }
      const ctx = r.liveWorld();
      ctx.globalAlpha = this.item.alpha;
      ctx.globalCompositeOperation = r.blendFor(this.item);
      ctx.fillStyle = U.color(this.item.color);      // 'ink' follows the theme

      if (this.incremental) {
        const pts = this.item.pts;
        const from = Math.max(0, this.lastDrawn - 4);      // overlap so tails join seamlessly
        const tail = pts.slice(from * 3);
        if (tail.length >= 3) {
          const poly = FH.shapes(tail, { size: this.item.size, thinning: this.item.thinning });
          ctx.fill(FH.path(poly));
        }
        this.lastDrawn = pts.length / 3;
      } else {
        r.clearLive();
        const c2 = r.liveWorld();
        c2.globalAlpha = this.item.alpha;
        c2.globalCompositeOperation = r.blendFor(this.item);
        c2.fillStyle = U.color(this.item.color);
        const poly = FH.shapes(this.item.pts, { size: this.item.size, thinning: this.item.thinning, taper: this.item.taper });
        c2.fill(FH.path(poly));
      }
    }
  }

  function labelFor(k) {
    return { line: 'Straight line', arrow: 'Arrow', rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond', triangle: 'Triangle' }[k] || 'Shape';
  }

  function shapeFromRecognised(s, o) {
    const base = { color: o.color, size: o.size, alpha: o.alpha, fill: 'none' };
    if (s.kind === 'line' || s.kind === 'arrow')
      return mk.shape({ ...base, kind: s.kind, x: s.x1, y: s.y1, w: s.x2 - s.x1, h: s.y2 - s.y1 });
    return mk.shape({ ...base, kind: s.kind, x: s.box.x, y: s.box.y, w: s.box.w, h: s.box.h });
  }
  D.shapeFromRecognised = shapeFromRecognised;

  /* ══ eraser ═════════════════════════════════════════════════════ */
  class EraserTool {
    constructor(app) { this.app = app; }
    get opt() { return this.app.opts.eraser; }

    down(ev) {
      this.path = [ev.x, ev.y];
      this.app.scene.begin('erase');
      this.erase();
      this.app.requestDrawLive();
    }
    move(ev) {
      if (!this.path) return;
      for (const s of ev.samples) this.path.push(s.x, s.y);
      this.erase();
      this.app.requestDrawLive();
    }
    erase() {
      const app = this.app, scene = app.scene;
      const rad = this.opt.size / 2;          // in world units, like the pen
      const tail = this.path.slice(Math.max(0, this.path.length - 8));
      const hits = scene.itemsCrossing(tail.length >= 4 ? tail : this.path, rad, D.erasable);
      if (!hits.length) return;
      if (this.opt.mode === 'partial') {
        for (const it of hits) {
          if (it.type !== 'stroke') { scene.remove(it); continue; }
          const parts = splitStroke(it, this.path, rad);
          if (parts === null) continue;
          const idx = scene.indexOf(it);
          scene.remove(it);
          for (const p of parts) scene.add(p, idx);
        }
      } else {
        for (const it of hits) scene.remove(it);
      }
      app.requestDraw();
    }
    up() {
      this.path = null;
      this.app.scene.commit();
      this.app.renderer.clearLive();
      this.app.afterEdit();
    }
    cancel() { this.path = null; this.app.scene.cancel(); }

    paint(r) {
      const app = this.app;
      const ctx = r.liveScreen();
      const p = app.pointer;
      if (!p) return;
      const s = this.opt.size * app.camera.zoom;
      ctx.save();
      ctx.strokeStyle = r.tokens().muted;
      ctx.globalAlpha = .6; ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(4, s / 2), 0, 6.284); ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Add points along any segment longer than `step`, so a cut can land
   * anywhere on the stroke rather than only where the digitiser happened to
   * sample. Without this, rubbing through the middle of a fast straight line
   * (which may be two points end to end) does nothing at all.
   */
  function densify(pts, step) {
    const out = [];
    for (let i = 0; i + 5 < pts.length; i += 3) {
      const ax = pts[i], ay = pts[i + 1], ap = pts[i + 2];
      const bx = pts[i + 3], by = pts[i + 4], bp = pts[i + 5];
      out.push(ax, ay, ap);
      const n = Math.floor(U.dist(ax, ay, bx, by) / step);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t);
      }
    }
    out.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
    return out;
  }

  /** cut the parts of a stroke that fall within `rad` of `path`; null if untouched */
  function splitStroke(item, path, rad) {
    const pts = densify(item.pts, Math.max(1, rad * 0.4));
    const out = [];
    let cur = [];
    let cut = false;
    const r2 = (rad + item.size / 2) ** 2;
    for (let i = 0; i < pts.length; i += 3) {
      let near = false;
      for (let j = 0; j + 3 < path.length; j += 2) {
        if (U.distToSegment2(pts[i], pts[i + 1], path[j], path[j + 1], path[j + 2], path[j + 3]) < r2) { near = true; break; }
      }
      if (path.length === 2 && U.dist2(pts[i], pts[i + 1], path[0], path[1]) < r2) near = true;
      if (near) { cut = true; if (cur.length >= 6) out.push(cur); cur = []; }
      else cur.push(pts[i], pts[i + 1], pts[i + 2]);
    }
    if (cur.length >= 6) out.push(cur);
    if (!cut) return null;
    return out.map(p => D.make.stroke({ ...D.clone(item), id: U.uid(), pts: p }));
  }

  /* ══ shapes ═════════════════════════════════════════════════════ */
  class ShapeTool {
    constructor(app) { this.app = app; }
    get opt() { return this.app.opts.shape; }

    down(ev) {
      const o = this.opt;
      this.start = { x: ev.x, y: ev.y };
      this.item = mk.shape({
        kind: o.kind, x: ev.x, y: ev.y, w: 0, h: 0,
        color: o.color, size: o.size, alpha: o.alpha, fill: o.fill, dash: o.dash, radius: o.radius
      });
      this.app.requestDrawLive();
    }
    move(ev) {
      if (!this.item) return;
      let x2 = ev.x, y2 = ev.y;
      const it = this.item, s = this.start;
      if (ev.shift) {
        if (it.kind === 'line' || it.kind === 'arrow') [x2, y2] = RG.snapAngle(s.x, s.y, x2, y2, 23);
        else { const d = Math.max(Math.abs(x2 - s.x), Math.abs(y2 - s.y)); x2 = s.x + Math.sign(x2 - s.x) * d; y2 = s.y + Math.sign(y2 - s.y) * d; }
      }
      if (ev.alt && it.kind !== 'line' && it.kind !== 'arrow') {
        it.x = s.x - (x2 - s.x); it.y = s.y - (y2 - s.y);
        it.w = (x2 - s.x) * 2; it.h = (y2 - s.y) * 2;
      } else { it.x = s.x; it.y = s.y; it.w = x2 - s.x; it.h = y2 - s.y; }
      if (this.app.opts.general.snapGrid) {
        const g = 25;
        it.x = Math.round(it.x / g) * g; it.y = Math.round(it.y / g) * g;
        it.w = Math.round(it.w / g) * g; it.h = Math.round(it.h / g) * g;
      }
      it._b = null;
      this.app.requestDrawLive();
    }
    up() {
      const it = this.item; this.item = null;
      this.app.renderer.clearLive();
      if (!it) return;
      if (Math.abs(it.w) < 3 && Math.abs(it.h) < 3) return;
      if (it.kind !== 'line' && it.kind !== 'arrow') {
        if (it.w < 0) { it.x += it.w; it.w = -it.w; }
        if (it.h < 0) { it.y += it.h; it.h = -it.h; }
      }
      const scene = this.app.scene;
      scene.begin('shape'); scene.add(it); scene.commit();
      this.app.finishCreate(it);
      this.app.afterEdit();
    }
    cancel() { this.item = null; this.app.renderer.clearLive(); }
    paint(r) {
      if (!this.item) return;
      const ctx = r.liveWorld();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      r.drawItem(ctx, this.item);
    }
  }

  /* ══ node (decision-tree box) ═══════════════════════════════════ */
  class NodeTool {
    constructor(app) { this.app = app; }
    get opt() { return this.app.opts.node; }
    down(ev) {
      const o = this.opt;
      this.start = { x: ev.x, y: ev.y };
      this.item = mk.node({ kind: o.kind, x: ev.x, y: ev.y, w: 0, h: 0, color: o.color, fill: o.fill, size: o.size, textSize: o.textSize });
    }
    move(ev) {
      if (!this.item) return;
      const s = this.start, it = this.item;
      it.x = Math.min(s.x, ev.x); it.y = Math.min(s.y, ev.y);
      it.w = Math.abs(ev.x - s.x); it.h = Math.abs(ev.y - s.y);
      it._b = null;
      this.app.requestDrawLive();
    }
    up(ev) {
      const it = this.item; this.item = null;
      this.app.renderer.clearLive();
      if (!it) return;
      const o = this.opt;
      if (it.w < 20 || it.h < 20) {
        const w = o.kind === 'decision' ? 180 : 170, h = o.kind === 'decision' ? 110 : 68;
        it.x = this.start.x - w / 2; it.y = this.start.y - h / 2; it.w = w; it.h = h; it._b = null;
      }
      const scene = this.app.scene;
      scene.begin('node'); scene.add(it); scene.commit();
      this.app.select([it]);
      this.app.setTool('select');
      this.app.editor.open(it, { isNew: true });
      this.app.afterEdit();
    }
    cancel() { this.item = null; this.app.renderer.clearLive(); }
    paint(r) { if (this.item) r.drawItem(r.liveWorld(), this.item); }
  }

  /* ══ sticky note ════════════════════════════════════════════════ */
  class NoteTool {
    constructor(app) { this.app = app; }
    down(ev) { this.start = { x: ev.x, y: ev.y }; this.item = mk.note({ x: ev.x, y: ev.y, w: 0, h: 0, color: this.app.opts.note.color, size: this.app.opts.note.size }); }
    move(ev) {
      if (!this.item) return;
      const s = this.start, it = this.item;
      it.x = Math.min(s.x, ev.x); it.y = Math.min(s.y, ev.y);
      it.w = Math.abs(ev.x - s.x); it.h = Math.abs(ev.y - s.y); it._b = null;
      this.app.requestDrawLive();
    }
    up() {
      const it = this.item; this.item = null;
      this.app.renderer.clearLive();
      if (!it) return;
      if (it.w < 24 || it.h < 24) { it.w = it.h = 190; it.x = this.start.x - 95; it.y = this.start.y - 95; it._b = null; }
      const scene = this.app.scene;
      scene.begin('note'); scene.add(it); scene.commit();
      this.app.select([it]); this.app.setTool('select');
      this.app.editor.open(it, { isNew: true });
      this.app.afterEdit();
    }
    cancel() { this.item = null; this.app.renderer.clearLive(); }
    paint(r) { if (this.item) r.drawItem(r.liveWorld(), this.item); }
  }

  /* ══ text ═══════════════════════════════════════════════════════ */
  class TextTool {
    constructor(app) { this.app = app; }
    down(ev) { this.start = { x: ev.x, y: ev.y }; this.dragged = false; this.w = 0; }
    move(ev) { this.w = ev.x - this.start.x; if (Math.abs(this.w) > 12) { this.dragged = true; this.app.requestDrawLive(); } }
    up() {
      const app = this.app, o = app.opts.text;
      const it = mk.text({
        x: this.start.x, y: this.start.y, color: o.color, size: o.size, font: o.font,
        w: this.dragged ? Math.abs(this.w) : 40, autoWidth: !this.dragged, align: o.align
      });
      it.y -= it.size * 0.68;
      const scene = app.scene;
      scene.begin('text'); scene.add(it); scene.commit();
      app.renderer.clearLive();
      app.select([it]); app.setTool('select');
      app.editor.open(it, { isNew: true });
    }
    cancel() { this.app.renderer.clearLive(); }
    paint(r) {
      if (!this.dragged) return;
      const ctx = r.liveWorld();
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      ctx.lineWidth = 1 / this.app.camera.zoom;
      ctx.strokeRect(this.start.x, this.start.y - 4, this.w, this.app.opts.text.size * 1.4);
    }
  }

  /* ══ connector ══════════════════════════════════════════════════ */
  class ConnectorTool {
    constructor(app) { this.app = app; }
    down(ev) {
      const app = this.app, o = app.opts.edge;
      const host = app.scene.hitNode(ev.x, ev.y);
      this.item = mk.edge({
        from: host ? { id: host.id } : { x: ev.x, y: ev.y },
        to: { x: ev.x, y: ev.y },
        color: o.color, size: o.size, style: o.style, dash: o.dash, arrowEnd: o.arrowEnd, arrowStart: o.arrowStart
      });
    }
    move(ev) {
      if (!this.item) return;
      const host = this.app.scene.hitNode(ev.x, ev.y);
      this.hover = host && (!this.item.from.id || host.id !== this.item.from.id) ? host : null;
      this.item.to = this.hover ? { id: this.hover.id } : { x: ev.x, y: ev.y };
      this.item._b = null;
      this.app.requestDrawLive();
    }
    up(ev) {
      const it = this.item; this.item = null;
      this.app.renderer.clearLive();
      if (!it) return;
      const p = this.app.scene.edgePath(it);
      if (U.dist(p[0], p[1], p[p.length - 2], p[p.length - 1]) < 12) return;
      const scene = this.app.scene;
      scene.begin('connector'); scene.add(it, 0); scene.commit();
      this.app.finishCreate(it);
      this.app.afterEdit();
    }
    cancel() { this.item = null; this.app.renderer.clearLive(); }
    paint(r) {
      if (!this.item) return;
      const ctx = r.liveWorld();
      r.drawItem(ctx, this.item);
      if (this.hover) {
        const b = this.app.scene.bbox(this.hover);
        const c = r.liveScreen(), cam = this.app.camera;
        const a = cam.toScreen(b.x, b.y), d = cam.toScreen(b.x2, b.y2);
        c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        c.lineWidth = 2; c.strokeRect(a.x - 3, a.y - 3, d.x - a.x + 6, d.y - a.y + 6);
      }
    }
  }

  /* ══ laser pointer ══════════════════════════════════════════════ */
  class LaserTool {
    constructor(app) { this.app = app; this.trail = []; }
    down(ev) { this.trail.push({ x: ev.x, y: ev.y, t: performance.now() }); this.app.startAnim(); }
    move(ev) { for (const s of ev.samples) this.trail.push({ x: s.x, y: s.y, t: performance.now() }); }
    up() { }
    cancel() { this.trail.length = 0; }
    paint(r) {
      const now = performance.now(), life = 900;
      this.trail = this.trail.filter(p => now - p.t < life);
      if (!this.trail.length) { this.app.stopAnim(); return; }
      const ctx = r.liveWorld();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1], b = this.trail[i];
        const k = 1 - (now - b.t) / life;
        ctx.globalAlpha = k;
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = (10 * k + 2) / this.app.camera.zoom;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      const last = this.trail[this.trail.length - 1];
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(last.x, last.y, 3 / this.app.camera.zoom, 0, 6.284); ctx.fill();
      this.app.startAnim();
    }
  }

  /* ══ pan ════════════════════════════════════════════════════════ */
  class PanTool {
    constructor(app) { this.app = app; }
    down(ev) { this.last = { x: ev.sx, y: ev.sy }; document.body.classList.add('grabbing'); }
    move(ev) {
      if (!this.last) return;
      this.app.camera.panBy(ev.sx - this.last.x, ev.sy - this.last.y);
      this.last = { x: ev.sx, y: ev.sy };
      this.app.requestDraw();
    }
    up() { this.last = null; document.body.classList.remove('grabbing'); this.app.saveView(); }
    cancel() { this.last = null; document.body.classList.remove('grabbing'); }
    paint() { }
  }

  /* ══ select / transform ═════════════════════════════════════════ */
  class SelectTool {
    constructor(app, lasso) { this.app = app; this.lasso = lasso; }

    down(ev) {
      const app = this.app, scene = app.scene;
      this.mode = null;
      this.start = { x: ev.x, y: ev.y, sx: ev.sx, sy: ev.sy };

      // 1 · resize handle?
      if (app.selection.length && app.selBox) {
        for (const h of app.renderer.handleRects(app.selBox)) {
          if (ev.sx >= h.x - 3 && ev.sx <= h.x + h.w + 3 && ev.sy >= h.y - 3 && ev.sy <= h.y + h.h + 3) {
            this.mode = 'resize'; this.handle = h.k;
            this.origBox = app.selectionBounds();
            scene.begin('resize');
            for (const it of app.selection) scene.touch(it);
            this.snapshot = app.selection.map(it => D.clone(it));
            return;
          }
        }
      }

      // 2 · edge endpoint drag
      if (app.selection.length === 1 && app.selection[0].type === 'edge') {
        const e = app.selection[0], p = scene.edgePath(e), tol = 10 / app.camera.zoom;
        if (U.dist(ev.x, ev.y, p[0], p[1]) < tol) { this.mode = 'endpoint'; this.end = 'from'; scene.begin('edge'); scene.touch(e); return; }
        if (U.dist(ev.x, ev.y, p[p.length - 2], p[p.length - 1]) < tol) { this.mode = 'endpoint'; this.end = 'to'; scene.begin('edge'); scene.touch(e); return; }
      }

      // 3 · item under the pointer
      let hit = scene.hitTest(ev.x, ev.y, 8 / app.camera.zoom);

      /* A PDF page or a picture is the thing you write on, and it is hit
         by its whole area, so a press in the gaps between your notes used
         to grab the page and drag it out from under them. Now, unless it
         is already selected, it has to be asked for. Anything drawn on it
         within easy reach of the nib wins outright; otherwise a quick
         drag draws a marquee over it — the way to gather up the notes —
         a tap selects it, and press-and-hold picks it up to move. */
      if (D.backdrop(hit) && !app.selection.includes(hit)) {
        const over = scene.hitTest(ev.x, ev.y, GRAB_TOL / app.camera.zoom, it => !D.backdrop(it) && it._z > hit._z);
        if (over) hit = over;
        else {
          this.mode = 'pending';
          this.pending = hit;
          this.shift = ev.shift;
          this.alt = ev.alt;
          clearTimeout(this.holdTimer);
          this.holdTimer = setTimeout(() => this.pickUp(), PICKUP_MS);
          return;
        }
      }

      if (hit) {
        const group = hit.group ? scene.items.filter(i => i.group === hit.group) : [hit];
        if (ev.shift) {
          const has = app.selection.includes(hit);
          app.select(has ? app.selection.filter(i => !group.includes(i)) : [...app.selection, ...group]);
        } else if (!app.selection.includes(hit)) app.select(group);
        this.mode = 'move';
        this.moved = false;
        this.alt = ev.alt;
        scene.begin('move');
        return;
      }

      // 4 · marquee
      this.mode = this.lasso ? 'lasso' : 'marquee';
      this.poly = [ev.x, ev.y];
      if (!ev.shift) app.select([]);
      this.baseSel = ev.shift ? app.selection.slice() : [];
    }

    /** the press on a page or picture was held: it is what you meant to move */
    pickUp() {
      if (this.mode !== 'pending') return;
      const app = this.app, scene = app.scene, hit = this.pending;
      this.pending = null;
      const group = this.groupOf(hit);
      app.select(this.shift ? [...app.selection, ...group.filter(i => !app.selection.includes(i))] : group);
      this.mode = 'move';
      this.moved = false;
      scene.begin('move');
    }

    groupOf(hit) { return hit.group ? this.app.scene.items.filter(i => i.group === hit.group) : [hit]; }

    move(ev) {
      const app = this.app, scene = app.scene;
      if (!this.mode) return;
      if (this.mode === 'pending') {
        if (Math.hypot(ev.sx - this.start.sx, ev.sy - this.start.sy) < PICKUP_SLOP) return;
        // moved off before the hold: a marquee over the page, not the page
        clearTimeout(this.holdTimer);
        this.pending = null;
        this.mode = this.lasso ? 'lasso' : 'marquee';
        this.poly = [this.start.x, this.start.y];
        if (!this.shift) app.select([], true);
        this.baseSel = this.shift ? app.selection.slice() : [];
        tipOnce('backdrop', () => app.toast('Dragging over a page selects what is on it — press and hold to move the page itself'));
      }
      if (this.mode === 'move') {
        let dx = ev.x - this.start.x, dy = ev.y - this.start.y;
        if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (!this.moved) {
          if (Math.hypot(ev.sx - this.start.sx, ev.sy - this.start.sy) < 3) return;
          this.moved = true;
          if (this.alt) {                                   // Alt-drag duplicates
            const { copies } = D.cloneSet(app.selection);
            for (const c of copies) scene.add(c);
            app.select(copies);
          }
          this.origin = app.selection.map(it => D.clone(it));
        }
        // re-apply from the original positions so the drag never drifts
        app.selection.forEach((it, i) => {
          const o = this.origin[i];
          scene.touch(it);
          if (it.type === 'stroke') { for (let k = 0; k < it.pts.length; k += 3) { it.pts[k] = o.pts[k] + dx; it.pts[k + 1] = o.pts[k + 1] + dy; } }
          else if (it.type === 'edge') {
            if (!it.from.id) { it.from.x = o.from.x + dx; it.from.y = o.from.y + dy; }
            if (!it.to.id) { it.to.x = o.to.x + dx; it.to.y = o.to.y + dy; }
          } else {
            let nx = o.x + dx, ny = o.y + dy;
            if (app.opts.general.snapGrid) { const g = 25; nx = Math.round(nx / g) * g; ny = Math.round(ny / g) * g; }
            it.x = nx; it.y = ny;
          }
        });
        app.requestDraw();
      }
      else if (this.mode === 'resize') {
        const b = this.origBox, h = this.handle;
        let sx = 1, sy = 1;
        const ox = { x: b.x, y: b.y };
        if (h.includes('e')) { sx = (ev.x - b.x) / (b.w || 1); ox.x = b.x; }
        if (h.includes('w')) { sx = (b.x2 - ev.x) / (b.w || 1); ox.x = b.x2; }
        if (h.includes('s')) { sy = (ev.y - b.y) / (b.h || 1); ox.y = b.y; }
        if (h.includes('n')) { sy = (b.y2 - ev.y) / (b.h || 1); ox.y = b.y2; }
        if (h === 'n' || h === 's') sx = 1;
        if (h === 'e' || h === 'w') sy = 1;
        if (ev.shift || h.length === 2) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
        sx = Math.abs(sx) < 0.02 ? 0.02 * Math.sign(sx || 1) : sx;
        sy = Math.abs(sy) < 0.02 ? 0.02 * Math.sign(sy || 1) : sy;
        app.selection.forEach((it, i) => {
          const src = this.snapshot[i];
          for (const k in src) if (k[0] !== '_') it[k] = D.clone(src)[k];
          scene.scaleItem(it, ox, sx, sy);
        });
        app.requestDraw();
      }
      else if (this.mode === 'endpoint') {
        const e = app.selection[0];
        const host = scene.hitNode(ev.x, ev.y);
        e[this.end] = host ? { id: host.id } : { x: ev.x, y: ev.y };
        e._b = null;
        app.requestDraw();
      }
      else {
        this.poly.push(ev.x, ev.y);
        const sel = this.mode === 'lasso'
          ? scene.itemsInLasso(this.poly)
          : scene.itemsInBox(U.box(this.start.x, this.start.y, ev.x, ev.y), !ev.ctrl);
        app.select([...new Set([...this.baseSel, ...sel])], true);
        app.requestDrawLive();
      }
    }

    up() {
      const app = this.app;
      if (this.mode === 'pending') {
        // a tap on a page or picture selects it; the next drag then moves it
        clearTimeout(this.holdTimer);
        const group = this.groupOf(this.pending);
        this.pending = null;
        this.mode = null;
        if (!this.shift) app.select(group);
        else {
          const has = app.selection.includes(group[0]);
          app.select(has ? app.selection.filter(i => !group.includes(i)) : [...app.selection, ...group]);
        }
      }
      if (this.mode === 'move' && !this.moved) app.scene.cancel();
      else if (this.mode) app.scene.commit();
      if (this.mode === 'marquee' || this.mode === 'lasso') { this.poly = null; app.renderer.clearLive(); }
      this.mode = null;
      app.requestDrawLive();
      app.afterEdit();
    }
    cancel() { clearTimeout(this.holdTimer); this.mode = null; this.pending = null; this.poly = null; this.app.scene.cancel(); }

    paint(r) {
      if (this.mode === 'marquee') {
        const ctx = r.liveScreen(), cam = this.app.camera;
        const a = cam.toScreen(this.start.x, this.start.y);
        const p = this.app.pointer;
        ctx.save();
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim();
        ctx.lineWidth = 1;
        ctx.fillRect(a.x, a.y, p.sx - a.x, p.sy - a.y);
        ctx.strokeRect(a.x, a.y, p.sx - a.x, p.sy - a.y);
        ctx.restore();
      } else if (this.mode === 'lasso' && this.poly) {
        const ctx = r.liveWorld();
        ctx.save();
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        ctx.setLineDash([6 / this.app.camera.zoom, 4 / this.app.camera.zoom]);
        ctx.lineWidth = 1.4 / this.app.camera.zoom;
        ctx.beginPath(); ctx.moveTo(this.poly[0], this.poly[1]);
        for (let i = 2; i < this.poly.length; i += 2) ctx.lineTo(this.poly[i], this.poly[i + 1]);
        ctx.closePath(); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** run `fn` the first time only, on this machine — for one-off tips */
  function tipOnce(key, fn) {
    try {
      if (localStorage.getItem('dpo:tip:' + key)) return;
      localStorage.setItem('dpo:tip:' + key, '1');
    } catch (_) { return; }
    fn();
  }

  D.tools = { PenTool, EraserTool, ShapeTool, NodeTool, NoteTool, TextTool, ConnectorTool, LaserTool, PanTool, SelectTool };
  D.splitStroke = splitStroke;

})(window.DPO);

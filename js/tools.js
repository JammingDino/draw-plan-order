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
      // the Smoothing setting pulls harder while the pen is slow, where a shaky hand shows
      const amount = FH.liveAmount(this.opt.smooth || 0, n >= 3 ? U.dist(this.raw[n - 3], this.raw[n - 2], ev.x, ev.y) * this.app.camera.zoom : 0);
      if (this.raw.length <= 6) { this.sm = null; this.item.pts = this.raw.slice(); }
      else if (!this.sm || this.sm.length + 3 !== this.raw.length) this.item.pts = this.sm = FH.smooth(this.raw, amount);
      else this.item.pts = FH.smoothStep(this.raw, this.sm, amount);
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
      /* A bar shorter than a fingertip held still at its end is far more
         often half of a handwritten "=" or a minus, written slowly, than
         a line someone wants. Snapped, it would leave the ink for a shape
         and never pair with the other bar (see inkmath.js). */
      if (shape.kind === 'line' && Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) * this.app.camera.zoom < 30) return;
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
      // the stroke's ink stays until the scene showing it is on screen
      app.renderer.retireInk();
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
            scene.removeMany(hit);
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
      /* Steadied once the pen lifts: the live filter can only look back,
         this looks both ways, and finishes where the pen actually stopped. */
      if (o.smooth > 0 && this.raw.length >= 15) {
        const pts = FH.relax(this.raw, (1.5 + o.smooth * FH.RELAX_PX) / app.camera.zoom);
        item.pts = pts; item._path = null; item._lod = null; item._b = null;
      }
      scene.begin('draw'); scene.add(item); scene.commit();
      app.afterEdit();
      if (this.kind === 'pen') D.ext.emit('stroke', app, item);
    }

    cancel() {
      clearTimeout(this.holdTimer); this.item = null;
      this.app.renderer.clearLive(); this.app.renderer.clearInk(); this.app.hideHint();
    }

    /* An opaque pen stroke is added to the ink layer a piece at a time and
       never cleared while the pen is down (see Renderer.inkWorld). A see-
       through stroke (the highlighter) is drawn whole each frame on the
       live layer instead, as is a stroke snapped to a shape — and the ink
       it had laid down is retired, not wiped, so it does not blink. */
    paint(r) {
      if (!this.item) return;
      if (this.snapped) {
        r.retireInk();
        r.clearLive();
        const ctx = r.liveWorld();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        r.drawItem(ctx, shapeFromRecognised(this.snapped, this.opt));
        return;
      }
      if (this.incremental) {
        const ctx = r.inkWorld();
        ctx.globalAlpha = this.item.alpha;
        ctx.globalCompositeOperation = r.blendFor(this.item);
        ctx.fillStyle = U.color(this.item.color);      // 'ink' follows the theme
        const pts = this.item.pts;
        const from = Math.max(0, this.lastDrawn - 4);      // overlap so tails join seamlessly
        const tail = pts.slice(from * 3);
        if (tail.length >= 3) {
          const poly = FH.shapes(tail, { size: this.item.size, thinning: this.item.thinning });
          ctx.fill(FH.path(poly));
        }
        this.lastDrawn = pts.length / 3;
      } else {
        if (this.lastDrawn) { r.retireInk(); this.lastDrawn = 0; }
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
      this.done = 0;                          // how much of the path has been applied
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
    /* Only the part of the path since the last call is new: everything
       the earlier part crossed has already been taken. That part is the
       new samples plus the point before them, so it joins on. It used to
       be the last four points, which a fast pen can outrun — several
       coalesced samples arrive per move — leaving ink untouched between
       them; and the pixel eraser cut each stroke against the whole path
       so far, so a long rub got slower the longer it went on. */
    erase() {
      const app = this.app, scene = app.scene;
      const rad = this.opt.size / 2;          // in world units, like the pen
      const seg = this.path.slice(Math.max(0, this.done - 2));
      this.done = this.path.length;
      const hits = scene.itemsCrossing(seg, rad, D.erasable);
      if (!hits.length) return;
      if (this.opt.mode === 'partial') {
        for (const it of hits) {
          if (it.type !== 'stroke') { scene.remove(it); continue; }
          const parts = splitStroke(it, seg, rad);
          if (parts === null) continue;
          const idx = scene.indexOf(it);
          scene.remove(it);
          for (const p of parts) scene.add(p, idx);
        }
      } else scene.removeMany(hits);
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
  /* The kinds the shape tool draws as a stroke between points rather than
     as a box: line, arrow, the force preset (a heavy arrow) and polyline.
     All of them become kind 'line' or 'arrow' shapes. */
  const LINE_KINDS = { line: 1, arrow: 1, force: 1, polyline: 1 };

  /* Snapping (js/cad.js), when it is loaded: object points, the grid and
     15° steps. Shift still forces the 15° steps, for a keyboard; the style
     panel has the same switch for a pen. Without cad.js, the grid. */
  function snapTo(app, ev, o = {}) {
    if (D.cad) return D.cad.snap(app, ev.x, ev.y, { ...o, force15: ev.shift || o.force15 });
    let x = ev.x, y = ev.y;
    if (o.from && ev.shift) [x, y] = RG.snapAngle(o.from.x, o.from.y, x, y, 23);
    if (app.opts.general.snapGrid) { x = Math.round(x / 25) * 25; y = Math.round(y / 25) * 25; }
    return { x, y, t: null };
  }

  /** the heads, weight and kind a new line gets from the tool's options */
  function lineStyle(o, kind) {
    const heads = (o.heads && o.heads[kind]) || (kind === 'line' ? ['none', 'none'] : ['none', 'filled']);
    const force = kind === 'force';
    return {
      kind: kind === 'arrow' || force || (kind === 'polyline' && heads[1] !== 'none') ? 'arrow' : 'line',
      head1: heads[0], head2: heads[1],
      size: force ? Math.max(4, Math.round(o.size * 1.6)) : o.size,
      headScale: force ? 1.15 * (o.headScale || 1) : o.headScale || 1
    };
  }

  class ShapeTool {
    constructor(app) { this.app = app; this.poly = null; }
    get opt() { return this.app.opts.shape; }
    get cad() { return this.app.opts.cad || {}; }

    down(ev) {
      const o = this.opt;
      if (o.kind === 'polyline') return this.polyDown(ev);
      const lineish = LINE_KINDS[o.kind];
      const s = snapTo(this.app, ev);
      this.start = s;
      this.snapNow = s;
      this.moved = false;
      const base = { x: s.x, y: s.y, w: 0, h: 0, color: o.color, size: o.size, alpha: o.alpha, dash: o.dash };
      if (lineish) this.item = mk.shape({ ...base, ...lineStyle(o, o.kind), fill: 'none' });
      else if (o.kind === 'moment') this.item = mk.shape({ ...base, kind: 'moment', fill: 'none', head1: 'none', head2: 'filled', headScale: o.headScale || 1, a0: 0, sweep: o.ccw === false ? -270 : 270 });
      else this.item = mk.shape({ ...base, kind: o.kind, fill: o.fill, radius: o.radius });
      if (lineish && s.ref) this.item.bind1 = s.ref;
      this.app.requestDrawLive();
    }

    move(ev) {
      if (this.poly) return this.polyMove(ev);
      if (!this.item) return;
      const it = this.item, s = this.start, cad = this.cad;
      if (Math.hypot(ev.x - s.x, ev.y - s.y) * this.app.camera.zoom > 3) this.moved = true;
      if (LINE_KINDS[this.opt.kind]) {
        const e = this.snapNow = snapTo(this.app, ev, { from: s, force15: cad.ortho });
        it.w = e.x - s.x; it.h = e.y - s.y;
      } else if (it.kind === 'moment') {
        const e = this.snapNow = snapTo(this.app, ev, { from: s });
        const r = Math.hypot(e.x - s.x, e.y - s.y);
        it.x = s.x - r; it.y = s.y - r; it.w = it.h = r * 2;
        // the head lands where you let go, the arc running back round from there
        const at = Math.atan2(s.y - e.y, e.x - s.x) * 180 / Math.PI;
        it.a0 = at - (it.sweep ?? 270);
      } else {
        const e = this.snapNow = snapTo(this.app, ev);
        let x2 = e.x, y2 = e.y;
        if (ev.shift || cad.square) { const d = Math.max(Math.abs(x2 - s.x), Math.abs(y2 - s.y)); x2 = s.x + Math.sign(x2 - s.x || 1) * d; y2 = s.y + Math.sign(y2 - s.y || 1) * d; }
        if (ev.alt || cad.centre) {
          it.x = s.x - (x2 - s.x); it.y = s.y - (y2 - s.y);
          it.w = (x2 - s.x) * 2; it.h = (y2 - s.y) * 2;
        } else { it.x = s.x; it.y = s.y; it.w = x2 - s.x; it.h = y2 - s.y; }
      }
      it._b = null;
      this.app.requestDrawLive();
    }

    up() {
      if (this.poly) return this.polyUp();
      const it = this.item; this.item = null;
      const end = this.snapNow;
      this.snapNow = null;
      this.app.renderer.clearLive();
      if (!it) return;
      if (Math.abs(it.w) < 3 && Math.abs(it.h) < 3) return;
      if (D.isLine(it)) { if (end && end.ref && !sameEnd(it.bind1, end.ref)) it.bind2 = end.ref; }
      else if (it.kind !== 'moment') {
        if (it.w < 0) { it.x += it.w; it.w = -it.w; }
        if (it.h < 0) { it.y += it.h; it.h = -it.h; }
      }
      const scene = this.app.scene;
      scene.begin('shape'); scene.add(it); scene.commit();
      this.app.finishCreate(it);
      this.app.afterEdit();
    }

    /* ── polylines ──────────────────────────────────────────────────
       Built a point at a time, the way a pen wants to: press, drag the
       rubber band to where the corner goes, lift; again for the next
       corner. A tap on the last point (or Enter) finishes it, a tap
       anywhere else adds a corner there. Nothing is on the board until
       it is finished, so cancel() simply forgets it. */
    polyDown(ev) {
      const s = snapTo(this.app, ev, this.poly ? { from: this.lastPoint() } : {});
      if (!this.poly) {
        const o = this.opt;
        this.poly = { pts: [s.x, s.y], refs: [s.ref || null], item: mk.shape({ x: s.x, y: s.y, w: 0, h: 0, color: o.color, size: o.size, alpha: o.alpha, dash: o.dash, fill: 'none', ...lineStyle(o, 'polyline') }) };
        this.poly.fresh = true;
        this.app.hint(ev.sx, ev.sy, 'Lift for a corner · tap the last point to finish');
      } else this.poly.fresh = false;
      this.poly.down = { sx: ev.sx, sy: ev.sy };
      this.snapNow = s;
      this.app.requestDrawLive();
    }
    polyMove(ev) {
      this.snapNow = snapTo(this.app, ev, { from: this.lastPoint(), force15: this.cad.ortho });
      this.app.requestDrawLive();
    }
    polyUp() {
      const P = this.poly, s = this.snapNow, app = this.app;
      if (!P || !s) return;
      const last = this.lastPoint();
      const tol = (app.coarse ? 22 : 12) / app.camera.zoom;
      const tap = !P.down || Math.hypot(app.pointer.sx - P.down.sx, app.pointer.sy - P.down.sy) < 6;
      if (U.dist(s.x, s.y, last.x, last.y) < tol) {
        // back on the last point: a tap there finishes, unless it was the very first press
        if (!(P.fresh && tap)) this.finishPoly();
        return;
      }
      P.pts.push(s.x, s.y); P.refs.push(s.ref || null);
      app.hideHint();
      app.requestDrawLive();
    }
    lastPoint() { const p = this.poly.pts; return { x: p[p.length - 2], y: p[p.length - 1] }; }

    /** put the polyline on the board as it stands; false if it is too short to keep */
    finishPoly() {
      const P = this.poly, app = this.app;
      this.poly = null; this.snapNow = null;
      app.hideHint();
      app.renderer.clearLive();
      if (!P || P.pts.length < 4) { app.requestDrawLive(); return false; }
      const it = P.item, p = P.pts, n = p.length;
      it.x = p[0]; it.y = p[1]; it.w = p[n - 2] - p[0]; it.h = p[n - 1] - p[1];
      if (n > 4) it.via = p.slice(2, n - 2);
      if (P.refs[0]) it.bind1 = P.refs[0];
      if (P.refs[P.refs.length - 1] && !sameEnd(it.bind1, P.refs[P.refs.length - 1])) it.bind2 = P.refs[P.refs.length - 1];
      app.scene.begin('polyline'); app.scene.add(it); app.scene.commit();
      app.finishCreate(it);
      app.afterEdit();
      return true;
    }

    cancel() {
      this.item = null; this.poly = null; this.snapNow = null;
      this.app.hideHint();
      this.app.renderer.clearLive();
    }

    /** the polyline being built, with its rubber band out to the pen */
    polyPreview() {
      const P = this.poly, p = P.pts.slice(), s = this.snapNow;
      if (s && (p[p.length - 2] !== s.x || p[p.length - 1] !== s.y)) p.push(s.x, s.y);
      const it = { ...P.item, x: p[0], y: p[1], w: p[p.length - 2] - p[0], h: p[p.length - 1] - p[1] };
      if (p.length > 4) it.via = p.slice(2, -2);
      return it;
    }

    paint(r) {
      const app = this.app;
      if (this.poly) {
        const ctx = r.liveWorld();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // with a pen hovering, the band follows it between presses
        if (!app.active && app.pointer && D.cad) this.snapNow = snapTo(app, app.pointer, { from: this.lastPoint(), force15: this.cad.ortho });
        const it = this.polyPreview();
        if (it.via || it.w || it.h) r.drawItem(ctx, it);
        if (D.cad) {
          const p = this.poly.pts;
          D.cad.paintVertices(r, p);
          D.cad.paintSnap(r, this.snapNow, this.lastPoint());
          const s = this.snapNow, last = this.lastPoint();
          if (s) D.cad.paintReadout(r, app.pointer, D.cad.lineReadout(app.scene, last, s, U.pathLength(p) + U.dist(last.x, last.y, s.x, s.y)));
        }
        return;
      }
      if (!this.item) {
        // hovering: show where a press would land
        if (D.cad && app.pointer && !app.active) D.cad.paintSnap(r, D.cad.snap(app, app.pointer.x, app.pointer.y, {}));
        return;
      }
      const ctx = r.liveWorld();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      r.drawItem(ctx, this.item);
      if (!D.cad) return;
      const it = this.item;
      D.cad.paintSnap(r, this.snapNow, D.isLine(it) ? this.start : null);
      if (!this.moved) return;
      const scene = app.scene;
      if (D.isLine(it)) D.cad.paintReadout(r, app.pointer, D.cad.lineReadout(scene, this.start, { x: it.x + it.w, y: it.y + it.h }));
      else if (it.kind === 'moment') D.cad.paintReadout(r, app.pointer, ['R ' + D.cad.fmtLen(scene, it.w / 2)]);
      else D.cad.paintReadout(r, app.pointer, D.cad.boxReadout(scene, Math.abs(it.w), Math.abs(it.h), it.kind));
    }
  }

  /** do two attachments point at the same place? (a line from a point to itself is not worth binding twice) */
  function sameEnd(a, b) {
    return !!a && !!b && a.id === b.id && a.k === b.k && a.u === b.u && a.v === b.v && a.t === b.t && a.a === b.a;
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
      this.app.panScreen(ev.sx - this.last.x, ev.sy - this.last.y);
      this.last = { x: ev.sx, y: ev.sy };
    }
    up() { this.last = null; document.body.classList.remove('grabbing'); this.app.saveView(); }
    cancel() { this.last = null; document.body.classList.remove('grabbing'); }
    paint() { }
  }

  /* ══ select / transform ═════════════════════════════════════════ */
  class SelectTool {
    constructor(app, lasso) { this.app = app; this.lasso = lasso; }

    /* screen px a press may miss by: more under a finger or a pen (app.coarse) */
    slop(px, coarsePx) { return (this.app.coarse ? coarsePx : px) / this.app.camera.zoom; }

    /* How near a press must land, by what pressed (App.hitPx/handlePad,
       touch 16 / pen 10 / mouse 8, and 12 / 6 / 3 more for a handle). App
       routes a finger here on the same numbers, so they must agree. */
    hitPx(ev) { const a = this.app; return a.hitPx ? a.hitPx(ev.pointerType) : (a.coarse ? 14 : 8); }
    handlePad(ev) { const a = this.app; return a.handlePad ? a.handlePad(ev.pointerType) : 3; }

    down(ev) {
      const app = this.app, scene = app.scene;
      this.mode = null;
      this.lifted = false;
      this.start = { x: ev.x, y: ev.y, sx: ev.sx, sy: ev.sy };
      if (this.handleAt(ev)) return;

      // 3 · item under the pointer
      let hit = scene.hitTest(ev.x, ev.y, this.hitPx(ev) / app.camera.zoom);

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
        this.alt = ev.alt || !!(app.opts.cad && app.opts.cad.dupDrag);
        scene.begin('move');
        return;
      }

      // 4 · marquee
      this.area(ev.shift, false);
    }

    /* 0–2 · a handle of the selection, if the press is on one: the ends,
       corners and bend of a single line, the resize handles, the ends of
       a connector. Sets the mode and returns true if it took the press. */
    handleAt(ev) {
      const app = this.app, scene = app.scene;
      // 0 · a handle of a single selected line: an end, a corner, or the bend
      if (app.selection.length === 1 && app.selBox && app.selBox.line) {
        const reach = this.hitPx(ev) + this.handlePad(ev) + 2;
        let best = null, bd = reach;
        for (const h of app.selBox.line) {
          const d = Math.hypot(ev.sx - h.x, ev.sy - h.y);
          if (d < bd) { bd = d; best = h; }
        }
        if (best) {
          const it = app.selection[0];
          this.mode = 'line'; this.handle = best.k;
          scene.begin('edit line'); scene.touch(it);
          this.lineMoved = false;
          this.lineWas = D.clone(it);
          return true;
        }
      }

      // 1 · resize handle?
      if (app.selection.length && app.selBox) {
        for (const h of app.renderer.handleRects(app.selBox)) {
          const pad = this.handlePad(ev);
          if (ev.sx >= h.x - pad && ev.sx <= h.x + h.w + pad && ev.sy >= h.y - pad && ev.sy <= h.y + h.h + pad) {
            if (h.k === 'turn') {
              const f = app.selectionFrame ? app.selectionFrame() : null, b = app.selectionBounds();
              this.mode = 'turn';
              this.pivot = f ? { x: f.cx, y: f.cy } : U.boxCenter(b);
              this.rot0 = app.selRot || 0;
              this.turn0 = Math.atan2(ev.y - this.pivot.y, ev.x - this.pivot.x);
              this.turned = 0;
              scene.begin('turn');
              for (const it of app.selection) scene.touch(it);
              this.snapshot = app.selection.map(it => D.clone(it));
              return true;
            }
            this.mode = 'resize'; this.handle = h.k;
            this.origBox = app.selectionBounds();
            // a turned selection resizes along its own sides
            const f = app.selRot && app.selectionFrame ? app.selectionFrame() : null;
            this.frame = f && f.rot ? f : null;
            /* Measured from where the handle was pressed, not from the
               pointer itself: the handle sits a few px outside the box, and
               the box used to jump out to meet the pointer on the first move. */
            {
              const F = this.frame, k = h.k;
              const q = F ? D.turnPoints([ev.x, ev.y], F.cx, F.cy, -F.rot) : [ev.x, ev.y];
              const B = F ? U.box(F.cx - F.w / 2, F.cy - F.h / 2, F.cx + F.w / 2, F.cy + F.h / 2) : this.origBox;
              this.grabOff = {
                x: k.includes('e') ? B.x2 - q[0] : k.includes('w') ? B.x - q[0] : 0,
                y: k.includes('s') ? B.y2 - q[1] : k.includes('n') ? B.y - q[1] : 0
              };
            }
            scene.begin('resize');
            for (const it of app.selection) scene.touch(it);
            this.snapshot = app.selection.map(it => D.clone(it));
            return true;
          }
        }
      }

      // 2 · edge endpoint drag
      if (app.selection.length === 1 && app.selection[0].type === 'edge') {
        const e = app.selection[0], p = scene.edgePath(e), tol = (this.hitPx(ev) + 2) / app.camera.zoom;
        if (U.dist(ev.x, ev.y, p[0], p[1]) < tol) { this.mode = 'endpoint'; this.end = 'from'; scene.begin('edge'); scene.touch(e); return true; }
        if (U.dist(ev.x, ev.y, p[p.length - 2], p[p.length - 1]) < tol) { this.mode = 'endpoint'; this.end = 'to'; scene.begin('edge'); scene.touch(e); return true; }
      }
      return false;
    }

    /** start a marquee or lasso from this.start; `shift` adds to the selection */
    area(shift, quiet = true) {
      const app = this.app;
      this.mode = this.lasso ? 'lasso' : 'marquee';
      this.poly = [this.start.x, this.start.y];
      if (!shift) app.select([], quiet);
      this.baseSel = shift ? app.selection.slice() : [];
    }

    /**
     * A marquee or lasso from (ev.x, ev.y), whatever is there — for a
     * press that was held and then dragged (App.dragFromHold). The point
     * is where the press first landed, not where the drag began, so the
     * box or loop takes in what the pen was held over.
     */
    areaFrom(ev) {
      this.lifted = false;
      this.start = { x: ev.x, y: ev.y, sx: ev.sx, sy: ev.sy };
      this.area(false);
    }

    /**
     * Take hold of the selection that is already there, under a tool that
     * is not this one (App.onDown): a handle if the press is on one,
     * otherwise all of it, to move — wherever inside its box the press
     * landed, gaps between strokes included, and without first selecting
     * what is under the press as down() would.
     */
    grab(ev) {
      const app = this.app;
      this.mode = null;
      this.lifted = false;
      this.start = { x: ev.x, y: ev.y, sx: ev.sx, sy: ev.sy };
      if (this.handleAt(ev)) return;
      this.mode = 'move';
      this.moved = false;
      this.alt = ev.alt || !!(app.opts.cad && app.opts.cad.dupDrag);
      app.scene.begin('move');
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
        this.area(this.shift);
        tipOnce('backdrop', () => app.toast('Dragging over a page selects what is on it — press and hold to move the page itself'));
      }
      if (this.mode === 'line') return this.moveLine(ev);
      if (this.mode === 'move') {
        let dx = ev.x - this.start.x, dy = ev.y - this.start.y;
        if (ev.shift || (app.opts.cad && app.opts.cad.axisDrag)) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (!this.moved) {
          if (Math.hypot(ev.sx - this.start.sx, ev.sy - this.start.sy) < 3) return;
          this.moved = true;
          if (this.alt) {                                   // Alt-drag duplicates
            const { copies } = D.cloneSet(app.selection);
            for (const c of copies) scene.add(c);
            app.select(copies);
          }
          this.origin = app.selection.map(it => D.clone(it));
          /* What is moving, by id: an attachment to one of these comes
             along, and one to anything else is let go (or, for a
             dimension, moves its line instead — see cad.js). */
          this.moving = new Set(app.selection.map(it => it.id));
          this.lifted = app.renderer.liftBegin(app.selection);
        }
        if (this.lifted && app.renderer.lift) { app.renderer.lift.dx = dx; app.renderer.lift.dy = dy; }
        // re-apply from the original positions so the drag never drifts
        app.selection.forEach((it, i) => {
          const o = this.origin[i];
          scene.touchMoved(it);
          if (it.type === 'stroke') { for (let k = 0; k < it.pts.length; k += 3) { it.pts[k] = o.pts[k] + dx; it.pts[k + 1] = o.pts[k + 1] + dy; } }
          else if (it.type === 'edge') {
            if (!it.from.id) { it.from.x = o.from.x + dx; it.from.y = o.from.y + dy; }
            if (!it.to.id) { it.to.x = o.to.x + dx; it.to.y = o.to.y + dy; }
          } else if (D.ext.items[it.type] && D.ext.items[it.type].translate) {
            /* a registered type that moves itself: from where it started,
               like everything else here, and with its own caches dropped
               (touchMoved keeps them, which only strokes know how to use).
               It is also told what else is moving, for one that is
               attached to things. */
            const c = D.clone(o);
            for (const k in c) it[k] = c[k];
            it._path = null; it._lod = null; it._lines = null;
            D.ext.items[it.type].translate(it, dx, dy, this.moving);
          } else {
            let nx = o.x + dx, ny = o.y + dy;
            if (app.opts.general.snapGrid) { const g = 25; nx = Math.round(nx / g) * g; ny = Math.round(ny / g) * g; }
            it.x = nx; it.y = ny;
            if (o.via) it.via = o.via.map((v, k) => v + (k & 1 ? ny - o.y : nx - o.x));
            /* An arrow dragged away from what it is attached to lets go of
               it; one moving along with its target stays attached. */
            if (it.bind1 && !this.moving.has(it.bind1.id)) delete it.bind1;
            if (it.bind2 && !this.moving.has(it.bind2.id)) delete it.bind2;
          }
        });
        app.requestDraw();
      }
      else if (this.mode === 'resize') {
        const f = this.frame, h = this.handle;
        /* Square, in board units; turned, in the frame's own: the pointer
           turned back about its middle, against a box centred there. */
        let b = this.origBox, px = ev.x, py = ev.y;
        if (f) {
          const q = D.turnPoints([ev.x, ev.y], f.cx, f.cy, -f.rot);
          px = q[0]; py = q[1];
          b = U.box(f.cx - f.w / 2, f.cy - f.h / 2, f.cx + f.w / 2, f.cy + f.h / 2);
        }
        if (this.grabOff) { px += this.grabOff.x; py += this.grabOff.y; }
        let sx = 1, sy = 1;
        const ox = { x: b.x, y: b.y };
        if (h.includes('e')) { sx = (px - b.x) / (b.w || 1); ox.x = b.x; }
        if (h.includes('w')) { sx = (b.x2 - px) / (b.w || 1); ox.x = b.x2; }
        if (h.includes('s')) { sy = (py - b.y) / (b.h || 1); ox.y = b.y; }
        if (h.includes('n')) { sy = (b.y2 - py) / (b.h || 1); ox.y = b.y2; }
        if (h === 'n' || h === 's') sx = 1;
        if (h === 'e' || h === 'w') sy = 1;
        if (ev.shift || h.length === 2) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
        sx = Math.abs(sx) < 0.02 ? 0.02 * Math.sign(sx || 1) : sx;
        sy = Math.abs(sy) < 0.02 ? 0.02 * Math.sign(sy || 1) : sy;
        const piv = f ? { x: f.cx, y: f.cy } : null;
        app.selection.forEach((it, i) => {
          const src = this.snapshot[i];
          for (const k in src) if (k[0] !== '_') it[k] = D.clone(src)[k];
          if (!f) { scene.scaleItem(it, ox, sx, sy); return; }
          // turned square, scaled, turned back: a turned box at the frame's angle stays a box
          scene.rotateItem(it, piv, -f.rot);
          scene.scaleItem(it, ox, sx, sy);
          scene.rotateItem(it, piv, f.rot);
        });
        app.requestDraw();
      }
      else if (this.mode === 'turn') {
        /* Turned from where the handle was taken, re-applied from the
           snapshot each move. It settles on 15° steps when it comes near
           one — always with Shift — so square is easy to find. */
        let a = Math.atan2(ev.y - this.pivot.y, ev.x - this.pivot.x) - this.turn0;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        const step = Math.PI / 12, near = Math.round(a / step) * step;
        if (ev.shift || Math.abs(a - near) < 0.06) a = near;
        this.turned = a;
        app.selRot = Math.atan2(Math.sin(this.rot0 + a), Math.cos(this.rot0 + a));
        if (Math.abs(app.selRot) < 1e-9) app.selRot = 0;
        const moving = new Set(app.selection.map(i => i.id));
        app.selection.forEach((it, i) => {
          const src = this.snapshot[i];
          for (const k in src) if (k[0] !== '_') it[k] = D.clone(src)[k];
          for (const k in it) if (k[0] !== '_' && !(k in src)) delete it[k];
          if (it.bind1 && !moving.has(it.bind1.id)) delete it.bind1;
          if (it.bind2 && !moving.has(it.bind2.id)) delete it.bind2;
          scene.rotateItem(it, this.pivot, a);
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

    /* ── a single line's handles ────────────────────────────────────
       An end snaps (to points on other things, the grid, 15° from the
       other end) and attaches to whatever it snapped to; a corner snaps
       the same way; the bend handle drags the curve's midpoint, and
       straightens the line again when it is brought back onto the chord. */
    moveLine(ev) {
      const app = this.app, scene = app.scene, it = app.selection[0], k = this.handle;
      if (!it) return;
      if (!this.lineMoved && Math.hypot(ev.sx - this.start.sx, ev.sy - this.start.sy) < 2) return;
      this.lineMoved = true;
      scene.touch(it);
      const [a, b] = scene.lineEnds(it);
      const skip = new Set([it.id]);
      if (k === 'p0' || k === 'p1') {
        const other = k === 'p0'
          ? (it.via ? { x: it.via[0], y: it.via[1] } : b)
          : (it.via ? { x: it.via[it.via.length - 2], y: it.via[it.via.length - 1] } : a);
        const s = this.lineSnap = snapTo(app, ev, { from: other, skip, force15: app.opts.cad && app.opts.cad.ortho });
        // an end may not attach to something that is itself attached to this line
        const ref = s.ref && !D.refsOf(scene.get(s.ref.id) || {}).some(r => r.id === it.id) ? s.ref : null;
        if (k === 'p0') {
          it.x = s.x; it.y = s.y; it.w = b.x - s.x; it.h = b.y - s.y;
          if (ref) it.bind1 = ref; else delete it.bind1;
        } else {
          it.x = a.x; it.y = a.y; it.w = s.x - a.x; it.h = s.y - a.y;
          if (ref) it.bind2 = ref; else delete it.bind2;
        }
      } else if (k === 'bend') {
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        if (!l2) return;
        const mx = ev.x - a.x, my = ev.y - a.y;
        const u = (mx * dx + my * dy) / l2, v = (mx * -dy + my * dx) / l2;
        const l = Math.sqrt(l2), tol = this.slop(10, 16);
        // close to straight: straight
        if (Math.abs(v) * l < tol && Math.abs(u - 0.5) * l < tol * 2) delete it.curve;
        else it.curve = [U.round(u, 4), U.round(v, 4)];
        this.lineSnap = null;
      } else if (k[0] === 'v') {
        const i = +k.slice(1) * 2, via = it.via.slice();
        const prev = i ? { x: via[i - 2], y: via[i - 1] } : a;
        const s = this.lineSnap = snapTo(app, ev, { from: prev, skip, force15: app.opts.cad && app.opts.cad.ortho });
        via[i] = s.x; via[i + 1] = s.y;
        it.via = via;
      }
      it._b = null;
      app.requestDraw();
    }

    up() {
      const app = this.app;
      if (this.mode === 'line') {
        this.mode = null; this.lineSnap = null;
        if (this.lineMoved) app.scene.commit(); else app.scene.cancel();
        app.requestDrawLive();
        app.afterEdit();
        return;
      }
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
      if (this.lifted) { app.renderer.liftEnd(); this.lifted = false; }
      if (this.mode === 'move' && !this.moved) app.scene.cancel();
      else if (this.mode) app.scene.commit();
      if (this.mode === 'marquee' || this.mode === 'lasso') { this.poly = null; app.renderer.clearLive(); }
      this.mode = null;
      app.requestDrawLive();
      app.afterEdit();
    }
    cancel() {
      clearTimeout(this.holdTimer);
      if (this.lifted) { this.app.renderer.liftEnd(); this.lifted = false; }
      /* A line half-dragged by a handle is put back as it was: cancel()
         must leave nothing behind, and the scene's step only records. */
      const it = this.app.selection[0];
      if (this.mode === 'line' && this.lineMoved && it && this.lineWas) {
        for (const k of Object.keys(it)) if (k[0] !== '_') delete it[k];
        Object.assign(it, D.clone(this.lineWas));
        this.app.scene.dirty(it);
        this.app.requestDraw();
      }
      this.mode = null; this.pending = null; this.poly = null; this.lineSnap = null; this.app.scene.cancel();
    }

    paint(r) {
      if (this.mode === 'turn' && D.cad) {
        // anticlockwise counts up, as every other angle on the board does
        const deg = -this.turned * 180 / Math.PI;
        D.cad.paintReadout(r, this.app.pointer, [(Math.round(deg * 10) / 10 || 0) + '°']);
        return;
      }
      if (this.mode === 'line') {
        const it = this.app.selection[0];
        if (!D.cad || !it || !this.lineMoved) return;
        D.cad.paintSnap(r, this.lineSnap);
        const [a, b] = this.app.scene.lineEnds(it);
        if (this.handle === 'bend') return;
        D.cad.paintReadout(r, this.app.pointer, it.via
          ? ['Total ' + D.cad.fmtLen(this.app.scene, U.pathLength(this.app.scene.linePath(it)))]
          : D.cad.lineReadout(this.app.scene, a, b));
        return;
      }
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
  D.snapTo = snapTo;
  D.splitStroke = splitStroke;

})(window.DPO);

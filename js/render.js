/* ── render.js ── canvas painting ───────────────────────────────────
   #base holds the committed scene, #live holds the in-flight stroke,
   marquees, selection handles and other transient chrome. Keeping the
   two apart means the pen never waits on a full scene redraw.        */
(function (D) {
  'use strict';
  const U = D.util, FH = D.freehand;

  const imgCache = new Map();

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
    drawScene() {
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
      for (const it of visible) this.drawItem(ctx, it);
    }

    /* The theme tokens the painter needs, read once per theme rather than
       once per frame: getComputedStyle forces a style recalc, and at the
       top of drawScene that lands on every pan, zoom and wheel tick. */
    tokens() {
      const th = document.documentElement.dataset.theme || '';
      if (this._tok && this._tok.theme === th) return this._tok;
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

    drawText(ctx, it) {
      const L = this.app.scene.layout(it);
      ctx.font = L.font;
      ctx.fillStyle = U.color(it.color);
      ctx.textBaseline = 'top';
      ctx.textAlign = it.align || 'left';
      const w = it.autoWidth ? L.width : it.w;
      const ax = it.align === 'center' ? it.x + w / 2 : it.align === 'right' ? it.x + w : it.x;
      L.lines.forEach((ln, i) => ctx.fillText(ln, ax, it.y + i * L.lh + (L.lh - it.size) / 2));
    }

    drawNote(ctx, it) {
      const p = new Path2D();
      p.roundRect(it.x, it.y, it.w, it.h, 6);
      ctx.save();
      ctx.shadowColor = '#0000002e'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
      ctx.fillStyle = U.color(it.color); ctx.fill(p);
      ctx.restore();
      const pad = 14;
      const t = { text: it.text, x: it.x + pad, y: it.y + pad, w: it.w - pad * 2, size: it.size, color: it.textColor || '#22252c', align: it.align, font: it.font };
      const L = this.app.scene.layout(t);
      ctx.font = L.font; ctx.fillStyle = U.color(t.color); ctx.textBaseline = 'top'; ctx.textAlign = t.align || 'left';
      const ax = t.align === 'center' ? t.x + t.w / 2 : t.align === 'right' ? t.x + t.w : t.x;
      L.lines.forEach((ln, i) => { if (t.y + (i + 1) * L.lh < it.y + it.h) ctx.fillText(ln, ax, t.y + i * L.lh); });
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
      if (!it.text) return;
      const pad = it.kind === 'decision' ? it.w * 0.2 : 12;
      const t = { text: it.text, x: it.x + pad, y: 0, w: it.w - pad * 2, size: it.textSize || 15, align: 'center', font: it.font };
      const L = this.app.scene.layout(t);
      ctx.font = L.font; ctx.fillStyle = U.color(it.textColor || it.color); ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      const top = it.y + (it.h - L.lines.length * L.lh) / 2;
      L.lines.forEach((ln, i) => ctx.fillText(ln, it.x + it.w / 2, top + i * L.lh + (L.lh - t.size) / 2));
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
      let img = imgCache.get(it.src);
      if (!img) {
        img = new Image();
        img.onload = () => this.app.requestDraw();
        img.src = it.src;
        imgCache.set(it.src, img);
      }
      if (img.complete && img.naturalWidth) ctx.drawImage(img, it.x, it.y, it.w, it.h);
      else { ctx.fillStyle = '#8884'; ctx.fillRect(it.x, it.y, it.w, it.h); }
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

      // ask for roughly one bitmap pixel per screen pixel, and no more
      const want = this.app.camera.zoom * this.dpr;
      const bmp = D.pdf.bitmap(this.app, it, want);
      if (bmp) ctx.drawImage(bmp, it.x, it.y, it.w, it.h);
      else {
        ctx.fillStyle = dark ? '#ffffff1f' : '#00000012';
        ctx.font = `${Math.max(11, it.w * 0.022)}px ${D.FONT_STACK}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${it.label || 'PDF'} · page ${it.page}`, it.x + it.w / 2, it.y + it.h / 2);
      }
      ctx.strokeStyle = dark ? '#ffffff1f' : '#0000001f';
      ctx.lineWidth = 1 / this.app.camera.zoom;
      ctx.strokeRect(it.x, it.y, it.w, it.h);
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

    /* ── SVG export ───────────────────────────────────────────────── */
    toSVG(scene, box) {
      const pad = 40;
      const b = U.growBox(box, pad);
      const out = [];
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff';
      out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(b.w)}" height="${Math.round(b.h)}" viewBox="${U.round(b.x)} ${U.round(b.y)} ${U.round(b.w)} ${U.round(b.h)}">`);
      out.push(`<rect x="${U.round(b.x)}" y="${U.round(b.y)}" width="${U.round(b.w)}" height="${U.round(b.h)}" fill="${bg}"/>`);
      for (const it of scene.items) out.push(svgItem(scene, it));
      out.push('</svg>');
      return out.join('\n');
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

  function svgItem(scene, it) {
    const a = it.alpha ?? 1;
    const op = a < 1 ? ` opacity="${a}"` : '';
    switch (it.type) {
      case 'stroke': {
        const poly = FH.shapes(it.pts, { size: it.size, thinning: it.thinning });
        return `<path d="${FH.svgPath(poly)}" fill="${U.color(it.color)}"${op}/>`;
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
        const top = it.y + (it.h - L.lines.length * L.lh) / 2 + L.lh * 0.75;
        const tx = L.lines.map((ln, i) => `<text x="${it.x + it.w / 2}" y="${top + i * L.lh}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${it.textSize || 15}" fill="${U.color(it.textColor || it.color)}">${U.escapeXml(ln)}</text>`).join('');
        return `<g${op}><path d="${d}" fill="${U.color(it.fill)}" stroke="${U.color(it.color)}" stroke-width="${it.size}"/>${tx}</g>`;
      }
      case 'text': return svgText(scene, it, op);
      case 'image': return `<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" href="${it.src}"${op}/>`;
      case 'pdfpage': {
        // whatever resolution the page is currently cached at, baked in
        const bmp = D.pdf.bitmap(D.app, it, 2);
        const href = bmp ? bitmapToDataUrl(bmp) : null;
        return href
          ? `<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" href="${href}"${op}/>`
          : `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="#fff" stroke="#0003"/>`;
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
    return `<g${op}>` + L.lines.map((ln, i) =>
      `<text x="${it.x}" y="${U.round(it.y + i * L.lh + it.size, 1)}" font-family="Segoe UI, sans-serif" font-size="${it.size}" fill="${U.color(it.color)}">${U.escapeXml(ln)}</text>`).join('') + '</g>';
  }

  D.Renderer = Renderer;
})(window.DPO);

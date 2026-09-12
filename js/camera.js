/* ── camera.js ── infinite-canvas viewport ───────────────────────────
   screen = world * zoom + offset                                      */
(function (D) {
  'use strict';
  const U = D.util;

  class Camera {
    constructor() { this.x = 0; this.y = 0; this.zoom = 1; this.min = 0.05; this.max = 24; }

    toWorld(sx, sy) { return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom }; }
    toScreen(wx, wy) { return { x: wx * this.zoom + this.x, y: wy * this.zoom + this.y }; }

    panBy(dx, dy) { this.x += dx; this.y += dy; }

    zoomTo(z, sx, sy) {
      z = U.clamp(z, this.min, this.max);
      const before = this.toWorld(sx, sy);
      this.zoom = z;
      const after = this.toWorld(sx, sy);
      this.x += (after.x - before.x) * this.zoom;
      this.y += (after.y - before.y) * this.zoom;
    }

    zoomBy(f, sx, sy) { this.zoomTo(this.zoom * f, sx, sy); }

    /** visible world rectangle */
    viewport(w, h, pad = 0) {
      const a = this.toWorld(-pad, -pad), b = this.toWorld(w + pad, h + pad);
      return U.box(a.x, a.y, b.x, b.y);
    }

    fit(box, vw, vh, pad = 90) {
      if (!box || !isFinite(box.w)) return;
      const z = U.clamp(Math.min((vw - pad * 2) / Math.max(box.w, 1), (vh - pad * 2) / Math.max(box.h, 1)), this.min, 2);
      this.zoom = z;
      this.x = vw / 2 - (box.x + box.w / 2) * z;
      this.y = vh / 2 - (box.y + box.h / 2) * z;
    }

    centerOn(x, y, vw, vh) { this.x = vw / 2 - x * this.zoom; this.y = vh / 2 - y * this.zoom; }

    toJSON() { return { x: this.x, y: this.y, zoom: this.zoom }; }
    load(c) { if (c) { this.x = c.x || 0; this.y = c.y || 0; this.zoom = c.zoom || 1; } }
  }

  D.Camera = Camera;
})(window.DPO);

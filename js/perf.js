/* ── perf.js ── where the frame actually went ────────────────────────
   Off unless asked for: add ?perf to the URL, or press Ctrl+Shift+P.

   The point is to stop guessing. Frame cost on this app splits three
   ways — repainting the scene, repainting the live layer, and work that
   is not painting at all (PDF decode, autosave, layout) — and which one
   dominates changes completely with the board. A board of ten thousand
   strokes is a different problem from a board holding one 200-page PDF,
   and they are not fixed by the same change.

   So the readout separates them, and reports the worst recent frame
   alongside the average: a steady 60fps with an occasional 200ms stall
   feels worse than a steady 45, and an average hides exactly that.    */
(function (D) {
  'use strict';

  const HISTORY = 120;                 // frames kept for the graph and p95
  const W = 150, H = 34;               // graph size, CSS px

  class Perf {
    constructor(app) {
      this.app = app;
      this.on = false;
      this.base = new Ring(HISTORY);   // scene repaint, ms
      this.live = new Ring(HISTORY);   // live layer repaint, ms
      this.gap = new Ring(HISTORY);    // wall time between frames, ms
      this.drawn = 0;                  // items painted last scene repaint
      this.lastAt = 0;
      this.el = null;
      addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); this.toggle(); }
      });
      if (/[?&]perf\b/.test(location.search)) this.toggle();
    }

    toggle() {
      this.on = !this.on;
      if (this.on) { this.mount(); this.app.schedule(); }
      else { if (this.el) this.el.remove(); this.el = null; }
    }

    mount() {
      const el = this.el = document.createElement('div');
      el.id = 'perf';
      el.innerHTML = `<canvas width="${W * 2}" height="${H * 2}" style="width:${W}px;height:${H}px"></canvas><pre></pre>`;
      document.body.append(el);
      this.canvas = el.querySelector('canvas');
      this.pre = el.querySelector('pre');
      this.gctx = this.canvas.getContext('2d');
    }

    /* ── measurement hooks, called from app.frame() ──────────────── */
    frameStart() {
      if (!this.on) return;
      const now = performance.now();
      if (this.lastAt) this.gap.push(now - this.lastAt);
      this.lastAt = now;
      this._t = now;
    }
    mark(which) {
      if (!this.on) return;
      const now = performance.now();
      this[which].push(now - this._t);
      this._t = now;
    }
    frameEnd() { if (this.on) this.render(); }

    /* ── readout ─────────────────────────────────────────────────── */
    render() {
      const app = this.app, scene = app.scene;
      const gap = this.gap, base = this.base, live = this.live;
      const fps = gap.mean() > 0 ? 1000 / gap.mean() : 0;
      const pdf = D.pdf && D.pdf.stats ? D.pdf.stats() : null;

      /* Painting is only part of it. If the frames are long but neither
         layer is, the time went somewhere this file cannot see — that is
         worth knowing, so it gets its own line rather than being quietly
         folded into the total. */
      const other = Math.max(0, gap.mean() - base.mean() - live.mean());

      const rows = [
        `${fps.toFixed(0).padStart(3)} fps   frame ${fmt(gap.mean())} avg  ${fmt(gap.p95())} p95  ${fmt(gap.max())} worst`,
        `scene  ${fmt(base.mean())} avg  ${fmt(base.max())} worst   ${this.drawn}/${scene.items.length} items drawn`,
        `live   ${fmt(live.mean())} avg  ${fmt(live.max())} worst`,
        `other  ${fmt(other)} avg   (decode, save, layout, idle)`,
        `board  ${scene.items.length} items   undo ${scene.undoStack.length}   zoom ${Math.round(app.camera.zoom * 100)}%`
      ];
      if (pdf) rows.push(`pdf    ${pdf.hiMB}MB sharp + ${pdf.thumbMB}MB thumbs   ${pdf.inflight.length} rendering, ${pdf.queued} queued`);
      this.pre.textContent = rows.join('\n');
      this.graph();
    }

    graph() {
      const ctx = this.gctx, n = this.gap.n();
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!n) return;
      /* Scaled to the budget, not to the data: a graph that rescales to
         its own worst frame looks identical whether the app is smooth or
         hopeless. The line across the middle is 16.7ms. */
      const top = 33.4;                              // two frames at 60Hz
      const y = v => H - Math.min(v, top) / top * H;
      ctx.strokeStyle = '#ffffff2e'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y(16.7) + .5); ctx.lineTo(W, y(16.7) + .5); ctx.stroke();

      const bar = (ring, color, below) => {
        ctx.fillStyle = color;
        for (let i = 0; i < n; i++) {
          const x = W - (n - i);
          const v = ring.at(i), b = below ? below.at(i) : 0;
          ctx.fillRect(x, y(v + b), 1, Math.max(1, y(b) - y(v + b)));
        }
      };
      bar(this.base, '#4f6bff');
      bar(this.live, '#39c46e', this.base);
      for (let i = 0; i < n; i++) {
        if (this.gap.at(i) <= 33.4) continue;        // a dropped frame, flagged red
        ctx.fillStyle = '#ff5a4f';
        ctx.fillRect(W - (n - i), 0, 1, 3);
      }
    }
  }

  /** fixed-size circular buffer of frame timings */
  class Ring {
    constructor(cap) { this.buf = new Float32Array(cap); this.i = 0; this.len = 0; }
    push(v) { this.buf[this.i] = v; this.i = (this.i + 1) % this.buf.length; if (this.len < this.buf.length) this.len++; }
    n() { return this.len; }
    /** oldest-first indexing, so the graph reads left to right */
    at(k) { return this.buf[(this.i - this.len + k + this.buf.length * 2) % this.buf.length]; }
    mean() { let s = 0; for (let k = 0; k < this.len; k++) s += this.at(k); return this.len ? s / this.len : 0; }
    max() { let m = 0; for (let k = 0; k < this.len; k++) m = Math.max(m, this.at(k)); return m; }
    p95() {
      if (!this.len) return 0;
      const a = Array.from({ length: this.len }, (_, k) => this.at(k)).sort((x, y) => x - y);
      return a[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
    }
  }

  const fmt = v => (v < 10 ? v.toFixed(1) : v.toFixed(0)).padStart(4) + 'ms';

  Perf.Ring = Ring;          // visible so the ring maths can be tested
  D.Perf = Perf;
})(window.DPO);

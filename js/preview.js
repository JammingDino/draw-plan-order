/* ── preview.js ── the board preview in the boards sheet ─────────────
   A live, movable picture of a board: it opens where you left off, and
   can be dragged and zoomed to read the rest before opening it.

   It paints with the app's own Renderer — same ink, same LOD, same text
   layout — through a second instance that owns no screen canvases and
   has its own camera, so nothing it does can disturb the board behind
   the sheet. PDF pages show whatever the PDF layer already has cached
   (it never queues renders for a board that is not open), so a page of
   a board you have not opened this session is a labelled sheet.       */
(function (D) {
  'use strict';
  const U = D.util;

  class BoardPreview {
    /**
     * @param host   the element the preview fills
     * @param canvas the canvas inside it
     * @param onOpen called on double-click: open the board shown
     */
    constructor(host, canvas, onOpen) {
      this.host = host;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onOpen = onOpen;
      this.camera = new D.Camera();
      this.camera.min = 0.02;
      this.scene = null;
      this.view = null;
      this.moved = false;
      this.pointers = new Map();

      /* A Renderer without a screen: drawItems and the painters it calls
         only need the scene (for text layout), a camera and a way to fetch
         pictures. bctx is left unset, so PDF pages take the cached path. */
      const self = this;
      this.painter = Object.create(D.Renderer.prototype);
      this.painter.dpr = 1;
      this.painter.app = {
        get scene() { return self.scene; },
        camera: this.camera,
        editor: null,
        getAsset: id => self.getAsset(id),
        requestDraw: () => self.draw()
      };
      this.getAsset = id => D.store.getAsset(id);

      this.bind();
    }

    /**
     * Show a board. `view` is where it was last looked at, in the main
     * window's screen terms ({x, y, zoom} as the camera saves it); null
     * fits the whole board instead.
     */
    show(scene, view, getAsset) {
      this.scene = scene;
      this.view = view;
      if (getAsset) this.getAsset = getAsset;
      this.home();
    }

    clear() {
      this.scene = null;
      this.canvas.width = this.canvas.height = 0;     // hand the memory back
    }

    /** back to where the board was left */
    home() {
      this.moved = false;
      this.host.classList.remove('moved');
      const { w, h } = this.size();
      const v = this.view, cam = this.camera;
      if (v && v.zoom > 0) {
        /* The same middle and the same stretch of board as the main window
           showed, scaled to cover the preview the way the still picture
           under it is scaled, so the two line up as one replaces the other. */
        const s = Math.max(w / innerWidth, h / innerHeight);
        const cx = (innerWidth / 2 - v.x) / v.zoom, cy = (innerHeight / 2 - v.y) / v.zoom;
        cam.zoom = U.clamp(v.zoom * s, cam.min, cam.max);
        cam.centerOn(cx, cy, w, h);
      } else if (this.scene) {
        cam.fit(this.scene.contentBounds(), w, h, 24);
      }
      this.draw();
    }

    size() {
      const r = this.host.getBoundingClientRect();
      return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    }

    /** paint on the next frame; repeated asks in one frame paint once */
    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this.paint(); });
    }

    paint() {
      if (!this.scene) return;
      const { w, h } = this.size();
      const d = Math.min(devicePixelRatio || 1, 2);
      const W = Math.round(w * d), H = Math.round(h * d);
      if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
      const ctx = this.ctx, cam = this.camera, P = this.painter;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = P.tokens().paper;
      ctx.fillRect(0, 0, W, H);
      P.dpr = d;
      ctx.setTransform(cam.zoom * d, 0, 0, cam.zoom * d, cam.x * d, cam.y * d);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      try { P.drawItems(ctx, this.scene.near(cam.viewport(w, h, 40)), cam.zoom); }
      catch (err) { console.warn('[dpo] preview', err); }
      if (this.onPaint) this.onPaint();
    }

    /* ── moving it ──────────────────────────────────────────────────── */
    bind() {
      const host = this.host;
      const at = e => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const touched = () => { if (!this.moved) { this.moved = true; host.classList.add('moved'); } };

      host.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        host.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, at(e));
        host.classList.add('grabbing');
      });
      host.addEventListener('pointermove', e => {
        const was = this.pointers.get(e.pointerId);
        if (!was || !this.scene) return;
        const now = at(e);
        if (this.pointers.size >= 2) {
          // two fingers: pinch about their midpoint, and follow it
          const [a, b] = [...this.pointers.values()];
          const other = was === a ? b : a;
          const d0 = Math.hypot(was.x - other.x, was.y - other.y);
          const d1 = Math.hypot(now.x - other.x, now.y - other.y);
          if (d0 > 2) this.camera.zoomBy(d1 / d0, (now.x + other.x) / 2, (now.y + other.y) / 2);
          this.camera.panBy((now.x - was.x) / 2, (now.y - was.y) / 2);
        } else {
          this.camera.panBy(now.x - was.x, now.y - was.y);
        }
        this.pointers.set(e.pointerId, now);
        touched();
        this.draw();
      });
      const up = e => {
        this.pointers.delete(e.pointerId);
        if (!this.pointers.size) host.classList.remove('grabbing');
      };
      host.addEventListener('pointerup', up);
      host.addEventListener('pointercancel', up);
      host.addEventListener('wheel', e => {
        e.preventDefault();
        if (!this.scene) return;
        const p = at(e);
        // a wheel zooms here (there is nothing to scroll); a touchpad's sideways swipe pans
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) this.camera.panBy(-e.deltaX, 0);
        else this.camera.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), p.x, p.y);
        touched();
        this.draw();
      }, { passive: false });
      host.addEventListener('dblclick', e => { if (!e.target.closest('button')) this.onOpen(); });
      new ResizeObserver(() => { if (this.scene) this.moved ? this.draw() : this.home(); }).observe(host);
    }
  }

  D.BoardPreview = BoardPreview;
})(window.DPO);

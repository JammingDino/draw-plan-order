/* ── zoompad.js ── write large, and it lands small ──────────────────────
   Samsung Notes' zoom pad: a strip along the bottom of the window shows
   a small box of the board, enlarged, and what is written in the strip
   goes on the board in that box, at its true size. For filling in the
   margins of a dense PDF, or neat small handwriting, without zooming the
   whole board in and out.

   The box is outlined on the board, with a tab at its corner to drag it
   by. Lifting the pen near the strip's right-hand end moves the box on
   along the line, and past the end of the line back to its start, a line
   down — so a sentence can be written without touching anything else.
   The strip's own buttons move it back and on, start a new line, and
   make the writing larger or smaller. A finger dragged on the strip
   slides the board under it.

   The pen, highlighter or eraser in hand writes in it (the eraser end of
   the pen rubs out); with any other tool, the pen does. Strokes are made
   by the tools themselves, so smoothing, snapping and undo all work as
   they do on the board.

   D.zoompad.open(app) / close(app) / toggle(app) / box()                */
(function (D) {
  'use strict';
  const U = D.util;
  const el = (tag, attrs, ...kids) => U.el(tag, attrs, ...kids);

  const ICON = 'M3.5 13.5h17v7h-17z|M10 3.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z|M13 10.5l3 3|M6 18.5l3-2 2 1.5 3-2.5';
  const TAB = 22;                     // the corner tab, screen px

  /** @type {any} */ let pad = null;  // { el, canvas, ctx, mag, box: {x, y, w, h}, lineX, lineEnd, stroke, ro }

  /* ── where things go ──────────────────────────────────────────────── */
  function sizeBox(app) {
    const r = pad.canvas.getBoundingClientRect();
    pad.box.w = r.width / pad.mag; pad.box.h = r.height / pad.mag;
  }
  /** a point on the strip, in board units */
  function toBoard(px, py) { return { x: pad.box.x + px / pad.mag, y: pad.box.y + py / pad.mag }; }

  /** keep the box where it can be seen on the board, moving the view if it has gone off it */
  function keepInView(app) {
    const c = app.camera, b = pad.box, top = c.toScreen(b.x, b.y), bot = c.toScreen(b.x + b.w, b.y + b.h);
    const room = innerHeight - pad.el.offsetHeight - 16;
    let dx = 0, dy = 0;
    if (top.x < 70) dx = 70 - top.x; else if (bot.x > innerWidth - 20) dx = innerWidth - 20 - bot.x;
    if (top.y < 70) dy = 70 - top.y; else if (bot.y > room) dy = room - bot.y;
    if (dx || dy) { c.panBy(dx, dy); app.requestDraw(); app.saveView && app.saveView(); }
  }

  /** move the box on along the line; past its end, back to the start of the next */
  function advance(app, frac = 0.6) {
    const b = pad.box;
    b.x += b.w * frac;
    if (b.x + b.w * 0.4 > pad.lineEnd) newLine(app);
    else { keepInView(app); paint(app); app.requestDrawLive(); }
  }
  function back(app) {
    pad.box.x = Math.max(pad.lineX, pad.box.x - pad.box.w * 0.6);
    keepInView(app); paint(app); app.requestDrawLive();
  }
  function newLine(app) {
    pad.box.x = pad.lineX; pad.box.y += pad.box.h * 0.8;
    keepInView(app); paint(app); app.requestDrawLive();
  }
  /** start the line here: the box's left edge is where lines start; the view's right, where they end */
  function setLine(app) {
    pad.lineX = pad.box.x;
    const right = app.camera.toWorld(innerWidth - 40, 0).x;
    pad.lineEnd = Math.max(pad.lineX + pad.box.w * 1.5, right);
  }

  /* ── painting ─────────────────────────────────────────────────────── */
  let raf = 0;
  function paint(app) {
    if (!pad || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paintNow(app); });
  }
  function paintNow(app) {
    if (!pad) return;
    const cv = pad.canvas, r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    const W = Math.round(r.width * d), H = Math.round(r.height * d);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    sizeBox(app);
    const ctx = pad.ctx, R = app.renderer, b = pad.box, z = pad.mag;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = R.tokens().paper; ctx.fillRect(0, 0, W, H);
    // a guide line to write on, two thirds of the way down
    ctx.strokeStyle = R.tokens().dark ? '#ffffff22' : '#4f6bff33'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Math.round(H * 0.68) + 0.5); ctx.lineTo(W, Math.round(H * 0.68) + 0.5); ctx.stroke();
    ctx.setTransform(z * d, 0, 0, z * d, -b.x * z * d, -b.y * z * d);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const was = R.paintZoom;
    try {
      R.drawItems(ctx, app.scene.near(U.box(b.x, b.y, b.x + b.w, b.y + b.h)), z);
      // the stroke being written, which is not on the board until it is finished
      const live = pad.stroke && pad.stroke.item;
      if (live && live.pts && live.pts.length) R.drawItem(ctx, live);
    } catch (err) { console.warn('[dpo] zoom pad', err); }
    R.paintZoom = was;
    // where the line will move on: the last fifth, shaded
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = R.tokens().dark ? '#7d92ff14' : '#4f6bff0d';
    ctx.fillRect(W * 0.8, 0, W * 0.2, H);
  }

  /* the box, outlined on the board, with its tab */
  D.ext.on('frame', (app, ctx) => {
    if (!pad) return;
    const c = app.camera, b = pad.box, a = c.toScreen(b.x, b.y), e = c.toScreen(b.x + b.w, b.y + b.h);
    ctx.save();
    ctx.strokeStyle = '#4f6bff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.strokeRect(a.x, a.y, e.x - a.x, e.y - a.y);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4f6bff';
    ctx.beginPath(); ctx.roundRect(a.x - TAB, a.y - TAB, TAB, TAB, [6, 0, 0, 6]); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const k of [-6, 0]) { ctx.moveTo(a.x - TAB + 6, a.y - TAB / 2 + k + 3); ctx.lineTo(a.x - 6, a.y - TAB / 2 + k + 3); }
    ctx.stroke();
    ctx.restore();
  });

  /* the tab drags the box about the board */
  D.ext.routes.push((app, e) => {
    if (!pad || e.button > 0) return null;
    const a = app.camera.toScreen(pad.box.x, pad.box.y);
    if (!(e.clientX >= a.x - TAB - 6 && e.clientX <= a.x + 4 && e.clientY >= a.y - TAB - 6 && e.clientY <= a.y + 4)) return null;
    let from = null;
    return {
      down(ev) { from = { sx: ev.sx, sy: ev.sy, x: pad.box.x, y: pad.box.y }; },
      move(ev) {
        if (!from) return;
        pad.box.x = from.x + (ev.sx - from.sx) / app.camera.zoom; pad.box.y = from.y + (ev.sy - from.sy) / app.camera.zoom;
        paint(app); app.requestDrawLive();
      },
      up() { from = null; if (pad) setLine(app); },
      cancel() { if (from && pad) { pad.box.x = from.x; pad.box.y = from.y; } from = null; app.requestDrawLive(); }
    };
  });

  D.ext.on('change', app => { if (pad) paint(app); });
  D.ext.on('board', app => { if (pad) close(app); });

  /* ── writing in it ────────────────────────────────────────────────── */
  function toolFor(app, e) {
    if (U.isEraserEnd(e)) return app.tools.eraser;
    const n = app.toolName;
    return n === 'pen' || n === 'highlighter' || n === 'eraser' ? app.tools[n] : app.tools.pen;
  }
  function evOf(app, e, samples) {
    const r = pad.canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const w = toBoard(px, py);
    const ev = {
      x: w.x, y: w.y, sx: e.clientX, sy: e.clientY, px,
      pressure: e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.35) : 0.55,
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, pointerType: e.pointerType, e
    };
    ev.samples = samples || [ev];
    return ev;
  }

  function bind(app) {
    const cv = pad.canvas;
    let slide = null;
    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (_) { }
      if (e.pointerType === 'touch') { slide = { id: e.pointerId, x: e.clientX, y: e.clientY, bx: pad.box.x, by: pad.box.y }; return; }
      if (e.button > 0 || pad.stroke) return;
      const tool = toolFor(app, e), ev = evOf(app, e);
      pad.stroke = { id: e.pointerId, tool, item: null };
      app.pointer = ev;
      tool.down(ev);
      pad.stroke.item = tool.item || null;
      paint(app);
    });
    cv.addEventListener('pointermove', e => {
      if (slide && e.pointerId === slide.id) {
        pad.box.x = slide.bx - (e.clientX - slide.x) / pad.mag; pad.box.y = slide.by - (e.clientY - slide.y) / pad.mag;
        paint(app); app.requestDrawLive();
        return;
      }
      const s = pad.stroke;
      if (!s || e.pointerId !== s.id) return;
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const samples = (list.length ? list : [e]).map(x => evOf(app, x));
      const ev = evOf(app, e, samples);
      app.pointer = ev;
      s.tool.move(ev);
      s.item = s.tool.item || s.item;
      paint(app);
    });
    const up = (e, cancelled) => {
      if (slide && e.pointerId === slide.id) { slide = null; setLine(app); return; }
      const s = pad.stroke;
      if (!s || e.pointerId !== s.id) return;
      pad.stroke = null;
      const ev = evOf(app, e);
      if (cancelled && s.tool.cancel) s.tool.cancel(); else s.tool.up(ev);
      app.requestDrawLive();
      // written up to the end of the strip: on along the line
      if (!cancelled && s.tool !== app.tools.eraser && ev.px > pad.canvas.getBoundingClientRect().width * 0.8) advance(app);
      else paint(app);
    };
    cv.addEventListener('pointerup', e => up(e, false));
    cv.addEventListener('pointercancel', e => up(e, true));
  }

  /* ── opening and closing ──────────────────────────────────────────── */
  function open(app) {
    if (pad) return;
    const btn = (title, text, onclick) => el('button', { class: 'zp-btn', type: 'button', title, 'aria-label': title, onclick }, text);
    const canvas = el('canvas', { class: 'zp-canvas' });
    const mag = el('span', { class: 'zp-mag' });
    const host = el('div', { class: 'zoompad', role: 'region', 'aria-label': 'Zoom pad' },
      el('div', { class: 'zp-bar' },
        btn('Back along the line', '◀', () => back(app)),
        btn('On along the line', '▶', () => advance(app)),
        btn('New line', '↵', () => newLine(app)),
        el('span', { class: 'zp-gap' }),
        btn('Smaller writing (more of the board in the pad)', '−', () => zoom(app, 1 / 1.25)),
        mag,
        btn('Larger writing', '+', () => zoom(app, 1.25)),
        el('span', { class: 'zp-gap' }),
        btn('Close the zoom pad', '✕', () => close(app))),
      canvas);
    document.body.append(host);
    pad = { el: host, canvas, ctx: canvas.getContext('2d'), magEl: mag, mag: 3, box: { x: 0, y: 0, w: 0, h: 0 }, lineX: 0, lineEnd: 0, stroke: null };
    // writing at three times the board's size as it is on screen, starting a third of the way in
    pad.mag = U.clamp(app.camera.zoom * 3, 0.2, 40);
    sizeBox(app);
    const at = app.camera.toWorld(innerWidth * 0.18, innerHeight * 0.3);
    pad.box.x = at.x; pad.box.y = at.y;
    setLine(app);
    showMag();
    bind(app);
    pad.ro = new ResizeObserver(() => { if (pad) { sizeBox(app); paint(app); app.requestDrawLive(); } });
    pad.ro.observe(canvas);
    document.body.classList.add('zoompad-open');
    mark();
    keepInView(app);
    paint(app); app.requestDrawLive();
  }
  function zoom(app, f) {
    const b = pad.box, cy = b.y + b.h * 0.68;
    pad.mag = U.clamp(pad.mag * f, 0.2, 40);
    sizeBox(app);
    b.y = cy - b.h * 0.68;                 // the line being written on stays put
    showMag(); setLine(app); keepInView(app); paint(app); app.requestDrawLive();
  }
  function showMag() { pad.magEl.textContent = Math.round(pad.mag * 100) + '%'; }
  function close(app) {
    if (!pad) return;
    if (pad.stroke && pad.stroke.tool.cancel) pad.stroke.tool.cancel();
    pad.ro.disconnect();
    pad.el.remove();
    pad = null;
    document.body.classList.remove('zoompad-open');
    mark();
    app.requestDrawLive();
  }
  function toggle(app) { if (pad) close(app); else open(app); }
  function mark() {
    const b = typeof document !== 'undefined' && document.getElementById('btn-zoompad');
    if (b) b.classList.toggle('on', !!pad);
  }

  D.ext.buttons.push({ id: 'btn-zoompad', icon: ICON, title: 'Zoom pad — write large in a strip, and it lands small on the board', where: 'view', onClick: app => toggle(app) });

  D.zoompad = { open, close, toggle, box: () => pad && pad.box, isOpen: () => !!pad };
})(window.DPO);

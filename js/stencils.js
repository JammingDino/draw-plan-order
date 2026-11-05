/* ── stencils.js ── a ruler and a protractor to draw along ──────────────
   As OneNote has them: laid over the board from the zoom bar, moved by
   dragging them with a finger, the pen or the mouse, turned by the knob
   on them, and drawn along with the pen. A stroke that starts at the
   ruler's edge runs straight along it; one that starts at the
   protractor's curve follows the curve, and its angle is read out as it
   goes; one that starts at the protractor's flat side runs along that.

   A stencil is not part of the board: it is not saved, undone or
   exported. It sits at a place on the board, so it pans and zooms away
   with what it was laid on, but it is drawn at the same size on screen
   whatever the zoom, like a real ruler held over the page.

   D.stencils.show(app, kind) / hide(app) / toggle(app, kind)
   D.stencils.state()   { kind, x, y, ang } (board units; ang clockwise
                        on screen, in radians) or null                   */
(function (D) {
  'use strict';
  const U = D.util;

  const RULER_LEN = 860, RULER_W = 78;   // screen px
  const PROT_R = 210;
  const SNAP_PX = 18;                    // how near the edge a stroke must start to run along it
  const KNOB_R = 17;

  let S = null;                          // the stencil on the board, if any
  let snap = null;                       // { id, kind: 'edge' | 'arc' | 'base', side, r } while a stroke follows it
  let readout = null;                    // text beside the pen while it follows the protractor, or turns a stencil

  const ICON_RULER = 'M2.5 8.5h19v7h-19z|M6 8.5v3|M9.5 8.5v2|M13 8.5v3|M16.5 8.5v2';
  const ICON_PROT = 'M3 18h18|M4.5 18a7.5 7.5 0 0 1 15 0|M12 18l4.5-5';

  /* ── where things are ─────────────────────────────────────────────── */
  function frame(app) {
    const c = app.camera.toScreen(S.x, S.y), a = S.ang;
    return { cx: c.x, cy: c.y, ux: Math.cos(a), uy: Math.sin(a), nx: -Math.sin(a), ny: Math.cos(a) };
  }
  /** a screen point in the stencil's own frame: along it, and across it (down the page is +) */
  function local(app, sx, sy) {
    const f = frame(app), dx = sx - f.cx, dy = sy - f.cy;
    return { lx: dx * f.ux + dy * f.uy, ly: dx * f.nx + dy * f.ny };
  }
  function toScreen(app, lx, ly) {
    const f = frame(app);
    return { x: f.cx + lx * f.ux + ly * f.nx, y: f.cy + lx * f.uy + ly * f.ny };
  }
  const knobAt = () => S.kind === 'ruler' ? { lx: RULER_LEN / 2 - 34, ly: 0 } : { lx: 0, ly: -PROT_R * 0.42 };

  /** what a press at screen (sx, sy) lands on: 'knob', 'body', an edge to draw along, or null */
  function hitAt(app, sx, sy) {
    const { lx, ly } = local(app, sx, sy), k = knobAt();
    if (Math.hypot(lx - k.lx, ly - k.ly) <= KNOB_R + 6) return { what: 'knob' };
    if (S.kind === 'ruler') {
      if (Math.abs(lx) <= RULER_LEN / 2 + SNAP_PX) {
        if (Math.abs(ly + RULER_W / 2) <= SNAP_PX) return { what: 'edge', kind: 'edge', side: -1 };
        if (Math.abs(ly - RULER_W / 2) <= SNAP_PX) return { what: 'edge', kind: 'edge', side: 1 };
      }
      if (Math.abs(lx) <= RULER_LEN / 2 && Math.abs(ly) <= RULER_W / 2) return { what: 'body' };
      return null;
    }
    const d = Math.hypot(lx, ly);
    if (ly <= SNAP_PX && Math.abs(d - PROT_R) <= SNAP_PX) return { what: 'edge', kind: 'arc', side: d >= PROT_R ? 1 : -1 };
    if (Math.abs(ly) <= SNAP_PX && Math.abs(lx) <= PROT_R) return { what: 'edge', kind: 'base', side: ly >= 0 ? 1 : -1 };
    if (ly <= 0 && d <= PROT_R) return { what: 'body' };
    return null;
  }

  /* ── drawing along it ─────────────────────────────────────────────── */
  /* The pen's point is put on the line or curve it started at, set off by
     the nib's own half-width so the ink lies against the edge rather than
     under it. */
  function follow(app, ev) {
    if (!snap || !S || !ev.e || ev.e.pointerId !== snap.id) return;
    const { lx, ly } = local(app, ev.sx, ev.sy);
    let p;
    if (snap.kind === 'edge') p = toScreen(app, lx, snap.side * (RULER_W / 2 + snap.off));
    else if (snap.kind === 'base') p = toScreen(app, lx, snap.side * snap.off);
    else {
      const a = Math.atan2(ly, lx), r = PROT_R + snap.side * snap.off;
      p = toScreen(app, r * Math.cos(a), r * Math.sin(a));
      let deg = -a * 180 / Math.PI;
      if (deg < 0) deg += 360;
      readout = { text: (D.cad ? D.cad.fmtAng(deg, 1) : deg.toFixed(1) + '°'), x: p.x, y: p.y };
    }
    const w = app.camera.toWorld(p.x, p.y);
    ev.x = w.x; ev.y = w.y; ev.sx = p.x; ev.sy = p.y;
  }
  D.ext.on('adjust', (app, ev) => {
    if (!snap) return;
    // let go once the pen has lifted: a hover after it is not part of the stroke
    if (ev.e && ev.e.pointerId === snap.id && ev.e.type === 'pointermove' && !(ev.e.buttons & 1)) { snap = null; readout = null; app.requestDrawLive(); return; }
    follow(app, ev);
  });

  /* ── moving and turning it ────────────────────────────────────────── */
  function mover(app, mode) {
    /** @type {any} */ let start = null;
    return {
      down(ev) {
        start = { sx: ev.sx, sy: ev.sy, x: S.x, y: S.y, ang: S.ang };
        if (mode === 'turn') { const f = frame(app); start.a0 = Math.atan2(ev.sy - f.cy, ev.sx - f.cx); }
      },
      move(ev) {
        if (!start || !S) return;
        if (mode === 'move') {
          const z = app.camera.zoom;
          S.x = start.x + (ev.sx - start.sx) / z; S.y = start.y + (ev.sy - start.sy) / z;
        } else {
          const f = frame(app);
          let a = start.ang + Math.atan2(ev.sy - f.cy, ev.sx - f.cx) - start.a0;
          // whole degrees, and square to the page and 15° steps when near them
          let deg = -a * 180 / Math.PI;
          const near = Math.round(deg / 15) * 15;
          deg = Math.abs(deg - near) < 2 ? near : Math.round(deg);
          a = -deg * Math.PI / 180;
          S.ang = Math.atan2(Math.sin(a), Math.cos(a));
          let shown = ((deg % 360) + 360) % 360;
          if (S.kind === 'ruler' && shown >= 180) shown -= 180;       // a ruler reads the same either way round
          readout = { text: (D.cad ? D.cad.fmtAng(shown, 0) : shown + '°'), x: ev.sx, y: ev.sy };
        }
        app.requestDrawLive();
      },
      up() { start = null; readout = null; app.requestDrawLive(); },
      cancel() { if (start && S) { S.x = start.x; S.y = start.y; S.ang = start.ang; } start = null; readout = null; app.requestDrawLive(); }
    };
  }

  D.ext.routes.push((app, e) => {
    snap = null; readout = null;
    if (!S || e.button > 0) return null;
    const h = hitAt(app, e.clientX, e.clientY);
    if (!h) return null;
    if (h.what === 'knob') return mover(app, 'turn');
    if (h.what === 'edge' && e.pointerType !== 'touch' && (app.toolName === 'pen' || app.toolName === 'highlighter')) {
      const o = app.opts[app.toolName];
      snap = { id: e.pointerId, kind: h.kind, side: h.side, off: (o.size || 2) * app.camera.zoom / 2 + 1 };
      return null;                                        // the pen draws, and `adjust` keeps it on the edge
    }
    if (h.what === 'body' || h.what === 'edge') {
      // a finger on it always moves it; the pen or mouse only when a drawing tool would not draw along it
      return mover(app, 'move');
    }
    return null;
  });

  /* ── painting ─────────────────────────────────────────────────────── */
  function niceStep(min) {
    const e = Math.pow(10, Math.floor(Math.log10(min)));
    for (const m of [1, 2, 5, 10]) if (m * e >= min) return m * e;
    return 10 * e;
  }

  D.ext.on('frame', (app, ctx) => {
    if (!S) return;
    const dark = app.renderer.tokens().dark;
    const ink = dark ? '#e8ebf2' : '#1d2230', fill = dark ? 'rgba(125,146,255,0.16)' : 'rgba(79,107,255,0.10)';
    const edge = dark ? 'rgba(125,146,255,0.75)' : 'rgba(79,107,255,0.7)';
    const f = frame(app);
    ctx.save();
    ctx.translate(f.cx, f.cy); ctx.rotate(S.ang);
    ctx.fillStyle = fill; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (S.kind === 'ruler') ctx.rect(-RULER_LEN / 2, -RULER_W / 2, RULER_LEN, RULER_W);
    else { ctx.moveTo(-PROT_R, 0); ctx.arc(0, 0, PROT_R, Math.PI, 0); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1;
    ctx.font = '10px "Segoe UI",system-ui,sans-serif';
    if (S.kind === 'ruler') {
      // in the board's units at its drawing scale, from the left-hand end, along both edges
      const sc = D.cad ? D.cad.scaleOf(app.scene) : { k: 1, unit: '' };
      const perPx = sc.k / app.camera.zoom, step = niceStep(perPx * 7), px = step / perPx;
      const n = Math.floor(RULER_LEN / px);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const x = -RULER_LEN / 2 + i * px, len = i % 10 === 0 ? 16 : i % 5 === 0 ? 11 : 6;
        ctx.moveTo(x, -RULER_W / 2); ctx.lineTo(x, -RULER_W / 2 + len);
        ctx.moveTo(x, RULER_W / 2); ctx.lineTo(x, RULER_W / 2 - len);
      }
      ctx.stroke();
      for (let i = 0; i <= n; i += 10) {
        const v = +(i * step).toPrecision(6);
        ctx.fillText(String(v), -RULER_LEN / 2 + i * px, -RULER_W / 2 + 18);
      }
      if (sc.unit) { ctx.textAlign = 'left'; ctx.fillText(sc.unit, -RULER_LEN / 2 + 6, RULER_W / 2 - 28); }
    } else {
      ctx.beginPath();
      for (let d = 0; d <= 180; d++) {
        const a = -d * Math.PI / 180, len = d % 10 === 0 ? 16 : d % 5 === 0 ? 11 : 6;
        ctx.moveTo(Math.cos(a) * PROT_R, Math.sin(a) * PROT_R);
        ctx.lineTo(Math.cos(a) * (PROT_R - len), Math.sin(a) * (PROT_R - len));
      }
      ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let d = 0; d <= 180; d += 10) {
        const a = -d * Math.PI / 180;
        ctx.save(); ctx.translate(Math.cos(a) * (PROT_R - 28), Math.sin(a) * (PROT_R - 28)); ctx.rotate(a + Math.PI / 2);
        ctx.fillText(String(d), 0, 0); ctx.restore();
      }
    }
    // the knob that turns it
    const k = knobAt();
    ctx.beginPath(); ctx.arc(k.lx, k.ly, KNOB_R, 0, Math.PI * 2);
    ctx.fillStyle = dark ? 'rgba(30,34,44,0.9)' : 'rgba(255,255,255,0.92)'; ctx.fill();
    ctx.strokeStyle = edge; ctx.stroke();
    ctx.beginPath(); ctx.arc(k.lx, k.ly, KNOB_R - 7, -2.4, 1.4); ctx.strokeStyle = ink; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
    if (readout) {
      ctx.save();
      ctx.font = '600 13px "Segoe UI",system-ui,sans-serif';
      const w = ctx.measureText(readout.text).width + 14, x = readout.x + 18, y = readout.y - 34;
      ctx.fillStyle = dark ? 'rgba(30,34,44,0.92)' : 'rgba(255,255,255,0.95)'; ctx.strokeStyle = edge;
      ctx.beginPath(); ctx.roundRect(x, y, w, 24, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.fillText(readout.text, x + 7, y + 12);
      ctx.restore();
    }
  });

  /* ── showing it ───────────────────────────────────────────────────── */
  function show(app, kind) {
    const c = app.camera.toWorld(innerWidth / 2, innerHeight / 2);
    S = S ? { ...S, kind } : { kind, x: c.x, y: c.y, ang: 0 };
    mark(); app.requestDrawLive();
  }
  function hide(app) { S = null; snap = null; readout = null; mark(); app.requestDrawLive(); }
  function toggle(app, kind) { if (S && S.kind === kind) hide(app); else show(app, kind); }
  function mark() {
    for (const [id, kind] of [['btn-ruler', 'ruler'], ['btn-protractor', 'protractor']]) {
      const b = typeof document !== 'undefined' && document.getElementById(id);
      if (b) b.classList.toggle('on', !!S && S.kind === kind);
    }
  }

  D.ext.buttons.push(
    { id: 'btn-ruler', icon: ICON_RULER, title: 'Ruler — draw along its edge; drag it to move, the knob to turn', where: 'view', onClick: app => toggle(app, 'ruler') },
    { id: 'btn-protractor', icon: ICON_PROT, title: 'Protractor — draw round its edge for an arc; drag it to move, the knob to turn', where: 'view', onClick: app => toggle(app, 'protractor') }
  );

  D.stencils = { show, hide, toggle, state: () => S, hitAt: (app, x, y) => S ? hitAt(app, x, y) : null };
})(window.DPO);

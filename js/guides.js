/* ── guides.js ── smart guides: what is dragged lines up ──────────────
   As in Photoshop: drag a selection and its edges and middle are held
   up against those of the things around it. Within a few pixels of one
   it snaps there, and a line shows what it lined up with. Gaps count
   too — next to a row of things spaced evenly, or between two, it snaps
   to the same spacing and each equal gap is marked with its size, so a
   third page dropped beside two sits as far from the second as the
   second is from the first. Resizing snaps the edges being dragged the
   same way. Holding Ctrl while dragging places it freely, as it does in
   Photoshop; Settings → Pen and touch → Smart guides turns them off.

   What counts as something to line up with: pages, pictures, shapes,
   text, notes, nodes and features' items, and a group as one piece.
   Loose handwriting does not — a page of it is thousands of strokes,
   each too small to mean anything as an edge — nor do connectors, which
   follow what they join.

   D.guides.targets(app, moving) → [box]       what may be lined up with
   D.guides.snap(box, boxes, dx, dy, tol, axes) → { dx, dy, lines, gaps }
   D.guides.edge(v, axis, boxes, tol) → v      one edge, snapped (resizing)
   D.guides.found(box, boxes, eps) → { lines, gaps }   what lines up now
   D.guides.paint(r, found, app)               the guides, on the live layer */
(function (D) {
  'use strict';
  const U = D.util;

  /* screen px from a line-up at which a drag is drawn onto it */
  const SNAP_PX = { mouse: 6, pen: 9, touch: 11 };
  const COLOUR = '#f0389b';
  const MAX_TARGETS = 600;
  const AX = {
    x: { lo: 'x', hi: 'x2', size: 'w', olo: 'y', ohi: 'y2' },
    y: { lo: 'y', hi: 'y2', size: 'h', olo: 'x', ohi: 'x2' }
  };

  /** the line-up distance in board units, for this pointer at this zoom */
  function tolerance(app, type) {
    return (SNAP_PX[type] || SNAP_PX.mouse) / ((app.camera && app.camera.zoom) || 1);
  }

  /** the boxes of what is in and around the view, but not moving: a group as one */
  function targets(app, moving) {
    const scene = app.scene, cam = app.camera;
    const w = typeof innerWidth === 'number' ? innerWidth : 1280, h = typeof innerHeight === 'number' ? innerHeight : 800;
    const v = cam.viewport(w, h, 0);
    const room = U.box(v.x - v.w * 0.5, v.y - v.h * 0.5, v.x2 + v.w * 0.5, v.y2 + v.h * 0.5);
    const skip = new Set(moving.map(i => i.id)), groups = new Map(), out = [];
    for (const it of scene.near(room)) {
      if (skip.has(it.id) || it.type === 'edge') continue;
      if (it.type === 'stroke' && !it.group) continue;
      const b = scene.bbox(it);
      if (!b || !isFinite(b.w)) continue;
      if (it.group) {
        const g = groups.get(it.group);
        if (g) { g.box = U.unionBox(g.box, b); continue; }
        const u = { box: b };
        groups.set(it.group, u); out.push(u);
      } else out.push({ box: b });
      if (out.length >= MAX_TARGETS) break;
    }
    return out.map(u => u.box);
  }

  const shift = (b, dx, dy) => U.box(b.x + dx, b.y + dy, b.x2 + dx, b.y2 + dy);
  const mid = (b, a) => (b[AX[a].lo] + b[AX[a].hi]) / 2;
  const marks = (b, a) => [b[AX[a].lo], mid(b, a), b[AX[a].hi]];
  /** do two boxes share some of the other axis (side by side along `a`)? */
  const level = (p, q, a) => Math.min(p[AX[a].ohi], q[AX[a].ohi]) - Math.max(p[AX[a].olo], q[AX[a].olo]) > 0;

  /**
   * The gaps along axis `a` between neighbours in a row: each pair of
   * boxes side by side with nothing of the row between them.
   */
  function rowGaps(row, a) {
    const { lo, hi } = AX[a], out = [];
    const s = row.slice().sort((p, q) => p[lo] - q[lo]);
    for (let i = 0; i < s.length; i++) {
      let next = null;
      for (let j = 0; j < s.length; j++) {
        if (j === i || s[j][lo] < s[i][hi]) continue;
        if (!next || s[j][lo] < next[lo]) next = s[j];
      }
      if (next && next[lo] - s[i][hi] > 0) out.push({ a: s[i], b: next, g: next[lo] - s[i][hi] });
    }
    return out;
  }

  /**
   * How far along axis `a` the box M should move to line up with one of
   * `boxes`, within `tol`: { d, kind } or null. Edges and middles first;
   * a spacing equal to one already in the row, or the even split between
   * two neighbours, when it is nearer.
   */
  function nearest(M, boxes, a, tol) {
    const { lo, hi, size } = AX[a];
    let best = null;
    const take = (d, kind) => { if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d) - 1e-9)) best = { d, kind }; };
    const mine = marks(M, a);
    for (const T of boxes) {
      const theirs = marks(T, a);
      for (const m of mine) for (const t of theirs) take(t - m, 'edge');
    }
    const row = boxes.filter(T => level(M, T, a));
    if (row.length) {
      const c = mid(M, a);
      let L = null, R = null;
      for (const T of row) {
        if (T[hi] <= c && (!L || T[hi] > L[hi])) L = T;
        if (T[lo] >= c && (!R || T[lo] < R[lo])) R = T;
      }
      const gaps = rowGaps(row, a);
      for (const { g } of gaps) {
        if (L) take(L[hi] + g - M[lo], 'gap');
        if (R) take(R[lo] - g - M[hi], 'gap');
      }
      if (L && R && R[lo] - L[hi] > M[size]) take((L[hi] + R[lo] - M[size]) / 2 - M[lo], 'gap');
    }
    return best;
  }

  /**
   * Where a box `B`, dragged by (dx, dy), lines up with `boxes`. Each axis
   * on its own; `axes` is the ones free to move ('x', 'y' or 'xy').
   * Gives the offset to use instead, and what it lines up with there.
   */
  function snap(B, boxes, dx, dy, tol, axes = 'xy') {
    let M = shift(B, dx, dy);
    if (axes.includes('x')) { const n = nearest(M, boxes, 'x', tol); if (n) dx += n.d; }
    if (axes.includes('y')) { const n = nearest(shift(B, dx, dy), boxes, 'y', tol); if (n) dy += n.d; }
    M = shift(B, dx, dy);
    return Object.assign({ dx, dy }, found(M, boxes, Math.max(1e-6, tol * 0.04), axes));
  }

  /** one edge's position `v` on axis `a` ('x' or 'y'), drawn onto the nearest edge or middle within `tol` */
  function edge(v, a, boxes, tol) {
    let best = null;
    for (const T of boxes) for (const t of marks(T, a)) if (Math.abs(t - v) <= tol && (best == null || Math.abs(t - v) < Math.abs(best - v))) best = t;
    return best == null ? v : best;
  }

  /**
   * What the box M lines up with as it stands, to show: `lines`, one for
   * each edge or middle it shares with something (spanning all of them),
   * and `gaps`, every gap in its row and column the same size as one of
   * its own to a neighbour.
   */
  function found(M, boxes, eps, axes = 'xy') {
    const lines = [], gaps = [];
    for (const a of ['x', 'y']) {
      if (!axes.includes(a)) continue;
      const { olo, ohi } = AX[a];
      const at = new Map();
      for (const T of boxes) {
        for (const m of marks(M, a)) for (const t of marks(T, a)) {
          if (Math.abs(t - m) > eps) continue;
          const k = Math.round(m / eps);
          const l = at.get(k) || { axis: a, v: m, lo: M[olo], hi: M[ohi] };
          l.lo = Math.min(l.lo, T[olo]); l.hi = Math.max(l.hi, T[ohi]);
          at.set(k, l);
        }
      }
      lines.push(...at.values());
      // the gaps: M's own to each side, and any in its row as big as one of them
      const row = boxes.filter(T => level(M, T, a));
      if (!row.length) continue;
      const all = rowGaps(row.concat([M]), a);
      const own = all.filter(p => p.a === M || p.b === M);
      const sizes = own.map(p => p.g);
      const same = all.filter(p => sizes.some(g => Math.abs(p.g - g) <= eps * 4));
      if (same.length < 2) continue;
      for (const p of same) gaps.push({ axis: a, from: p.a[AX[a].hi], to: p.b[AX[a].lo], at: (Math.max(p.a[olo], p.b[olo]) + Math.min(p.a[ohi], p.b[ohi])) / 2, g: p.g });
    }
    return { lines, gaps };
  }

  /** a distance as a label: in the board's own units if it has been given a scale (cad.js) */
  function fmt(scene, v) {
    if (D.cad && D.cad.fmtLen && scene && scene.meta && scene.meta.scale) {
      try { return D.cad.fmtLen(scene, v); } catch (_) { }
    }
    return String(Math.round(v));
  }

  /** the guides, in screen space on the live layer: lines, and each equal gap with its size */
  function paint(r, f, app) {
    if (!f || (!f.lines.length && !f.gaps.length)) return;
    const ctx = r.liveScreen(), cam = app.camera;
    const S = (x, y) => cam.toScreen(x, y);
    ctx.save();
    ctx.strokeStyle = COLOUR; ctx.fillStyle = COLOUR; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath();
    for (const l of f.lines) {
      const p = l.axis === 'x' ? S(l.v, l.lo) : S(l.lo, l.v), q = l.axis === 'x' ? S(l.v, l.hi) : S(l.hi, l.v);
      if (l.axis === 'x') { const x = Math.round(p.x) + 0.5; ctx.moveTo(x, p.y - 6); ctx.lineTo(x, q.y + 6); }
      else { const y = Math.round(p.y) + 0.5; ctx.moveTo(p.x - 6, y); ctx.lineTo(q.x + 6, y); }
    }
    ctx.stroke();
    ctx.font = '600 11px ' + (D.FONT_STACK || 'system-ui, sans-serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const g of f.gaps) {
      const p = g.axis === 'x' ? S(g.from, g.at) : S(g.at, g.from), q = g.axis === 'x' ? S(g.to, g.at) : S(g.at, g.to);
      const len = g.axis === 'x' ? q.x - p.x : q.y - p.y;
      if (len < 4) continue;
      ctx.beginPath();
      if (g.axis === 'x') {
        const y = Math.round(p.y) + 0.5;
        ctx.moveTo(p.x, y); ctx.lineTo(q.x, y);
        ctx.moveTo(p.x + 0.5, y - 4); ctx.lineTo(p.x + 0.5, y + 4); ctx.moveTo(q.x - 0.5, y - 4); ctx.lineTo(q.x - 0.5, y + 4);
      } else {
        const x = Math.round(p.x) + 0.5;
        ctx.moveTo(x, p.y); ctx.lineTo(x, q.y);
        ctx.moveTo(x - 4, p.y + 0.5); ctx.lineTo(x + 4, p.y + 0.5); ctx.moveTo(x - 4, q.y - 0.5); ctx.lineTo(x + 4, q.y - 0.5);
      }
      ctx.stroke();
      // the size, in a pill on the middle of the gap, if there is room for it
      const label = fmt(app.scene, g.g), tw = ctx.measureText(label).width + 10;
      if (len < tw + 6 && g.axis === 'x') continue;
      const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - tw / 2, cy - 8, tw, 16, 8); else ctx.rect(cx - tw / 2, cy - 8, tw, 16);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, cx, cy + 0.5);
      ctx.fillStyle = COLOUR;
    }
    ctx.restore();
  }

  D.guides = { targets, snap, edge, found, paint, tolerance, rowGaps, COLOUR };
})(window.DPO);

/* ── cad.js ── engineering drawing ────────────────────────────────────
   What turns the board into somewhere to draw a free-body diagram or
   take a measurement off a scanned drawing:

     the drawing scale   a board-wide "1 unit on the board = k mm", kept
                         in the document (Scene.meta), so it saves with
                         the board and undoes like an edit. Calibrated
                         from a line of known length.
     snapping            to ends, midpoints, centres, quadrant points,
                         intersections and the edges of things, then 15°
                         steps, then the grid — with a marker showing
                         what it caught. Used by the shape tool, the line
                         handles, dimensions and the measure tool.
     readouts            length and angle beside the pen as you draw.
     dimensions          an item type (D.ext.items.dim): linear, angular,
                         radius and diameter, formatted in board units.
                         Attached to snap points, they follow the drawing.
     measuring (M)       a readout that leaves nothing on the board unless
                         you pin it.

   It plugs in through D.ext (js/ext.js). The core knows lines, arrows,
   attachments and the scene's meta; everything that is about units and
   dimensions is here.                                                  */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;
  const CAD = {};
  D.cad = CAD;
  let APP = null;                       // the app, once a tool has been made for it

  /* ── units and scale ──────────────────────────────────────────────── */
  /** millimetres in one of each unit */
  const MM = { mm: 1, cm: 10, m: 1000, km: 1e6, in: 25.4, ft: 304.8 };
  /* A board unit at 100% zoom is a CSS pixel, which a printed page puts
     at 1/96 inch. That is what "1 : 50" is measured against. */
  const PAPER_MM = 25.4 / 96;
  const DEFAULT_SCALE = { unit: 'mm', k: 1, prec: 1, units: true };

  CAD.MM = MM;
  CAD.PAPER_MM = PAPER_MM;

  /** the board's scale: { unit, k (units per board unit), prec, units (shown on dimensions) } */
  CAD.scaleOf = scene => {
    const s = scene && scene.meta && scene.meta.scale;
    return s ? { ...DEFAULT_SCALE, ...s } : DEFAULT_SCALE;
  };

  /** k for "the board at 100% is a drawing at 1 : n" */
  CAD.kFromRatio = (n, unit) => n * PAPER_MM / MM[unit];
  /** the n in 1 : n that a scale amounts to */
  CAD.ratioOf = s => s.k * MM[s.unit] / PAPER_MM;
  /** the same physical scale in another unit */
  CAD.convertK = (k, from, to) => k * MM[from] / MM[to];
  /** k from a line `world` board units long that is really `real` (in the scale's unit) */
  CAD.calibrate = (world, real) => (world > 0 && real > 0 ? real / world : NaN);

  /** change the board's scale, as one step that undo takes back */
  CAD.setScale = (app, patch) => {
    const next = { ...CAD.scaleOf(app.scene), ...patch };
    const plain = Object.keys(DEFAULT_SCALE).every(k => next[k] === DEFAULT_SCALE[k]);
    app.scene.begin('scale');
    app.scene.setMeta('scale', plain ? null : next);
    app.scene.commit();
    app.afterEdit();
  };

  /* ── numbers ──────────────────────────────────────────────────────── */
  const num = (v, prec) => {
    const s = (Math.abs(v) < 1e-9 ? 0 : v).toFixed(prec);
    return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
  };
  CAD.num = num;

  /** a board length as text in the board's units: "250.0 mm" */
  CAD.fmtLen = (scene, world, opt = {}) => {
    const s = CAD.scaleOf(scene);
    const v = num(world * s.k, opt.prec ?? s.prec);
    return opt.bare ? v : v + ' ' + s.unit;
  };
  CAD.fmtArea = (scene, world2) => {
    const s = CAD.scaleOf(scene);
    return num(world2 * s.k * s.k, s.prec) + ' ' + s.unit + '²';
  };
  /** an angle in degrees as text: "30.0°" */
  CAD.fmtAng = (deg, prec = 1) => num(deg, Math.min(prec, 2)) + '°';

  /** the direction from a to b in degrees, anticlockwise from east (y up, as on paper): 0–360 */
  CAD.angleOf = (dx, dy) => {
    const a = Math.atan2(-dy, dx) * 180 / Math.PI;
    return a < 0 ? a + 360 : a + 0;            // + 0: never -0
  };

  /**
   * Read a number typed into a field, in `unit`: "250", "2.5 m" (converted),
   * "1200/4", "3*(20+5) mm", "10'6"" is not attempted. NaN if it is not a
   * number. Units are only understood when `unit` is a length unit.
   */
  CAD.parse = (text, unit) => {
    const src = String(text).trim().replace(/,/g, '.').replace(/[°]/g, '');
    let i = 0;
    const peek = () => src[i], ws = () => { while (src[i] === ' ') i++; };
    function expr() {
      let v = term();
      for (ws(); peek() === '+' || peek() === '-'; ws()) { const op = src[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
      return v;
    }
    function term() {
      let v = factor();
      for (ws(); peek() === '*' || peek() === '/' || peek() === '×'; ws()) { const op = src[i++]; const r = factor(); v = op === '/' ? v / r : v * r; }
      return v;
    }
    function factor() {
      ws();
      if (peek() === '-') { i++; return -factor(); }
      if (peek() === '+') { i++; return factor(); }
      if (peek() === '(') { i++; const v = expr(); ws(); if (peek() !== ')') throw 0; i++; return unitOf(v); }
      const m = /^\d*\.?\d+(e[-+]?\d+)?/i.exec(src.slice(i));
      if (!m) throw 0;
      i += m[0].length;
      return unitOf(parseFloat(m[0]));
    }
    // a unit straight after a number converts it into the field's unit
    function unitOf(v) {
      ws();
      const m = /^(mm|cm|km|m|in|ft|")/.exec(src.slice(i));
      if (!m || !MM[unit]) return v;
      i += m[0].length;
      const u = m[0] === '"' ? 'in' : m[0];
      return v * MM[u] / MM[unit];
    }
    try {
      if (!src) return NaN;
      const v = expr();
      ws();
      return i === src.length && isFinite(v) ? v : NaN;
    } catch (_) { return NaN; }
  };

  /* ── snapping ─────────────────────────────────────────────────────── */
  const SNAP_WEIGHT = { end: 0, int: 0.05, centre: 0.15, mid: 0.15, quad: 0.15 };
  const SNAP_LABEL = { end: 'end', mid: 'midpoint', centre: 'centre', quad: 'quadrant', int: 'intersection', on: 'on', grid: 'grid' };

  /** screen px within which a snap is caught: more for a finger or a pen */
  CAD.reach = app => (app.coarse ? 22 : 12);

  /** the grid step on screen now, as the painter draws it (Renderer.drawGrid) */
  CAD.gridStep = zoom => {
    let step = 25;
    while (step * zoom < 14) step *= 4;
    while (step * zoom > 90) step /= 2;
    return step;
  };

  const XT = () => D.ext.items;
  const snappable = it => it.type !== 'dim' && !(XT()[it.type] && XT()[it.type].snaps === false);

  /**
   * Where a point at (x, y) should land: { x, y, t, ref, label }.
   *
   * In order: a point on something (an end or corner, an intersection, a
   * centre, a midpoint, a quadrant point), then a point on an edge of
   * something, then a 15° step from `o.from`, then the grid. `t` names
   * what caught it (null for nothing) and `ref` is an attachment to the
   * thing it caught, when that thing can be attached to — ink cannot.
   *
   * o: { from: {x, y}, skip: Set of ids, force15 }.
   */
  CAD.snap = (app, x, y, o = {}) => {
    const cad = app.opts.cad || {}, zoom = app.camera.zoom;
    const tol = CAD.reach(app) / zoom;
    if (cad.objects !== false) {
      const s = objectSnap(app.scene, x, y, tol, o.skip);
      if (s) return s;
    }
    if (o.from && (cad.angle !== false || o.force15)) {
      const dx = x - o.from.x, dy = y - o.from.y, len = Math.hypot(dx, dy);
      if (len > tol) {
        const a = Math.atan2(-dy, dx) * 180 / Math.PI, step = Math.round(a / 15) * 15;
        // forgiving, not forced: only when already within a few degrees, unless asked
        if (o.force15 || Math.abs(a - step) < 3.5) {
          const r = step * Math.PI / 180, l = o.force15 ? len : dx * Math.cos(r) - dy * Math.sin(r);
          const deg = ((step % 360) + 360) % 360;
          return { x: o.from.x + Math.cos(r) * l, y: o.from.y - Math.sin(r) * l, t: 'angle', label: deg + '°', ref: null };
        }
      }
    }
    if (app.opts.general && app.opts.general.snapGrid) {
      const g = CAD.gridStep(zoom);
      return { x: Math.round(x / g) * g, y: Math.round(y / g) * g, t: 'grid', label: SNAP_LABEL.grid, ref: null };
    }
    return { x, y, t: null, ref: null };
  };

  function objectSnap(scene, x, y, tol, skip) {
    const cand = scene.near(U.box(x - tol, y - tol, x + tol, y + tol))
      .filter(it => snappable(it) && !(skip && skip.has(it.id)));
    if (!cand.length) return null;
    let best = null, score = Infinity;
    const offer = (px, py, t, ref, item) => {
      const d = Math.hypot(px - x, py - y);
      if (d > tol) return;
      const s = d / tol + (SNAP_WEIGHT[t] || 0);
      if (s < score) { score = s; best = { x: px, y: py, t, ref, item, label: SNAP_LABEL[t] }; }
    };
    for (const it of cand) {
      const pts = scene.snapPoints(it);
      for (const p of pts) offer(p.x, p.y, p.t, pts.ink ? null : { id: it.id, k: p.k }, it);
    }
    // where two things cross
    for (const p of crossings(scene, cand, x, y, tol)) offer(p.x, p.y, 'int', null, null);
    if (best) return best;
    return edgeSnap(scene, cand, x, y, tol * 0.7);
  }

  /** the segments of things' outlines that pass within `tol`, and where pairs of them cross */
  function crossings(scene, cand, x, y, tol) {
    const segs = [], t2 = tol * tol;
    for (const it of cand) {
      if (it.type !== 'shape' && it.type !== 'edge') continue;
      const p = scene.outlineOf(it);
      for (let i = 0; i + 3 < p.length && segs.length < 48; i += 2)
        if (U.distToSegment2(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) < t2) segs.push([it.id, p[i], p[i + 1], p[i + 2], p[i + 3]]);
    }
    const out = [];
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i][0] === segs[j][0]) continue;
        const q = CAD.intersect(segs[i], segs[j]);
        if (q) out.push(q);
      }
    return out;
  }

  /** where two segments [_, x1, y1, x2, y2] cross, or null */
  CAD.intersect = (a, b) => {
    const [, x1, y1, x2, y2] = a, [, x3, y3, x4, y4] = b;
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  };

  /* Anywhere along the edge of a shape, a line or a connector — the
     weakest snap, and the one that lets an arrow end on a box exactly
     where you put it. The attachment it offers stays at that place on
     the thing: a fraction along a line, an angle round an ellipse, a
     fraction of the way across a box. */
  function edgeSnap(scene, cand, x, y, tol) {
    let best = null;
    for (const it of cand) {
      if (it.type !== 'shape' && it.type !== 'edge') continue;
      let hit = null;
      if (it.type === 'shape' && (it.kind === 'ellipse' || it.kind === 'moment')) {
        const A = D.arcOf(it);
        if (!(A.rx > 0 && A.ry > 0)) continue;
        const a = Math.atan2(-(y - A.cy) / A.ry, (x - A.cx) / A.rx), p = D.arcPoint(A, a);
        hit = { x: p.x, y: p.y, d: Math.hypot(p.x - x, p.y - y), ref: { id: it.id, k: '@', a: U.round(a, 5) } };
      } else if (D.isLine(it) || it.type === 'edge') {
        const n = D.nearestAlong(scene.outlineOf(it), x, y);
        hit = { ...n, ref: { id: it.id, k: 't', t: U.round(n.t, 5) } };
      } else {
        const n = D.nearestAlong(scene.outlinePoints(it), x, y), g = D.geomBox(scene, it);
        hit = { ...n, ref: { id: it.id, u: g.w ? U.round((n.x - g.x) / g.w, 5) : 0, v: g.h ? U.round((n.y - g.y) / g.h, 5) : 0 } };
      }
      if (hit.d < tol && (!best || hit.d < best.d)) best = { ...hit, item: it };
    }
    return best && { x: best.x, y: best.y, t: 'on', ref: best.ref, item: best.item, label: SNAP_LABEL.on };
  }

  /* ── on-screen marks ──────────────────────────────────────────────── */
  const UI_FONT = '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';

  /**
   * The marker for what a snap caught, CAD fashion — a square for an end,
   * a triangle for a midpoint, a circle for a centre, a diamond for a
   * quadrant point, a cross for an intersection — with a word beside it,
   * so it is never a guess. A 15° snap draws its guide from `from`.
   */
  CAD.paintSnap = (r, s, from) => {
    if (!s || !s.t) return;
    const app = r.app, cam = app.camera, ctx = r.liveScreen(), tok = r.tokens();
    const p = cam.toScreen(s.x, s.y), k = app.coarse ? 8 : 6;
    ctx.save();
    ctx.strokeStyle = tok.accent; ctx.fillStyle = tok.accent; ctx.lineWidth = 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (s.t) {
      case 'end': ctx.rect(p.x - k, p.y - k, k * 2, k * 2); break;
      case 'mid': ctx.moveTo(p.x, p.y - k * 1.15); ctx.lineTo(p.x + k * 1.1, p.y + k * .8); ctx.lineTo(p.x - k * 1.1, p.y + k * .8); ctx.closePath(); break;
      case 'centre': ctx.arc(p.x, p.y, k, 0, 6.2832); ctx.moveTo(p.x + 1.5, p.y); ctx.arc(p.x, p.y, 1.5, 0, 6.2832); break;
      case 'quad': ctx.moveTo(p.x, p.y - k * 1.2); ctx.lineTo(p.x + k * 1.2, p.y); ctx.lineTo(p.x, p.y + k * 1.2); ctx.lineTo(p.x - k * 1.2, p.y); ctx.closePath(); break;
      case 'int': ctx.moveTo(p.x - k, p.y - k); ctx.lineTo(p.x + k, p.y + k); ctx.moveTo(p.x + k, p.y - k); ctx.lineTo(p.x - k, p.y + k); break;
      case 'on': ctx.moveTo(p.x - k, p.y - k); ctx.lineTo(p.x + k, p.y - k); ctx.lineTo(p.x - k, p.y + k); ctx.lineTo(p.x + k, p.y + k); ctx.closePath(); break;
      case 'grid': ctx.moveTo(p.x - k, p.y); ctx.lineTo(p.x + k, p.y); ctx.moveTo(p.x, p.y - k); ctx.lineTo(p.x, p.y + k); break;
      case 'angle': {
        const f = from || (app.tools.shape && app.tools.shape.start);
        if (f) {
          const q = cam.toScreen(f.x, f.y), dx = p.x - q.x, dy = p.y - q.y, l = Math.hypot(dx, dy) || 1;
          ctx.save(); ctx.setLineDash([5, 5]); ctx.globalAlpha = .6; ctx.lineWidth = 1;
          ctx.moveTo(q.x, q.y); ctx.lineTo(p.x + dx / l * 60, p.y + dy / l * 60); ctx.stroke();
          ctx.restore(); ctx.beginPath();
        }
        ctx.arc(p.x, p.y, 3.5, 0, 6.2832); ctx.fill();
        break;
      }
    }
    ctx.stroke();
    if (s.label) {
      ctx.font = `600 11px ${UI_FONT}`;
      const w = ctx.measureText(s.label).width + 10, x = p.x + k + 6, y = p.y + k + 4;
      ctx.fillStyle = tok.panel; ctx.globalAlpha = .92;
      ctx.beginPath(); ctx.roundRect(x, y, w, 17, 5); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = tok.accent; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, x + 5, y + 9);
    }
    ctx.restore();
  };

  /**
   * A readout beside the pen: the first line large, the rest smaller.
   * Above and to the right of the nib, where a right hand does not cover
   * it; it swaps sides at the edges of the window.
   */
  CAD.paintReadout = (r, at, lines) => {
    if (!at || !lines || !lines.length) return;
    const ctx = r.liveScreen(), tok = r.tokens(), big = r.app.coarse ? 16 : 14, small = big - 2;
    ctx.save();
    ctx.font = `600 ${big}px ${UI_FONT}`;
    let w = ctx.measureText(lines[0]).width;
    ctx.font = `${small}px ${UI_FONT}`;
    for (const l of lines.slice(1)) w = Math.max(w, ctx.measureText(l).width);
    w += 20;
    const h = 12 + big + (lines.length - 1) * (small + 5);
    /* The readout is painted on the canvas, under the chrome: keep it out
       from behind the style panel and the top bar. */
    let right = r.w - 8, top = 8;
    const panel = document.getElementById('style'), bar = document.getElementById('topbar');
    // (both are position:fixed, so offsetParent cannot say whether they are shown; a size can)
    if (panel && panel.getBoundingClientRect) { const b = panel.getBoundingClientRect(); if (b.width) right = Math.min(right, b.left - 8); }
    if (bar && bar.getBoundingClientRect) { const b = bar.getBoundingClientRect(); if (b.height && at.sx < b.right + w) top = Math.max(top, b.bottom + 8); }
    let x = at.sx + 26, y = at.sy - 30 - h;
    if (x + w > right) x = at.sx - 26 - w;
    if (y < top) y = at.sy + 30;
    ctx.shadowColor = '#0000002a'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
    ctx.fillStyle = tok.panel;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 9); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = tok.accent; ctx.globalAlpha = .35; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textBaseline = 'top';
    ctx.font = `600 ${big}px ${UI_FONT}`; ctx.fillStyle = U.color('ink');
    ctx.fillText(lines[0], x + 10, y + 7);
    ctx.font = `${small}px ${UI_FONT}`; ctx.fillStyle = tok.muted;
    lines.slice(1).forEach((l, i) => ctx.fillText(l, x + 10, y + 7 + big + 5 + i * (small + 5)));
    ctx.restore();
  };

  /** a polyline's corners while it is being drawn, the last one ringed: tap it to finish */
  CAD.paintVertices = (r, pts) => {
    const ctx = r.liveScreen(), cam = r.app.camera, acc = r.tokens().accent;
    ctx.save(); ctx.fillStyle = acc; ctx.strokeStyle = acc; ctx.lineWidth = 2;
    for (let i = 0; i < pts.length; i += 2) {
      const p = cam.toScreen(pts[i], pts[i + 1]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 6.2832); ctx.fill();
      if (i === pts.length - 2) { ctx.beginPath(); ctx.arc(p.x, p.y, r.app.coarse ? 13 : 9, 0, 6.2832); ctx.stroke(); }
    }
    ctx.restore();
  };

  /** what to say about a line from a to b while drawing it */
  CAD.lineReadout = (scene, a, b, total) => {
    const dx = b.x - a.x, dy = b.y - a.y, s = CAD.scaleOf(scene);
    const out = [CAD.fmtLen(scene, Math.hypot(dx, dy)) + '   ∠ ' + CAD.fmtAng(CAD.angleOf(dx, dy), s.prec),
      'Δx ' + CAD.fmtLen(scene, dx, { bare: true }) + '   Δy ' + CAD.fmtLen(scene, -dy, { bare: true })];
    if (total != null && Math.abs(total - Math.hypot(dx, dy)) > 1e-6) out.push('Total ' + CAD.fmtLen(scene, total));
    return out;
  };

  /** and about a box w by h */
  CAD.boxReadout = (scene, w, h, kind) => {
    const s = CAD.scaleOf(scene);
    if (kind === 'ellipse' && Math.abs(w - h) < 1e-6) return ['Ø ' + CAD.fmtLen(scene, w)];
    return [num(w * s.k, s.prec) + ' × ' + num(h * s.k, s.prec) + ' ' + s.unit];
  };

  /* ── dimensions ───────────────────────────────────────────────────────
     A dimension is an item of its own (type 'dim'):
       kind     'linear' | 'angle' | 'radius' | 'diameter'
       orient   for linear: 'aligned' | 'h' | 'v'
       p        its defining points [{x, y, ref?}, …]: the two measured
                points; the vertex and a point on each arm; the centre and
                a point on the circle. A point with a `ref` is attached
                (Scene.anchor) and follows what it is attached to; x, y
                are where it last was (Scene._settle keeps them current).
       off      linear: how far the dimension line stands off the points;
                angle: the arc's radius; radius/diameter: how far past the
                circle the leader runs before the text
       text     '' for the measured value; anything else replaces it, and
                '<>' in it stands for the value ("2× <>")
       reflex   angle: measure the outside of the angle
       ends     filled | open | tick | dot
       color, size (line weight), textSize, alpha                       */
  const mctx = document.createElement('canvas').getContext('2d');

  CAD.makeDim = o => Object.assign({ id: U.uid(), type: 'dim', kind: 'linear', orient: 'aligned', p: [], off: 0, text: '', color: 'ink', size: 1.25, textSize: 14, ends: 'filled', alpha: 1 }, o);

  /** a dimension's points, wherever their attachments put them now */
  const dimPoints = (it, scene) => it.p.map(q => (q.ref && scene && scene.anchor(q.ref)) || { x: q.x, y: q.y });

  /** the measured value: board units for a length, degrees for an angle */
  CAD.dimValue = (it, scene) => {
    const P = dimPoints(it, scene);
    if (it.kind === 'angle') return angleBetween(P, it.reflex).deg;
    if (it.kind === 'radius') return U.dist(P[0].x, P[0].y, P[1].x, P[1].y);
    if (it.kind === 'diameter') return 2 * U.dist(P[0].x, P[0].y, P[1].x, P[1].y);
    return linearFrame(it, P).len;
  };

  /** the text a dimension shows */
  CAD.dimText = (it, scene) => {
    const v = CAD.dimValue(it, scene), s = CAD.scaleOf(scene);
    let auto;
    if (it.kind === 'angle') auto = CAD.fmtAng(v, s.prec);
    else {
      auto = num(v * s.k, s.prec) + (s.units ? ' ' + s.unit : '');
      if (it.kind === 'radius') auto = 'R' + auto;
      if (it.kind === 'diameter') auto = 'Ø' + auto;
    }
    if (!it.text) return auto;
    return it.text.includes('<>') ? it.text.replace(/<>/g, auto) : it.text;
  };

  function angleBetween(P, reflex) {
    const [V, A, B] = P;
    const ta = Math.atan2(A.y - V.y, A.x - V.x), tb = Math.atan2(B.y - V.y, B.x - V.x);
    let d = tb - ta;
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    if (reflex) d = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
    return { from: ta, sweep: d, deg: Math.abs(d) * 180 / Math.PI };
  }

  /* A linear dimension's frame: along the measurement (d), across it (n),
     and the two ends of the dimension line, A and B. Horizontal and
     vertical dimensions measure along x or y whatever the points' slope. */
  function linearFrame(it, P) {
    const [P0, P1] = P;
    let d;
    if (it.orient === 'h') d = { x: Math.sign(P1.x - P0.x) || 1, y: 0 };
    else if (it.orient === 'v') d = { x: 0, y: Math.sign(P1.y - P0.y) || 1 };
    else { const l = U.dist(P0.x, P0.y, P1.x, P1.y) || 1; d = { x: (P1.x - P0.x) / l, y: (P1.y - P0.y) / l }; }
    const n = { x: d.y, y: -d.x };
    const len = (P1.x - P0.x) * d.x + (P1.y - P0.y) * d.y;
    const A = { x: P0.x + n.x * it.off, y: P0.y + n.y * it.off };
    const B = { x: A.x + d.x * len, y: A.y + d.y * len };
    return { d, n, len: Math.abs(len), A, B };
  }

  /**
   * Everything a dimension paints, in world units: `lines` (polylines,
   * stroked at its weight), `heads` (as Renderer's headGeom gives them),
   * `text` {x, y, ang, s, align} and `box`. Shared by the canvas, the SVG
   * export, hit-testing and the bbox, and cached in _path against where
   * its points are and the board's scale.
   */
  function dimGeom(it, scene) {
    const P = dimPoints(it, scene);
    const key = P.map(p => p.x + ',' + p.y).join(';') + '|' + (scene ? scene.metaRev : 0);
    if (it._path && it._path.key === key) return it._path;
    const ts = it.textSize || 14, size = it.size || 1.25;
    const hl = ts * 0.8, gap = ts * 0.25, over = ts * 0.45;
    const head = (x, y, ang) => D.headGeom(it.ends || 'filled', x, y, ang, size, hl / D.headLen(size, 1), 0.2);
    const s = CAD.dimText(it, scene);
    mctx.font = `${ts}px ${D.FONT_STACK}`;
    const tw = mctx.measureText(s).width;
    const lines = [], heads = [];
    /** @type {any} where the words go; given its middle (cx, cy, hw, hh) once placed */
    let text;
    const ext = (p, q) => {
      const l = U.dist(p.x, p.y, q.x, q.y);
      if (l < gap * 1.5) return;
      const ux = (q.x - p.x) / l, uy = (q.y - p.y) / l;
      lines.push([p.x + ux * gap, p.y + uy * gap, q.x + ux * over, q.y + uy * over]);
    };

    if (it.kind === 'linear') {
      const F = linearFrame(it, P), { A, B, d, n } = F;
      ext(P[0], A); ext(P[1], B);
      if (F.len > hl * 2.4) {
        lines.push([A.x, A.y, B.x, B.y]);
        heads.push(head(A.x, A.y, Math.atan2(A.y - B.y, A.x - B.x)), head(B.x, B.y, Math.atan2(B.y - A.y, B.x - A.x)));
      } else {
        // too short for the arrows to sit inside: they come in from outside
        lines.push([A.x - d.x * hl * 2, A.y - d.y * hl * 2, B.x + d.x * hl * 2, B.y + d.y * hl * 2]);
        heads.push(head(A.x, A.y, Math.atan2(B.y - A.y, B.x - A.x)), head(B.x, B.y, Math.atan2(A.y - B.y, A.x - B.x)));
      }
      // the text sits above the line and reads from the bottom or the right, never upside down
      // (an upright one reads from the right, rising, as drawings do)
      let ang = Math.atan2(B.y - A.y, B.x - A.x);
      if (ang > Math.PI / 2 - 1e-6) ang -= Math.PI; else if (ang <= -Math.PI / 2 - 1e-6) ang += Math.PI;
      const up = { x: Math.sin(ang), y: -Math.cos(ang) };
      const lift = ts * 0.4;
      text = { x: (A.x + B.x) / 2 + up.x * lift, y: (A.y + B.y) / 2 + up.y * lift, ang, s, w: tw, h: ts };
      void n;
    } else if (it.kind === 'angle') {
      const V = P[0], g = angleBetween(P, it.reflex), r = Math.max(it.off || 0, ts);
      const arc = [];
      const steps = Math.max(8, Math.ceil(Math.abs(g.sweep) / 0.08));
      for (let i = 0; i <= steps; i++) { const t = g.from + g.sweep * i / steps; arc.push(V.x + Math.cos(t) * r, V.y + Math.sin(t) * r); }
      lines.push(arc);
      // extension lines along an arm the arc reaches past
      for (const [Q, t] of [[P[1], g.from], [P[2], g.from + g.sweep]]) {
        const lq = U.dist(V.x, V.y, Q.x, Q.y);
        if (r > lq + gap) lines.push([Q.x + Math.cos(t) * gap, Q.y + Math.sin(t) * gap, V.x + Math.cos(t) * (r + over), V.y + Math.sin(t) * (r + over)]);
      }
      const dir = Math.sign(g.sweep) || 1, k = Math.min(hl / r, Math.abs(g.sweep) / 2.5);
      const tip = t => ({ x: V.x + Math.cos(t) * r, y: V.y + Math.sin(t) * r });
      const a0 = tip(g.from), a1 = tip(g.from + g.sweep), b0 = tip(g.from + dir * k), b1 = tip(g.from + g.sweep - dir * k);
      heads.push(head(a0.x, a0.y, Math.atan2(a0.y - b0.y, a0.x - b0.x)), head(a1.x, a1.y, Math.atan2(a1.y - b1.y, a1.x - b1.x)));
      const mid = g.from + g.sweep / 2, tr = r + ts * 0.9;
      text = { x: V.x + Math.cos(mid) * tr, y: V.y + Math.sin(mid) * tr + ts * 0.35, ang: 0, s, w: tw, h: ts, centred: true };
    } else {
      const C = P[0], Q = P[1], R = U.dist(C.x, C.y, Q.x, Q.y) || 1;
      const u = { x: (Q.x - C.x) / R, y: (Q.y - C.y) / R };
      const run = Math.max(it.off || 0, 0) + hl * 1.6;
      const T = { x: Q.x + u.x * run, y: Q.y + u.y * run };
      const side = u.x >= 0 ? 1 : -1, shoulder = ts * 0.6;
      const start = it.kind === 'diameter' ? { x: C.x - u.x * R, y: C.y - u.y * R } : C;
      lines.push([start.x, start.y, T.x, T.y, T.x + side * shoulder, T.y]);
      heads.push(head(Q.x, Q.y, Math.atan2(u.y, u.x)));
      if (it.kind === 'diameter') heads.push(head(start.x, start.y, Math.atan2(-u.y, -u.x)));
      text = { x: T.x + side * (shoulder + 3) + (side < 0 ? -tw : 0) + tw / 2, y: T.y + ts * 0.35, ang: 0, s, w: tw, h: ts, centred: true };
    }

    // the outline the lasso and the eraser go by, and the box
    const outline = [];
    for (const l of lines) outline.push(...l);
    // the middle of the text: a little above its baseline, whichever way it is turned
    const c = Math.cos(text.ang), sn = Math.sin(text.ang), hw = text.w / 2 + 2, hh = ts * 0.6;
    const tc = { x: text.x + sn * ts * 0.35, y: text.y - c * ts * 0.35 };
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => [tc.x + a * c - b * sn, tc.y + a * sn + b * c]);
    let box = U.boxFromPoints([...outline, ...corners.flat()], 2, size + hl * 0.5);
    text.cx = tc.x; text.cy = tc.y; text.hw = hw; text.hh = hh;
    return it._path = { key, lines, heads, text, outline, box };
  }
  CAD.dimGeom = dimGeom;

  function drawDim(ctx, it, r) {
    const g = dimGeom(it, r.app.scene), col = U.color(it.color || 'ink');
    ctx.strokeStyle = col; ctx.lineWidth = it.size || 1.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const l of g.lines) { ctx.moveTo(l[0], l[1]); for (let i = 2; i < l.length; i += 2) ctx.lineTo(l[i], l[i + 1]); }
    ctx.stroke();
    D.paintHeads(ctx, g.heads, col, it.size || 1.25);
    const t = g.text;
    ctx.save();
    ctx.translate(t.x, t.y); ctx.rotate(t.ang);
    ctx.font = `${it.textSize || 14}px ${D.FONT_STACK}`;
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(t.s, 0, 0);
    ctx.restore();
  }

  function svgDim(it, r) {
    const g = dimGeom(it, r.app.scene), col = U.color(it.color || 'ink'), R = v => U.round(v, 2);
    const d = g.lines.map(l => 'M' + R(l[0]) + ',' + R(l[1]) + l.slice(2).map((v, i) => (i % 2 ? ',' : 'L') + R(v)).join('')).join('');
    const t = g.text, deg = R(t.ang * 180 / Math.PI);
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${it.size || 1.25}" stroke-linecap="round" stroke-linejoin="round"/>` +
      D.svgHeads(g.heads, col, it.size || 1.25) +
      `<text x="${R(t.x)}" y="${R(t.y)}"${deg ? ` transform="rotate(${deg} ${R(t.x)} ${R(t.y)})"` : ''} text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${it.textSize || 14}" fill="${col}">${U.escapeXml(t.s)}</text>`;
  }

  function hitDim(it, x, y, tol, scene) {
    const g = dimGeom(it, scene), w = (it.size || 1.25) / 2 + tol;
    for (const l of g.lines) if (U.pointNearPolyline(x, y, l, w)) return true;
    for (const h of g.heads) if (h && h.fill) for (const p of h.fill) if (U.pointInPolygon(x, y, p)) return true;
    const t = g.text, c = Math.cos(-t.ang), s = Math.sin(-t.ang), dx = x - t.cx, dy = y - t.cy;
    return Math.abs(dx * c - dy * s) < t.hw + tol && Math.abs(dx * s + dy * c) < t.hh + tol;
  }

  /* Moving a dimension: points that are free move; attached ones stay with
     what they are attached to. One attached only to things that are not
     moving has nothing to move, so dragging it moves its dimension line
     (or arc, or leader) instead — the way to tidy a dimension away from
     the drawing. `moving` (from the select tool) is the set of ids being
     moved; a copy or a paste moves its attachments' targets with it. */
  function translateDim(it, dx, dy, moving) {
    const free = it.p.filter(q => !q.ref);
    for (const q of free) { q.x += dx; q.y += dy; }
    if (free.length || !moving || it.p.length < 2 || it.p.some(q => moving.has(q.ref.id))) return;
    const P = it.p;
    if (it.kind === 'linear') { const F = linearFrame(it, P); it.off += dx * F.n.x + dy * F.n.y; }
    else if (it.kind === 'angle') {
      const g = angleBetween(P, it.reflex), m = g.from + g.sweep / 2;
      it.off = Math.max(10, (it.off || 0) + dx * Math.cos(m) + dy * Math.sin(m));
    } else {
      const R = U.dist(P[0].x, P[0].y, P[1].x, P[1].y) || 1;
      it.off = Math.max(0, (it.off || 0) + (dx * (P[1].x - P[0].x) + dy * (P[1].y - P[0].y)) / R);
    }
  }

  function scaleDim(it, o, sx, sy) {
    for (const q of it.p) if (!q.ref) { q.x = o.x + (q.x - o.x) * sx; q.y = o.y + (q.y - o.y) * sy; }
    it.off = (it.off || 0) * (Math.abs(sx) + Math.abs(sy)) / 2 * (sx * sy < 0 && it.kind === 'linear' ? -1 : 1);
  }

  /** bring an attached dimension's stored points up to where it is drawn (Scene._settle) */
  function settleDim(it, scene) {
    const now = it.p.map(q => q.ref ? scene.anchor(q.ref) : null);
    if (!now.some((p, i) => p && (Math.abs(p.x - it.p[i].x) + Math.abs(p.y - it.p[i].y) > 1e-6))) return;
    scene.touch(it);
    now.forEach((p, i) => { if (p) { it.p[i].x = p.x; it.p[i].y = p.y; } });
  }

  D.ext.items.dim = {
    label: 'Dimension',
    bbox: (it, scene) => { const b = dimGeom(it, scene).box; return { x: b.x, y: b.y, w: b.w, h: b.h }; },
    draw: drawDim,
    svg: svgDim,
    hit: hitDim,
    outline: (it, scene) => dimGeom(it, scene).outline,
    translate: translateDim,
    scale: scaleDim,
    solid: false,
    erasable: true,                     // rubbed out like a line
    snaps: false,                       // nothing to snap to on a dimension
    refs: it => it.p.filter(q => q.ref).map(q => q.ref),
    detach: (it, id) => { for (const q of it.p) if (q.ref && q.ref.id === id) delete q.ref; },
    settle: settleDim,
    edit: (app) => { if (app.ui) { app.ui.buildPanel(); app.ui.focusField('dim-text'); } },
    panel: (ui, items) => panelDimSel(ui, items)
  };

  /* ── a dimension from a gesture ───────────────────────────────────── */
  /** pick horizontal, vertical or aligned from how a drag went, as AutoCAD's linear dimension does */
  CAD.orientFor = (a, b) => {
    const ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) * 180 / Math.PI;
    if (ang < 10 || ang > 170) return 'h';
    if (Math.abs(ang - 90) < 10) return 'v';
    return 'aligned';
  };

  /** a point for a dimension: where a snap put it, attached if it caught something that can be */
  const dimPoint = s => s.ref ? { x: s.x, y: s.y, ref: s.ref } : { x: s.x, y: s.y };

  /** dimension a line or a circle in one go (a tap with the dimension tool, or "Dimension this") */
  CAD.dimensionOf = (app, it, at) => {
    const o = app.opts.dim || {}, scene = app.scene, z = app.camera.zoom;
    const base = { color: o.color || 'ink', size: o.size || 1.25, textSize: o.textSize || 14, ends: o.ends || 'filled' };
    if (D.isLine(it) && !it.via) {
      const [a, b] = scene.lineEnds(it);
      const orient = o.mode === 'h' || o.mode === 'v' ? o.mode : 'aligned';
      const dim = CAD.makeDim({ ...base, kind: 'linear', orient, p: [{ x: a.x, y: a.y, ref: { id: it.id, k: 'p0' } }, { x: b.x, y: b.y, ref: { id: it.id, k: 'p1' } }] });
      dim.off = 30 / Math.max(z, 0.2) * (at ? Math.sign(placeOff(dim, scene, at)) || 1 : 1);
      return dim;
    }
    if (it.type === 'shape' && (it.kind === 'ellipse' || it.kind === 'moment')) {
      const A = D.arcOf(it);
      const a = at ? Math.atan2(-(at.y - A.cy), at.x - A.cx) : Math.PI / 4;
      const q = D.arcPoint(A, a);
      return CAD.makeDim({ ...base, kind: o.mode === 'radius' ? 'radius' : 'diameter',
        p: [{ x: A.cx, y: A.cy, ref: { id: it.id, k: 'c' } }, { x: q.x, y: q.y, ref: { id: it.id, k: '@', a: U.round(a, 5) } }], off: 0 });
    }
    return null;
  };

  /** the offset that puts a linear dimension's line through `at` */
  function placeOff(it, scene, at) {
    const P = dimPoints(it, scene), F = linearFrame({ ...it, off: 0 }, P);
    return (at.x - P[0].x) * F.n.x + (at.y - P[0].y) * F.n.y;
  }

  function addDim(app, dim) {
    app.scene.begin('dimension'); app.scene.add(dim); app.scene.commit();
    app.afterEdit();
  }

  /* ══ dimension tool ═══════════════════════════════════════════════════
     Linear: drag from one point to the other, lift, then put the line
     where it should stand — with a pen hovering it follows the nib and a
     tap places it; with a finger, press where it goes (and drag to
     adjust). A tap on a line dimensions it outright, a tap on a circle
     gives its diameter (or radius). Angle: drag from the vertex along one
     arm, lift, then press on the other arm. Every point snaps. */
  class DimTool {
    constructor(app) { this.app = app; APP = app; this.reset(); }
    get opt() { return this.app.opts.dim; }
    reset() { this.phase = 0; this.dim = null; this.s = null; this.a = null; this.dragged = false; }

    snap(ev, from) { return CAD.snap(this.app, ev.x, ev.y, { from, force15: ev.shift }); }

    down(ev) {
      const app = this.app, mode = this.opt.mode;
      this.downAt = { sx: ev.sx, sy: ev.sy };
      this.dragged = false;
      if (this.phase === 0) {
        const s = this.snap(ev);
        this.a = s; this.s = s;
        if (mode === 'radius' || mode === 'diameter') {
          const hit = app.scene.hitTest(ev.x, ev.y, CAD.reach(app) / app.camera.zoom, it => it.type === 'shape' && (it.kind === 'ellipse' || it.kind === 'moment'));
          this.circle = hit || null;
        }
        return;
      }
      // phase 1: the press that places the line (linear), or picks the other arm (angle)
      this.move(ev);
    }

    move(ev) {
      const app = this.app, scene = app.scene, mode = this.opt.mode;
      if (Math.hypot(ev.sx - (this.downAt ? this.downAt.sx : ev.sx), ev.sy - (this.downAt ? this.downAt.sy : ev.sy)) > 4) this.dragged = true;
      if (this.phase === 0) {
        if (!app.active) return;
        if ((mode === 'radius' || mode === 'diameter') && this.circle) {
          const c = this.circle, A = D.arcOf(c), a = Math.atan2(-(ev.y - A.cy), ev.x - A.cx), q = D.arcPoint(A, a);
          const out = Math.max(0, U.dist(ev.x, ev.y, A.cx, A.cy) - U.dist(q.x, q.y, A.cx, A.cy));
          this.dim = CAD.makeDim({ ...this.style(), kind: mode, off: out,
            p: [{ x: A.cx, y: A.cy, ref: { id: c.id, k: 'c' } }, { x: q.x, y: q.y, ref: { id: c.id, k: '@', a: U.round(a, 5) } }] });
        } else {
          const s = this.s = this.snap(ev, this.a);
          const kind = mode === 'angle' ? 'angle' : mode === 'radius' || mode === 'diameter' ? mode : 'linear';
          if (kind === 'angle') this.dim = null;
          else this.dim = CAD.makeDim({ ...this.style(), kind, orient: this.orient(this.a, s), p: [dimPoint(this.a), dimPoint(s)], off: 0 });
        }
      } else if (this.phase === 1 && this.dim) {
        if (this.dim.kind === 'linear') {
          this.dim.off = placeOff(this.dim, scene, ev);
        } else if (this.dim.kind === 'angle') {
          const s = this.s = this.snap(ev, this.dim.p[0]);
          this.dim.p[2] = dimPoint(s);
          const V = this.dim.p[0];
          this.dim.off = Math.max(18 / app.camera.zoom, Math.min(U.dist(V.x, V.y, this.dim.p[1].x, this.dim.p[1].y), U.dist(V.x, V.y, s.x, s.y)) * 0.55);
        }
        this.dim._path = null;
      }
      app.requestDrawLive();
    }

    /* Auto picks by the drag: within 10° of level, horizontal; of upright,
       vertical; anything else is measured along its own slope. */
    orient(a, b) {
      const m = this.opt.mode;
      return m === 'h' || m === 'v' || m === 'aligned' ? m : CAD.orientFor(a, b);
    }

    style() {
      const o = this.opt;
      return { color: o.color || 'ink', size: o.size || 1.25, textSize: o.textSize || 14, ends: o.ends || 'filled' };
    }

    up(ev) {
      const app = this.app, scene = app.scene, mode = this.opt.mode;
      if (this.phase === 0) {
        if (!this.dragged) {
          // a tap: dimension what is under it, if it is a line or a circle
          const hit = scene.hitTest(ev.x, ev.y, CAD.reach(app) / app.camera.zoom, it => (D.isLine(it) && !it.via) || (it.type === 'shape' && (it.kind === 'ellipse' || it.kind === 'moment')));
          const dim = hit && mode !== 'angle' && CAD.dimensionOf(app, hit, ev);
          if (dim && dim.kind === 'linear') { this.dim = dim; this.phase = 1; this.dim.off = placeOff(dim, scene, ev) || dim.off; app.requestDrawLive(); return; }
          if (dim) { addDim(app, dim); this.reset(); return; }
          // otherwise the first point stays put, and the next press is the second
          this.phase = 2;
          app.hint(ev.sx, ev.sy, mode === 'angle' ? 'Now tap along the first arm' : 'Now tap the other end');
          return;
        }
        if (!this.dim && mode !== 'angle') return this.reset();
        if (this.dim && this.dim.kind !== 'linear') { addDim(app, this.dim); return this.reset(); }
        if (mode === 'angle') {
          this.dim = CAD.makeDim({ ...this.style(), kind: 'angle', p: [dimPoint(this.a), dimPoint(this.s), dimPoint(this.s)], off: 0 });
          app.hint(ev.sx, ev.sy, 'Now tap the other arm');
        } else app.hint(ev.sx, ev.sy, 'Tap where the dimension line goes');
        this.phase = 1;
        app.requestDrawLive();
        return;
      }
      if (this.phase === 2) {
        // tap-tap: the second point
        const s = this.snap(ev, this.a);
        app.hideHint();
        if (mode === 'angle') {
          this.dim = CAD.makeDim({ ...this.style(), kind: 'angle', p: [dimPoint(this.a), dimPoint(s), dimPoint(s)], off: 0 });
          app.hint(ev.sx, ev.sy, 'Now tap the other arm');
        } else {
          this.dim = CAD.makeDim({ ...this.style(), kind: 'linear', orient: this.orient(this.a, s), p: [dimPoint(this.a), dimPoint(s)], off: 0 });
          app.hint(ev.sx, ev.sy, 'Tap where the dimension line goes');
        }
        this.phase = 1;
        app.requestDrawLive();
        return;
      }
      // phase 1 ends with the dimension on the board
      app.hideHint();
      if (this.dim && (this.dim.kind !== 'angle' || U.dist(this.dim.p[0].x, this.dim.p[0].y, this.dim.p[2].x, this.dim.p[2].y) > 1)) addDim(app, this.dim);
      this.reset();
      app.requestDrawLive();
    }

    cancel() { this.reset(); this.app.hideHint(); this.app.renderer.clearLive(); }

    paint(r) {
      const app = this.app;
      // between presses, a hovering pen keeps placing the line
      if (this.phase === 1 && !app.active && app.pointer && this.dim) {
        if (this.dim.kind === 'linear') this.dim.off = placeOff(this.dim, app.scene, app.pointer);
        else if (this.dim.kind === 'angle') {
          const s = this.s = this.snap(app.pointer, this.dim.p[0]);
          this.dim.p[2] = dimPoint(s);
          const V = this.dim.p[0];
          this.dim.off = Math.max(18 / app.camera.zoom, Math.min(U.dist(V.x, V.y, this.dim.p[1].x, this.dim.p[1].y), U.dist(V.x, V.y, s.x, s.y)) * 0.55);
        }
        this.dim._path = null;
      }
      const ctx = r.liveWorld();
      if (this.dim) r.drawItem(ctx, this.dim);
      if (this.phase === 0 && app.active && this.a && this.s) {
        ctx.save(); ctx.strokeStyle = r.tokens().accent; ctx.lineWidth = 1.5 / app.camera.zoom; ctx.setLineDash([5 / app.camera.zoom, 4 / app.camera.zoom]);
        ctx.beginPath(); ctx.moveTo(this.a.x, this.a.y); ctx.lineTo(this.s.x, this.s.y); ctx.stroke(); ctx.restore();
      }
      const hover = !app.active && app.pointer && (this.phase !== 1 || (this.dim && this.dim.kind === 'angle'));
      const s = app.active ? this.s : hover ? (this.phase === 1 ? this.s : CAD.snap(app, app.pointer.x, app.pointer.y, this.phase === 2 ? { from: this.a } : {})) : null;
      CAD.paintSnap(r, s, this.a);
      if (this.dim && app.pointer) CAD.paintReadout(r, app.pointer, [CAD.dimText({ ...this.dim, text: '' }, app.scene)]);
    }
  }

  /* ══ measure tool ═════════════════════════════════════════════════════
     A ruler that leaves nothing behind. Distance: drag (or tap, tap)
     between two points. Angle: the vertex, then a point on each arm.
     Path and area: tap the corners, then tap the last one again (or
     press Enter). The result stays on screen, in the style panel too,
     until the next measurement or another tool; "Pin" makes it a
     dimension (or, for a path or an area, a label) on the board. */
  class MeasureTool {
    constructor(app) { this.app = app; APP = app; this.pts = []; this.refs = []; this.done = false; }
    get mode() { return (this.app.opts.measure || {}).mode || 'distance'; }
    need() { return { distance: 2, angle: 3 }[this.mode] || Infinity; }

    clear() { this.pts = []; this.refs = []; this.done = false; this.live = null; this.dragging = false; this.app.hideHint(); }

    /** start a distance from a point, as "Measure from here" does */
    startAt(x, y) {
      const s = CAD.snap(this.app, x, y, {});
      this.clear();
      this.pts = [s.x, s.y]; this.refs = [s.ref || null];
      this.app.requestDrawLive();
    }

    last() { const p = this.pts; return p.length ? { x: p[p.length - 2], y: p[p.length - 1] } : null; }

    down(ev) {
      if (this.done) this.clear();
      const s = CAD.snap(this.app, ev.x, ev.y, { from: this.last(), force15: ev.shift });
      this.downAt = { sx: ev.sx, sy: ev.sy };
      const tol = CAD.reach(this.app) / this.app.camera.zoom, l = this.last();
      // the last point tapped again finishes a path or an area
      if (l && this.need() === Infinity && U.dist(s.x, s.y, l.x, l.y) < tol && this.pts.length >= 4) { this.finish(); return; }
      this.pts.push(s.x, s.y); this.refs.push(s.ref || null);
      this.live = s;
      this.app.requestDrawLive();
    }

    /* A press puts a point down; dragging from it pulls out the next one,
       so press–drag–lift is a whole distance (or an arm of an angle). */
    move(ev) {
      if (!this.app.active || !this.pts.length || this.done || !this.downAt) return;
      if (!this.dragging) {
        if (Math.hypot(ev.sx - this.downAt.sx, ev.sy - this.downAt.sy) < 6) return;
        this.dragging = true;
        this.pts.push(ev.x, ev.y); this.refs.push(null);
      }
      const n = this.pts.length;
      const s = this.live = CAD.snap(this.app, ev.x, ev.y, { from: { x: this.pts[n - 4], y: this.pts[n - 3] }, force15: ev.shift });
      this.pts[n - 2] = s.x; this.pts[n - 1] = s.y; this.refs[this.refs.length - 1] = s.ref || null;
      this.app.requestDrawLive();
    }

    up() {
      this.dragging = false; this.downAt = null;
      if (this.done) return;
      if (this.pts.length / 2 >= this.need()) this.finish();
      else this.app.requestDrawLive();
      if (this.app.ui) this.app.ui.buildPanel();
    }

    finish() {
      this.done = true; this.live = null;
      this.app.requestDrawLive();
      if (this.app.ui) this.app.ui.buildPanel();
    }

    cancel() { this.clear(); this.app.renderer.clearLive(); }

    /** what the measurement amounts to, as lines of text (the first the headline) */
    result(pts = this.pts) {
      const scene = this.app.scene, n = pts.length / 2, mode = this.mode;
      if (n < 2) return null;
      const P = i => ({ x: pts[i * 2], y: pts[i * 2 + 1] });
      if (mode === 'distance') return CAD.lineReadout(scene, P(0), P(1));
      if (mode === 'angle') {
        if (n < 3) return [CAD.fmtLen(scene, U.dist(pts[0], pts[1], pts[2], pts[3]))];
        const g = angleBetween([P(0), P(1), P(2)]);
        return [CAD.fmtAng(g.deg, CAD.scaleOf(scene).prec), 'reflex ' + CAD.fmtAng(360 - g.deg, CAD.scaleOf(scene).prec)];
      }
      const len = U.pathLength(pts);
      if (mode === 'path') return ['Length ' + CAD.fmtLen(scene, len), n - 1 + ' segment' + (n > 2 ? 's' : '')];
      return n >= 3 ? ['Area ' + CAD.fmtArea(scene, CAD.area(pts)), 'Perimeter ' + CAD.fmtLen(scene, len + U.dist(pts[0], pts[1], pts[pts.length - 2], pts[pts.length - 1]))]
        : ['Length ' + CAD.fmtLen(scene, len)];
    }

    /** turn the measurement into something on the board */
    pin() {
      const app = this.app, scene = app.scene, p = this.pts, mode = this.mode, o = app.opts.dim || {};
      if (!this.done) return;
      const pt = i => this.refs[i] ? { x: p[i * 2], y: p[i * 2 + 1], ref: this.refs[i] } : { x: p[i * 2], y: p[i * 2 + 1] };
      const base = { color: o.color || 'ink', size: o.size || 1.25, textSize: o.textSize || 14, ends: o.ends || 'filled' };
      let made;
      if (mode === 'distance') made = CAD.makeDim({ ...base, kind: 'linear', orient: 'aligned', p: [pt(0), pt(1)], off: 24 / app.camera.zoom });
      else if (mode === 'angle') {
        const V = pt(0);
        made = CAD.makeDim({ ...base, kind: 'angle', p: [V, pt(1), pt(2)],
          off: Math.min(U.dist(p[0], p[1], p[2], p[3]), U.dist(p[0], p[1], p[4], p[5])) * 0.55 });
      } else {
        const lines = this.result();
        const b = U.boxFromPoints(p);
        made = D.make.text({ x: b.x + b.w / 2 - 60, y: b.y + b.h / 2 - 12, text: lines[0], color: base.color, size: 16, autoWidth: true, w: 40 });
      }
      scene.begin('pin measurement'); scene.add(made); scene.commit();
      this.clear();
      app.afterEdit();
      app.toast('Pinned to the board');
    }

    paint(r) {
      const app = this.app, ctx = r.liveScreen(), cam = app.camera, acc = r.tokens().accent;
      let pts = this.pts.slice();
      let hoverSnap = null;
      // a hovering pen stretches the next segment out to the nib
      if (!this.done && !app.active && app.pointer) {
        hoverSnap = CAD.snap(app, app.pointer.x, app.pointer.y, { from: this.last() });
        if (pts.length) pts.push(hoverSnap.x, hoverSnap.y);
      }
      if (pts.length >= 2) {
        const S = pts.map((v, i) => i & 1 ? v * cam.zoom + cam.y : v * cam.zoom + cam.x);
        ctx.save();
        ctx.strokeStyle = acc; ctx.fillStyle = acc; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (this.mode === 'area' && S.length >= 6) {
          ctx.globalAlpha = .12; ctx.beginPath(); ctx.moveTo(S[0], S[1]);
          for (let i = 2; i < S.length; i += 2) ctx.lineTo(S[i], S[i + 1]);
          ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.setLineDash([7, 5]);
        ctx.beginPath(); ctx.moveTo(S[0], S[1]);
        for (let i = 2; i < S.length; i += 2) ctx.lineTo(S[i], S[i + 1]);
        if (this.mode === 'area' && this.done) ctx.closePath();
        ctx.stroke(); ctx.setLineDash([]);
        for (let i = 0; i < S.length; i += 2) { ctx.beginPath(); ctx.arc(S[i], S[i + 1], 3.5, 0, 6.2832); ctx.fill(); }
        if (this.mode === 'angle' && S.length >= 6) {
          const g = angleBetween([{ x: S[0], y: S[1] }, { x: S[2], y: S[3] }, { x: S[4], y: S[5] }]);
          ctx.beginPath(); ctx.arc(S[0], S[1], 28, g.from, g.from + g.sweep, g.sweep < 0); ctx.stroke();
        }
        ctx.restore();
        const res = this.result(pts);
        const at = cam.toScreen(pts[pts.length - 2], pts[pts.length - 1]);
        if (res) CAD.paintReadout(r, { sx: at.x, sy: at.y }, this.done ? res : res.slice(0, 2));
      }
      CAD.paintSnap(r, app.active ? this.live : hoverSnap, this.last());
    }
  }

  /** the area of a flat polygon [x,y,…], by the shoelace formula */
  CAD.area = pts => {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i += 2) {
      const j = (i + 2) % n;
      a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
    }
    return Math.abs(a) / 2;
  };

  /* ── style panels ─────────────────────────────────────────────────── */
  const svg = d => `<svg viewBox="0 0 24 24">${d.split('|').map(p => `<path d="${p}"/>`).join('')}</svg>`;
  const ICON = {
    measure: svg('M3.5 15.5l12-12 5 5-12 12z|M7 12l1.6 1.6|M9.5 9.5l2.2 2.2|M12 7l1.6 1.6'),
    dim: svg('M4 6v12|M20 6v12|M4 12h16|M7 9.5L4 12l3 2.5|M17 9.5l3 2.5-3 2.5'),
    angle: svg('M4 19h16|M4 19L16 5|M11 19a7 7 0 0 0-2.2-5.1'),
    radius: svg('M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M12 12l5.6-5.6|M15.4 6.6h2.2v2.2'),
    diameter: svg('M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M6.3 17.7L17.7 6.3'),
    scale: svg('M3 17h18|M5 17v-3|M9 17v-5|M13 17v-3|M17 17v-5|M21 17v-3'),
    pin: svg('M9 4h6l-1 6 3 3H7l3-3z|M12 13v7')
  };
  CAD.ICON = ICON;

  /** the drawing scale, for a style panel: units, scale, precision */
  CAD.scaleGroup = (ui, title = 'Drawing scale') => {
    const app = ui.app, s = CAD.scaleOf(app.scene);
    const ratio = CAD.ratioOf(s);
    return ui.group(title,
      ui.seg(Object.keys(MM).filter(u => u !== 'km').map(u => [u, u]), s.unit, u => {
        CAD.setScale(app, { unit: u, k: CAD.convertK(s.k, s.unit, u) });
      }),
      ui.num('1 board unit =', s.k, {
        unit: s.unit, prec: 6, step: stepFor(s.k), min: 1e-9, id: 'cad-k',
        apply: v => app.scene.setMeta('scale', { ...CAD.scaleOf(app.scene), k: v })
      }),
      ui.num('Scale 1 :', ratio, {
        prec: ratio < 10 ? 2 : 1, step: stepFor(ratio), min: 1e-6,
        apply: v => app.scene.setMeta('scale', { ...CAD.scaleOf(app.scene), k: CAD.kFromRatio(v, CAD.scaleOf(app.scene).unit) })
      }),
      el('div', { class: 'rowlbl' }, el('span', {}, 'Decimals')),
      ui.seg([[0, '0'], [1, '0.0'], [2, '0.00'], [3, '0.000']], s.prec, v => CAD.setScale(app, { prec: v })),
      ui.check('Units on dimensions', s.units, v => CAD.setScale(app, { units: v })),
      el('p', { class: 'cad-note' }, 'To scale a PDF or picture: draw a line over a length you know (or measure it with M), then type its real length under Calibrate.'),
      el('button', { class: 'btn', onclick: () => CAD.setScale(app, { ...DEFAULT_SCALE }) }, 'Reset to 1 unit = 1 mm'));
  };

  /** a step for a stepper on a value of this size: about a tenth of it, rounded to 1, 2 or 5 */
  function stepFor(v) {
    const m = 10 ** Math.floor(Math.log10(Math.abs(v) || 1) - 1);
    return m;
  }
  CAD.stepFor = stepFor;

  /**
   * "This line is really … long": sets the scale from a line of known
   * length. `world` is its length on the board. Pen-friendly: the field
   * takes "2.5 m" as readily as a number, and the button is large.
   */
  CAD.calibrateGroup = (ui, world) => {
    const app = ui.app, s = CAD.scaleOf(app.scene);
    let want = world * s.k;
    const field = ui.num('Its real length', want, { unit: s.unit, prec: s.prec + 2, step: stepFor(want), min: 1e-9, id: 'cad-cal', set: v => { want = v; } });
    return ui.group('Calibrate scale', field,
      el('button', { class: 'btn primary', onclick: () => {
        const k = CAD.calibrate(world, want);
        if (!(k > 0)) return app.toast('Type the length this line really is');
        CAD.setScale(app, { k });
        app.toast(`Scale set: 1 board unit = ${num(k, 4)} ${s.unit}`);
      } }, 'Set scale from this line'));
  };

  /* the dimension and measure tools' own panels */
  function snapGroup(ui) {
    const app = ui.app, c = app.opts.cad, g = app.opts.general;
    return ui.group('Snap',
      ui.check('To points on things', c.objects !== false, v => { c.objects = v; }),
      ui.check('15° steps', c.angle !== false, v => { c.angle = v; }),
      ui.check('To the grid', !!g.snapGrid, v => { g.snapGrid = v; }));
  }
  CAD.snapGroup = snapGroup;

  const END_STYLES = ['filled', 'open', 'tick', 'dot'];

  function panelDimTool(ui) {
    const app = ui.app, o = app.opts.dim;
    ui.add(
      ui.group('Dimension', ui.iconSeg([
        ['auto', ICON.dim, 'Linear — horizontal, vertical or aligned, by how you drag'],
        ['aligned', svg('M5 15L15 5|M8 18L18 8|M5 15l3 3|M15 5l3 3'), 'Aligned'],
        ['angle', ICON.angle, 'Angle'], ['radius', ICON.radius, 'Radius'], ['diameter', ICON.diameter, 'Diameter']
      ], o.mode, v => { o.mode = v; app.tools.dim.cancel(); })),
      ui.group('Ends', ui.iconSeg(END_STYLES.map(k => [k, ui.headIcon(k), k]), o.ends, v => { o.ends = v; })),
      ui.group('Text size', ui.seg([[11, 'S'], [14, 'M'], [18, 'L'], [24, 'XL']], o.textSize, v => { o.textSize = v; })),
      ui.group('Colour', ui.swatches(ui.palette(), o.color, c => { o.color = c; })),
      snapGroup(ui),
      ui.hintText(o.mode === 'angle' ? 'Drag from the corner along one arm, lift, then tap the other arm.'
        : o.mode === 'radius' || o.mode === 'diameter' ? 'Drag out from a circle, or tap one.'
          : 'Drag between two points, lift, then tap where the line goes. Tap a line to dimension it. Points that snap stay attached.'),
      CAD.scaleGroup(ui)
    );
  }

  function panelMeasure(ui) {
    const app = ui.app, o = app.opts.measure, t = app.tools.measure;
    const res = t && t.done ? t.result() : null;
    ui.add(
      ui.group('Measure', ui.seg([['distance', 'Distance'], ['angle', 'Angle'], ['path', 'Path'], ['area', 'Area']], o.mode, v => { o.mode = v; t.clear(); app.requestDrawLive(); })),
      res ? ui.group('Result', el('div', { class: 'cad-result' }, el('b', {}, res[0]), ...res.slice(1).map(l => el('span', {}, l))),
        el('div', { class: 'cad-row' },
          el('button', { class: 'btn primary', onclick: () => t.pin() }, 'Pin to board'),
          el('button', { class: 'btn', onclick: () => { t.clear(); app.requestDrawLive(); ui.buildPanel(); } }, 'Clear'))) : null,
      res && o.mode === 'distance' ? CAD.calibrateGroup(ui, U.dist(t.pts[0], t.pts[1], t.pts[2], t.pts[3])) : null,
      !res ? ui.hintText({ distance: 'Drag between two points — or tap one, then the other.', angle: 'Tap the corner, then a point on each arm.',
        path: 'Tap along the path; tap the last point again (or press Enter) to finish.', area: 'Tap round the outline; tap the last point again (or press Enter) to finish.' }[o.mode]) : null,
      snapGroup(ui),
      CAD.scaleGroup(ui)
    );
  }

  /** a selected dimension, or several */
  function panelDimSel(ui, items) {
    const app = ui.app, it = items[0], one = items.length === 1;
    const attached = it.p.filter(q => q.ref).length;
    ui.add(
      ui.group(one ? { linear: 'Dimension', angle: 'Angle', radius: 'Radius', diameter: 'Diameter' }[it.kind] : items.length + ' dimensions',
        one ? el('div', { class: 'cad-result' }, el('b', {}, CAD.dimText({ ...it, text: '' }, app.scene)),
          el('span', {}, attached ? `Attached at ${attached} point${attached > 1 ? 's' : ''} — follows the drawing` : 'Not attached — stays where it is')) : null,
        ui.swatches(ui.palette(), it.color, c => ui.apply(items, d => { d.color = c; }))),
      one ? ui.group('Text', ui.textField(it.text, 'Measured value', v => ui.apply(items, d => { d.text = v; }), 'dim-text'),
        ui.hintText('<> stands for the value, as in “2× <>”. Leave empty for the value alone.')) : null,
      one && it.kind === 'linear' ? ui.group('Measure', ui.seg([['aligned', 'Aligned'], ['h', 'Horizontal'], ['v', 'Vertical']], it.orient,
        v => ui.apply(items, d => { d.orient = v; }))) : null,
      one && it.kind === 'angle' ? ui.check('Outside angle (reflex)', !!it.reflex, v => ui.apply(items, d => { d.reflex = v; })) : null,
      ui.group('Ends', ui.iconSeg(END_STYLES.map(k => [k, ui.headIcon(k), k]), it.ends, v => ui.apply(items, d => { d.ends = v; }))),
      ui.group('Text size', ui.seg([[11, 'S'], [14, 'M'], [18, 'L'], [24, 'XL']], it.textSize, v => ui.apply(items, d => { d.textSize = v; }))),
      one && attached ? ui.group('', el('button', { class: 'btn', onclick: () => ui.apply(items, d => { for (const q of d.p) delete q.ref; }) }, 'Detach from the drawing')) : null,
      ui.group('Units', ui.seg([[0, '0'], [1, '0.0'], [2, '0.00'], [3, '0.000']], CAD.scaleOf(app.scene).prec, v => CAD.setScale(app, { prec: v })))
    );
  }

  /* ── registration ─────────────────────────────────────────────────── */
  D.ext.opts.cad = { objects: true, angle: true, square: false, centre: false, ortho: false, axisDrag: false, dupDrag: false };
  D.ext.opts.dim = { mode: 'auto', color: 'ink', size: 1.25, textSize: 14, ends: 'filled' };
  D.ext.opts.measure = { mode: 'distance' };
  /* New keys on the shape tool's options: the heads each kind starts
     with, how big they are, and which way a moment arrow turns. */
  D.ext.opts.shape = {
    heads: { line: ['none', 'none'], arrow: ['none', 'filled'], force: ['none', 'filled'], polyline: ['none', 'filled'] },
    headScale: 1, ccw: true
  };

  D.ext.tools.push({
    name: 'measure',
    create: app => new MeasureTool(app),
    rail: {
      icon: ICON.measure, key: 'm', title: 'Measure · M (hold for dimensions)', after: 'connector',
      flyout: [['measure', ICON.measure, 'Measure · M'], ['dim', ICON.dim, 'Dimension']],
      get: () => APP && APP.toolName === 'dim' ? 'dim' : 'measure',
      set: k => APP && APP.setTool(k), self: true, also: ['dim']
    },
    panel: panelMeasure
  });
  D.ext.tools.push({ name: 'dim', create: app => new DimTool(app), panel: panelDimTool });

  /* Long-press actions (js/press.js decides when they are offered). */
  D.ext.pressActions.push(
    {
      id: 'cad-measure', label: 'Measure from here', icon: ICON.measure, order: 60,
      when: ctx => ctx.source !== 'bar',                 // it is about a point, not a selection
      run: ctx => { ctx.app.setTool('measure'); ctx.app.tools.measure.startAt(ctx.x, ctx.y); }
    },
    {
      id: 'cad-dimension', label: 'Dimension this', icon: ICON.dim, order: 61,
      when: ctx => !!ctx.hit && ((D.isLine(ctx.hit) && !ctx.hit.via) || (ctx.hit.type === 'shape' && (ctx.hit.kind === 'ellipse' || ctx.hit.kind === 'moment'))),
      run: ctx => {
        const d = CAD.dimensionOf(ctx.app, ctx.hit, { x: ctx.x, y: ctx.y });
        if (d) { addDim(ctx.app, d); ctx.app.setTool('select'); ctx.app.select([d]); }
      }
    },
    {
      id: 'cad-scale', label: 'Set drawing scale…', icon: ICON.scale, order: 62,
      when: ctx => ctx.source !== 'bar' || (!!ctx.hit && D.isLine(ctx.hit) && !ctx.hit.via && !ctx.hit.curve),
      run: ctx => {
        const app = ctx.app, hit = ctx.hit;
        if (hit && D.isLine(hit) && !hit.via && !hit.curve) {
          app.setTool('select'); app.select([hit]);
          if (app.ui) app.ui.focusField('cad-cal');
        } else {
          app.setTool('measure');
          app.toast('Measure a length you know, then type its real length under Calibrate');
        }
      }
    }
  );

  /* Enter finishes a polyline or a path being measured. */
  D.ext.on('key', (app, e) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
    const sh = app.tools.shape, me = app.tools.measure;
    if (app.toolName === 'shape' && sh && sh.poly) { e.preventDefault(); sh.finishPoly(); return true; }
    if (app.toolName === 'measure' && me && me.pts.length >= 4 && !me.done && me.need() === Infinity) { e.preventDefault(); me.finish(); return true; }
  });

  /* A pen hovering over the glass gets the snap marker before it touches
     down, and the polyline's rubber band and the dimension line follow it
     between presses. The core repaints the live layer on a hover only for
     the eraser, so the tools that show something ask for it here — and
     only they, so a hover costs nothing anywhere else. */
  D.ext.on('ready', app => {
    const stage = document.getElementById('stage');
    if (!stage || !stage.addEventListener) return;
    const wants = () => {
      const n = app.toolName;
      if (n === 'measure' || n === 'dim') return true;
      return n === 'shape';
    };
    stage.addEventListener('pointermove', e => {
      if (!app.active && e.pointerType !== 'touch' && wants()) app.requestDrawLive();
    }, { passive: true });
  });

  D.ext.on('tool', app => { APP = app; });

})(window.DPO);

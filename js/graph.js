/* ── graph.js ── y = f(x), plotted on the board ───────────────────────
   A graph is a box on the board that plots one or more functions of x
   through the maths engine (D.math): sin(x), x^2/4 - 3, e^(-x/2)cos(3x),
   10 kN / (x m)… with axes, a nice grid and tick labels, and each curve
   in its own colour with its formula over it. The y range follows the
   curves unless it is set, ignoring the few points either side of an
   asymptote, so tan(x) is readable; a curve is broken where it jumps
   off the plot rather than drawn straight up the middle.

   The graph tool (Y), a long-press on the board, or "Plot" in the
   calculator puts one down; a double-tap opens the functions and the
   ranges to edit, and every change is one undo step. It is a box like
   any other: moved, resized, turned, exported (SVG and PDF) as drawn.

   ── The item ─────────────────────────────────────────────────────────

   { type: 'graph', x, y, w, h, fns: ['sin(x)', …], x0, x1, y0, y1,
     yAuto, angle: 'rad'|'deg', size, dim?, z0?, z1?, zAuto?, az?, el? }
   fns     what is plotted, as typed; x (and in 3D, y) the variables
   x0, x1  the x range;  y0, y1  the y range, used unless yAuto
   angle   what x is in, for trig: radians unless asked
   size    the label size, in board units
   dim     3 for a surface, z = f(x, y): then y0, y1 are the y range
           (always used), z0, z1 the height unless zAuto, and az, el the
           view, turned about the vertical and tilted down (radians)

   D.graph.sample(it) → { curves: [[x, y, …]…], y0, y1 }  (null until D.math loads)
   D.graph.parts(it, plot) → the primitives one graph is drawn from
   D.graph.sample3 / parts3 → the same, for a surface                     */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;

  const COLOURS = ['#3b6cff', '#e5484d', '#12a150', '#e08a00', '#8e4ec6', '#0aa2b8'];
  const SAMPLES = 480;

  /* ── sampling ──────────────────────────────────────────────────── */
  /** an evaluated value as a plain number, or NaN */
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v.isComplex) return Math.abs(v.im) < 1e-9 * Math.max(1, Math.abs(v.re)) ? v.re : NaN;
    if (v.isUnit) { try { return v.toNumber(); } catch (_) { return v.value != null ? v.value : NaN; } }
    if (v.isBigNumber || v.isFraction) return +v;
    return NaN;
  }

  /* what a formula may start with, as written: y =, z =, f(x) =, f(x, y) = */
  const LHS = /^\s*(?:[yz]|f\s*\([^)]*\))\s*=\s*/i;
  const bare = src => String(src || '').trim().replace(LHS, '');

  /** a function's source compiled, or an error to show beside it */
  function compile(src) {
    const M = D.math.lib;
    let s = bare(src);
    if (!s) return { error: '' };
    try { return { code: M.compile(D.math.preprocess(s)) }; }
    catch (err) { return { error: (err && err.message || 'Cannot read that').replace(/\s*\(char \d+\)/, '') }; }
  }

  /**
   * The range to show for these values: most of them, not the spikes
   * either side of an asymptote — unless there are none, when it is all
   * of them — with a little room each side.
   */
  function fitted(all) {
    let lo = -1, hi = 1;
    if (!all.length) return [lo, hi];
    all.sort((a, b) => a - b);
    const tlo = all[Math.floor(all.length * 0.02)], thi = all[Math.min(all.length - 1, Math.ceil(all.length * 0.98) - 1)];
    const min = all[0], max = all[all.length - 1];
    const spiky = (max - min) > (thi - tlo) * 8;
    lo = spiky ? tlo : min; hi = spiky ? thi : max;
    if (hi - lo < 1e-9) { const m = Math.abs(lo) || 1; lo -= m * 0.5; hi += m * 0.5; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  function sample(it) {
    if (!D.math.loaded) return null;
    const key = JSON.stringify([it.fns, it.x0, it.x1, it.angle]);
    if (it._lines && it._lines.key === key) return it._lines;
    const x0 = +it.x0, x1 = +it.x1, n = SAMPLES;
    const was = D.math.config.angle;
    D.math.config.angle = it.angle === 'deg' ? 'deg' : 'rad';
    const scope = D.math.scope();
    const curves = [], errors = [], all = [];
    try {
      for (const src of it.fns || []) {
        const c = compile(src), pts = new Float64Array((n + 1) * 2);
        errors.push(c.error || null);
        for (let i = 0; i <= n; i++) {
          const x = x0 + (x1 - x0) * i / n;
          let y = NaN;
          if (c.code) {
            scope.set('x', x);
            try { y = toNum(c.code.evaluate(scope)); } catch (_) { y = NaN; }
            if (!isFinite(y)) y = NaN;
          }
          pts[i * 2] = x; pts[i * 2 + 1] = y;
          if (y === y) all.push(y);
        }
        if (c.code && !all.length) errors[errors.length - 1] = 'No real values in this range';
        curves.push(pts);
      }
    } finally { D.math.config.angle = was; }
    const [y0, y1] = fitted(all);
    it._lines = { key, curves, errors, y0, y1 };
    return it._lines;
  }

  /**
   * Whether `src` is something to graph: a function of x — written bare
   * (x^2 − 3), as "y = …" or "f(x) = …" — whose other names are all
   * known (constants, or the variables in `scope`), and which gives real
   * numbers somewhere between −10 and 10. Gives the function to plot, or
   * null. What the prompts to graph go by: an equation in x the
   * calculator, a calc block or the pen could not answer.
   */
  function graphable(src, scope, opts = {}) {
    if (!D.math.loaded || !src) return null;
    let s = String(src).trim().replace(/=\s*$/, '').trim();
    const def = /^\s*(?:y|f\s*\(\s*x\s*\))\s*=(?!=)\s*(.+)$/i.exec(s);
    if (def) s = def[1].trim();
    /* Only a curve that was asked for: "y = 3x", "f(x) = 3x". A bare
       "12x" is a sum waiting for its x, not a graph. (`bare` lets the
       Plot button, which was asked, take one.) */
    else if (!opts.bare) return null;
    if (!s || /=/.test(s)) return null;                   // an equation to solve, not a function
    if (!/(^|[^A-Za-z_θ])x([^A-Za-z_(]|$)/.test(s)) return null;
    if (scope && scope.has && scope.has('x') && !def) return null;   // x is a number here: answered, not graphed
    let code;
    try { code = D.math.lib.compile(D.math.preprocess(s)); } catch (_) { return null; }
    const was = D.math.config.angle;
    D.math.config.angle = 'rad';
    const sc = scope && scope.child ? scope.child() : D.math.scope();
    let real = 0;
    try {
      for (let i = 0; i <= 12; i++) {
        sc.set('x', -10 + i * 20 / 12 + 0.013);
        let y;
        try { y = toNum(code.evaluate(sc)); } catch (_) { y = NaN; }
        if (isFinite(y)) real++;
      }
    } finally { D.math.config.angle = was; }
    return real >= 3 ? s : null;
  }

  /* ── ticks ─────────────────────────────────────────────────────── */
  function ticks(a, b, want) {
    const span = b - a;
    if (!(span > 0) || !isFinite(span)) return { step: 1, list: [] };
    const raw = span / Math.max(want, 1), p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p, step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
    const list = [];
    for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) list.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { step, list };
  }
  function fmt(v, step) {
    const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-4)) return v.toExponential(1).replace('e+', 'e');
    return v.toFixed(Math.min(d, 6)).replace('-', '−');
  }

  /* ── the picture, as primitives (canvas and SVG draw the same) ─── */
  function parts(it, plot) {
    const fs = it.size || 13, { x, y, w, h } = it;
    const out = { frame: { x, y, w, h }, grid: [], axes: [], labels: [], curves: [], legend: [], plot: null, note: null };
    const L = x + fs * 4.2, R = x + w - fs * 0.8, T = y + fs * 0.8, B = y + h - fs * 2.2;
    if (R - L < 10 || B - T < 10) return out;
    out.plot = { x: L, y: T, w: R - L, h: B - T };
    const x0 = +it.x0, x1 = +it.x1;
    const y0 = it.yAuto !== false && plot ? plot.y0 : +it.y0, y1 = it.yAuto !== false && plot ? plot.y1 : +it.y1;
    if (!(x1 > x0) || !(y1 > y0)) return out;
    const X = v => L + (v - x0) / (x1 - x0) * (R - L), Y = v => B - (v - y0) / (y1 - y0) * (B - T);
    const tx = ticks(x0, x1, (R - L) / (fs * 6)), ty = ticks(y0, y1, (B - T) / (fs * 3));
    for (const v of tx.list) {
      out.grid.push([X(v), T, X(v), B]);
      out.labels.push({ x: X(v), y: B + fs * 1.35, text: fmt(v, tx.step), align: 'center' });
    }
    for (const v of ty.list) {
      out.grid.push([L, Y(v), R, Y(v)]);
      out.labels.push({ x: L - fs * 0.4, y: Y(v) + fs * 0.35, text: fmt(v, ty.step), align: 'right' });
    }
    if (x0 <= 0 && x1 >= 0) out.axes.push([X(0), T, X(0), B]);
    if (y0 <= 0 && y1 >= 0) out.axes.push([L, Y(0), R, Y(0)]);
    if (!plot) { out.note = 'Plotting…'; return out; }
    const jump = (B - T) * 1.5;
    plot.curves.forEach((pts, k) => {
      const segs = [];
      let seg = null, py = null;
      for (let i = 0; i < pts.length; i += 2) {
        const yv = pts[i + 1];
        if (yv !== yv) { seg = null; py = null; continue; }
        const sx = X(pts[i]), sy = Y(yv);
        // off the plot by a mile and back: an asymptote, not a line to draw
        if (seg && py != null && Math.abs(sy - py) > jump && (sy < T || sy > B || py < T || py > B)) seg = null;
        if (!seg) { seg = []; segs.push(seg); }
        seg.push(sx, U.clamp(sy, T - (B - T) * 2, B + (B - T) * 2));
        py = sy;
      }
      out.curves.push({ color: COLOURS[k % COLOURS.length], segs });
    });
    legendOf(it, plot, out);
    return out;
  }

  /* ── 3D: z = f(x, y), a surface in a box ───────────────────────────
     Sampled on a GRID3 × GRID3 grid over the x and y ranges, and drawn
     as quads far to near (the painter's way), each shaded by its height
     and by how square it is to the light. The box stands on the floor
     with its nearest three edges left open, so it never hides the
     surface; the ticks run along the floor's front edges and up its
     leftmost corner. Turned by az about the vertical, tilted by el. */
  const GRID3 = 32, ZH = 0.75;   // ZH: the box's height, against its half-width
  const is3 = it => it.dim === 3;
  const VIEW = { az: 0.6, el: 0.5 };

  function sample3(it) {
    if (!D.math.loaded) return null;
    const key = JSON.stringify([3, it.fns, it.x0, it.x1, it.y0, it.y1, it.angle]);
    if (it._lines && it._lines.key === key) return it._lines;
    const n = GRID3, x0 = +it.x0, x1 = +it.x1, y0 = +it.y0, y1 = +it.y1;
    const was = D.math.config.angle;
    D.math.config.angle = it.angle === 'deg' ? 'deg' : 'rad';
    const scope = D.math.scope();
    const surfaces = [], errors = [], all = [];
    try {
      for (const src of it.fns || []) {
        const c = compile(src), z = new Float64Array((n + 1) * (n + 1));
        errors.push(c.error || null);
        let real = 0;
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
          let v = NaN;
          if (c.code) {
            scope.set('x', x0 + (x1 - x0) * i / n);
            scope.set('y', y0 + (y1 - y0) * j / n);
            try { v = toNum(c.code.evaluate(scope)); } catch (_) { v = NaN; }
            if (!isFinite(v)) v = NaN;
          }
          z[j * (n + 1) + i] = v;
          if (v === v) { all.push(v); real++; }
        }
        if (c.code && !real) errors[errors.length - 1] = 'No real values in this range';
        surfaces.push(z);
      }
    } finally { D.math.config.angle = was; }
    const [z0, z1] = fitted(all);
    it._lines = { key, n, surfaces, errors, z0, z1 };
    return it._lines;
  }

  const rgbOf = c => {
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [128, 128, 128];
  };
  const LIGHT = (() => { const v = [-0.45, -0.55, 0.7], l = Math.hypot(...v); return v.map(a => a / l); })();

  function parts3(it, plot) {
    const fs = it.size || 13, { x, y, w, h } = it;
    const out = { frame: { x, y, w, h }, grid: [], edges: [], labels: [], quads: [], legend: [], plot: null, note: null };
    const fns = (it.fns || []).filter(f => String(f).trim());
    const L = x + fs * 0.8, R = x + w - fs * 0.8, T = y + fs * (0.8 + 1.35 * Math.max(1, fns.length)), B = y + h - fs * 0.8;
    if (R - L < 20 || B - T < 20) return out;
    out.plot = { x: L, y: T, w: R - L, h: B - T };
    const x0 = +it.x0, x1 = +it.x1, y0 = +it.y0, y1 = +it.y1;
    const z0 = it.zAuto !== false && plot ? plot.z0 : +it.z0, z1 = it.zAuto !== false && plot ? plot.z1 : +it.z1;
    if (!(x1 > x0) || !(y1 > y0) || !(z1 > z0)) return out;
    const az = it.az ?? VIEW.az, el = U.clamp(it.el ?? VIEW.el, 0, Math.PI / 2);
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    // normalised (x, y in −1…1, z in −ZH…ZH) → [right, down, toward the eye]
    const proj = (nx, ny, nz) => { const px = nx * ca - ny * sa, py = nx * sa + ny * ca; return [px, -(nz * ce + py * se), -py * ce + nz * se]; };
    // the box, fitted to the plot with room round it for the labels
    const corners = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-ZH, ZH]) corners.push([a, b, c]);
    // the box, and on the floor round it where the tick labels and the axis names go
    const reach = corners.concat([[-1.2, -1.2, -ZH], [-1.2, 1.2, -ZH], [1.2, -1.2, -ZH], [1.2, 1.2, -ZH], [0, 1.45, -ZH], [0, -1.45, -ZH], [1.45, 0, -ZH], [-1.45, 0, -ZH]]);
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const c of reach) {
      const p = proj(...c);
      mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]);
    }
    const padX = fs * 2.2, padY = fs * 1.1;
    const k = Math.min((R - L - padX * 2) / (mxx - mnx), (B - T - padY * 2) / (mxy - mny));
    if (!(k > 0)) return out;
    const ox = (L + R) / 2 - (mnx + mxx) / 2 * k, oy = (T + B) / 2 - (mny + mxy) / 2 * k;
    const S = (nx, ny, nz) => { const p = proj(nx, ny, nz); return [ox + p[0] * k, oy + p[1] * k, p[2]]; };
    const NX = v => -1 + 2 * (v - x0) / (x1 - x0), NY = v => -1 + 2 * (v - y0) / (y1 - y0);
    const NZ = v => -ZH + 2 * ZH * (U.clamp(v, z0, z1) - z0) / (z1 - z0);

    // the box: every edge but the three that meet at the corner nearest the eye
    let near = 0;
    corners.forEach((c, i) => { if (proj(...c)[2] > proj(...corners[near])[2]) near = i; });
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const a = corners[i], b = corners[j];
      if (+(a[0] !== b[0]) + +(a[1] !== b[1]) + +(a[2] !== b[2]) !== 1 || i === near || j === near) continue;
      const p = S(...a), q = S(...b);
      out.edges.push([p[0], p[1], q[0], q[1]]);
    }
    // the floor's grid, and the ticks along its front edges and up the left
    const tx = ticks(x0, x1, 5), ty = ticks(y0, y1, 5), tz = ticks(z0, z1, 4);
    const frontY = proj(0, 1, -ZH)[2] > proj(0, -1, -ZH)[2] ? 1 : -1, frontX = proj(1, 0, -ZH)[2] > proj(-1, 0, -ZH)[2] ? 1 : -1;
    const label = (p, text, align, dx = 0, dy = 0) => out.labels.push({ x: p[0] + dx, y: p[1] + fs * 0.35 + dy, text, align });
    for (const v of tx.list) {
      const a = S(NX(v), -1, -ZH), b = S(NX(v), 1, -ZH);
      out.grid.push([a[0], a[1], b[0], b[1]]);
      label(S(NX(v), frontY * 1.18, -ZH), fmt(v, tx.step), 'center');
    }
    for (const v of ty.list) {
      const a = S(-1, NY(v), -ZH), b = S(1, NY(v), -ZH);
      out.grid.push([a[0], a[1], b[0], b[1]]);
      label(S(frontX * 1.18, NY(v), -ZH), fmt(v, ty.step), 'center');
    }
    out.axisNames = [];
    const axis = (p, text) => out.axisNames.push({ x: p[0], y: p[1] + fs * 0.35, text });
    axis(S(0, frontY * 1.42, -ZH), 'x');
    axis(S(frontX * 1.42, 0, -ZH), 'y');
    let left = corners[0];
    for (const c of corners) if (S(...c)[0] < S(...left)[0]) left = c;
    // not at the very foot of the corner, where the floor's labels are
    for (const v of tz.list) if (NZ(v) > -ZH * 0.85) label(S(left[0], left[1], NZ(v)), fmt(v, tz.step), 'right', -fs * 0.5);
    const top = S(left[0], left[1], ZH);
    axis([top[0], top[1] - fs * 1.1], 'z');

    if (!plot) { out.note = 'Plotting…'; return out; }
    const n = plot.n, cell = 2 / n;
    plot.surfaces.forEach((z, s) => {
      const base = rgbOf(COLOURS[s % COLOURS.length]);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const r0 = j * (n + 1) + i, r1 = r0 + n + 1;
        const v = [z[r0], z[r0 + 1], z[r1 + 1], z[r1]];
        if (v.some(a => a !== a)) continue;
        const nz = v.map(NZ), xa = -1 + i * cell, ya = -1 + j * cell;
        const p = [S(xa, ya, nz[0]), S(xa + cell, ya, nz[1]), S(xa + cell, ya + cell, nz[2]), S(xa, ya + cell, nz[3])];
        // its height picks the colour, its slope the shade
        const t = ((nz[0] + nz[1] + nz[2] + nz[3]) / 4 + ZH) / (2 * ZH);
        const gx = (nz[1] - nz[0] + nz[2] - nz[3]) / 2, gy = (nz[3] - nz[0] + nz[2] - nz[1]) / 2;
        const nrm = [-gx * cell, -gy * cell, cell * cell], nl = Math.hypot(...nrm) || 1;
        const lit = 0.62 + 0.38 * Math.abs((nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2]) / nl);
        const wash = 0.55 * (1 - t);          // low ground pale, high ground the full colour
        const c = base.map(b => Math.round((b + (255 - b) * wash) * lit));
        out.quads.push({
          pts: [p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]],
          depth: (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4,
          fill: `rgb(${c[0]},${c[1]},${c[2]})`, stroke: `rgb(${c.map(a => Math.round(a * 0.78)).join(',')})`
        });
      }
    });
    out.quads.sort((a, b) => a.depth - b.depth);
    legendOf(it, plot, out);
    return out;
  }

  /** the formulas, each in its own colour, with what is wrong with it if it cannot be plotted */
  function legendOf(it, plot, out) {
    (it.fns || []).forEach((src, k) => {
      if (!String(src).trim()) return;
      out.legend.push({ color: COLOURS[k % COLOURS.length], text: (is3(it) ? 'z = ' : 'y = ') + bare(src), error: plot.errors[k] });
    });
  }

  const FONT = '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';

  /** the formulas, top left of the plot, on a wash of paper so they read over what is under them */
  function drawLegend(ctx, P, fs, a0, paper) {
    ctx.textAlign = 'left';
    ctx.font = `600 ${fs}px ${FONT}`;
    P.legend.forEach((l, i) => {
      const lx = P.plot.x + fs * 0.5, ly = legendY(P, fs, i);
      const text = l.error ? l.text + '  — ' + l.error : l.text;
      const tw = ctx.measureText(text).width;
      ctx.globalAlpha = a0 * 0.85; ctx.fillStyle = paper; ctx.fillRect(lx - fs * 0.3, ly - fs * 1.05, tw + fs * 0.6, fs * 1.35);
      ctx.globalAlpha = a0; ctx.fillStyle = l.error ? '#e5484d' : l.color; ctx.fillText(text, lx, ly);
    });
  }
  /* 2D: over the plot's top left; 3D: in the band the plot leaves above itself */
  const legendY = (P, fs, i) => P.quads ? P.frame.y + fs * (1.55 + i * 1.35) : P.plot.y + fs * (1.3 + i * 1.35);

  /** parts3, kept until the surface, the box or the view changes: a pan repaints it as it was */
  function parts3Of(it, plot) {
    const key = plot && JSON.stringify([plot.key, it.x, it.y, it.w, it.h, it.size, it.az, it.el, it.zAuto, it.z0, it.z1]);
    if (key && it._p3 && it._p3.key === key && it._p3.plot === plot) return it._p3.P;
    const P = parts3(it, plot);
    if (key) it._p3 = { key, plot, P };
    return P;
  }

  function draw3(ctx, it, r) {
    const plot = sample3(it);
    if (!plot && !D.math.loaded) whenLoaded();
    const P = parts3Of(it, plot), fs = it.size || 13;
    const ink = U.color('ink'), paper = U.color('paper');
    const zoom = r.paintZoom || (r.app && r.app.camera ? r.app.camera.zoom : 1), hair = 1 / Math.max(zoom, 0.05);
    const { x, y, w, h } = P.frame;
    ctx.fillStyle = paper; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = ink; ctx.lineWidth = hair; ctx.globalAlpha *= 0.3; ctx.strokeRect(x, y, w, h); ctx.globalAlpha /= 0.3;
    if (!P.plot) return;
    const a0 = ctx.globalAlpha;
    const lines = (ls, alpha, lw) => {
      ctx.globalAlpha = a0 * alpha; ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.beginPath();
      for (const [x1, y1, x2, y2] of ls) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.stroke();
    };
    lines(P.grid, 0.12, hair);
    lines(P.edges, 0.4, hair);
    ctx.globalAlpha = a0;
    ctx.lineWidth = hair * 0.6; ctx.lineJoin = 'round';
    for (const q of P.quads) {
      const p = q.pts;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.lineTo(p[6], p[7]); ctx.closePath();
      ctx.fillStyle = q.fill; ctx.fill();
      ctx.strokeStyle = q.stroke; ctx.stroke();
    }
    ctx.fillStyle = ink; ctx.font = `${fs}px ${FONT}`;
    ctx.globalAlpha = a0 * 0.7;
    for (const l of P.labels) { ctx.textAlign = l.align; ctx.fillText(l.text, l.x, l.y); }
    ctx.font = `italic 600 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.globalAlpha = a0 * 0.85;
    for (const l of P.axisNames) ctx.fillText(l.text, l.x, l.y);
    ctx.globalAlpha = a0;
    drawLegend(ctx, P, fs, a0, paper);
    if (P.note) { ctx.fillStyle = ink; ctx.globalAlpha = a0 * 0.5; ctx.textAlign = 'center'; ctx.font = `${fs}px ${FONT}`; ctx.fillText(P.note, P.plot.x + P.plot.w / 2, P.plot.y + P.plot.h / 2); }
  }

  function svg3(it) {
    const plot = sample3(it), P = parts3Of(it, plot), fs = it.size || 13, r = v => U.round(v, 2);
    const ink = U.color('ink'), paper = U.color('paper');
    const { x, y, w, h } = P.frame;
    const o = [`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${paper}" stroke="${ink}" stroke-opacity=".3" stroke-width="1"/>`];
    if (!P.plot) return '<g>' + o.join('') + '</g>';
    const lines = (ls, op) => ls.length ? `<path d="${ls.map(([a, b, c, d]) => `M${r(a)} ${r(b)}L${r(c)} ${r(d)}`).join('')}" stroke="${ink}" stroke-opacity="${op}" stroke-width="1" fill="none"/>` : '';
    o.push(lines(P.grid, 0.12), lines(P.edges, 0.4));
    for (const q of P.quads) {
      const p = q.pts.map(r);
      o.push(`<path d="M${p[0]} ${p[1]}L${p[2]} ${p[3]}L${p[4]} ${p[5]}L${p[6]} ${p[7]}Z" fill="${q.fill}" stroke="${q.stroke}" stroke-width=".5" stroke-linejoin="round"/>`);
    }
    for (const l of P.labels) o.push(`<text x="${r(l.x)}" y="${r(l.y)}" font-size="${fs}" font-family="Segoe UI, sans-serif" fill="${ink}" fill-opacity=".7" text-anchor="${l.align === 'right' ? 'end' : 'middle'}">${esc(l.text)}</text>`);
    for (const l of P.axisNames) o.push(`<text x="${r(l.x)}" y="${r(l.y)}" font-size="${fs}" font-style="italic" font-weight="600" font-family="Segoe UI, sans-serif" fill="${ink}" fill-opacity=".85" text-anchor="middle">${esc(l.text)}</text>`);
    P.legend.forEach((l, i) => o.push(`<text x="${r(P.plot.x + fs * 0.5)}" y="${r(legendY(P, fs, i))}" font-size="${fs}" font-weight="600" font-family="Segoe UI, sans-serif" fill="${l.error ? '#e5484d' : l.color}">${esc(l.error ? l.text + '  — ' + l.error : l.text)}</text>`));
    return '<g>' + o.join('') + '</g>';
  }

  function draw(ctx, it, r) {
    if (is3(it)) return draw3(ctx, it, r);
    const plot = sample(it);
    if (!plot && !D.math.loaded) whenLoaded();
    const P = parts(it, plot), fs = it.size || 13;
    const ink = U.color('ink'), paper = U.color('paper');
    const zoom = r.paintZoom || (r.app && r.app.camera ? r.app.camera.zoom : 1), hair = 1 / Math.max(zoom, 0.05);
    const { x, y, w, h } = P.frame;
    ctx.fillStyle = paper; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = ink; ctx.lineWidth = hair; ctx.globalAlpha *= 0.3; ctx.strokeRect(x, y, w, h); ctx.globalAlpha /= 0.3;
    if (!P.plot) return;
    const a0 = ctx.globalAlpha;
    ctx.lineWidth = hair;
    ctx.globalAlpha = a0 * 0.12; ctx.beginPath();
    for (const [x1, y1, x2, y2] of P.grid) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
    ctx.globalAlpha = a0 * 0.55; ctx.lineWidth = Math.max(hair, fs * 0.08); ctx.beginPath();
    for (const [x1, y1, x2, y2] of P.axes) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
    ctx.globalAlpha = a0 * 0.7; ctx.fillStyle = ink; ctx.font = `${fs}px ${FONT}`;
    for (const l of P.labels) { ctx.textAlign = l.align; ctx.fillText(l.text, l.x, l.y); }
    ctx.globalAlpha = a0;
    ctx.save();
    ctx.beginPath(); ctx.rect(P.plot.x, P.plot.y, P.plot.w, P.plot.h); ctx.clip();
    ctx.lineWidth = Math.max(hair * 1.6, fs * 0.16); ctx.lineJoin = ctx.lineCap = 'round';
    for (const c of P.curves) {
      ctx.strokeStyle = c.color; ctx.beginPath();
      for (const s of c.segs) for (let i = 0; i < s.length; i += 2) i ? ctx.lineTo(s[i], s[i + 1]) : ctx.moveTo(s[i], s[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
    drawLegend(ctx, P, fs, a0, paper);
    if (P.note) { ctx.fillStyle = ink; ctx.globalAlpha = a0 * 0.5; ctx.textAlign = 'center'; ctx.fillText(P.note, P.plot.x + P.plot.w / 2, P.plot.y + P.plot.h / 2); }
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function svg(it) {
    if (is3(it)) return svg3(it);
    const plot = sample(it), P = parts(it, plot), fs = it.size || 13, r = v => U.round(v, 2);
    const ink = U.color('ink'), paper = U.color('paper');
    const { x, y, w, h } = P.frame;
    const o = [`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${paper}" stroke="${ink}" stroke-opacity=".3" stroke-width="1"/>`];
    if (!P.plot) return '<g>' + o.join('') + '</g>';
    const lines = (ls, op, sw) => ls.length ? `<path d="${ls.map(([a, b, c, d]) => `M${r(a)} ${r(b)}L${r(c)} ${r(d)}`).join('')}" stroke="${ink}" stroke-opacity="${op}" stroke-width="${sw}" fill="none"/>` : '';
    o.push(lines(P.grid, 0.12, 1), lines(P.axes, 0.55, r(Math.max(1, fs * 0.08))));
    for (const l of P.labels) o.push(`<text x="${r(l.x)}" y="${r(l.y)}" font-size="${fs}" font-family="Segoe UI, sans-serif" fill="${ink}" fill-opacity=".7" text-anchor="${l.align === 'right' ? 'end' : 'middle'}">${esc(l.text)}</text>`);
    const id = 'gc' + it.id.replace(/\W/g, '');
    o.push(`<clipPath id="${id}"><rect x="${r(P.plot.x)}" y="${r(P.plot.y)}" width="${r(P.plot.w)}" height="${r(P.plot.h)}"/></clipPath>`);
    for (const c of P.curves) {
      const d = c.segs.map(s => { let p = ''; for (let i = 0; i < s.length; i += 2) p += (i ? 'L' : 'M') + r(s[i]) + ' ' + r(s[i + 1]); return p; }).join('');
      if (d) o.push(`<path d="${d}" stroke="${c.color}" stroke-width="${r(Math.max(1.5, fs * 0.16))}" fill="none" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#${id})"/>`);
    }
    P.legend.forEach((l, i) => o.push(`<text x="${r(P.plot.x + fs * 0.5)}" y="${r(P.plot.y + fs * (1.3 + i * 1.35))}" font-size="${fs}" font-weight="600" font-family="Segoe UI, sans-serif" fill="${l.error ? '#e5484d' : l.color}">${esc(l.error ? l.text + '  — ' + l.error : l.text)}</text>`));
    return '<g>' + o.join('') + '</g>';
  }

  /* the maths engine loads on first use: repaint the graphs once it is in */
  let waiting = false;
  function whenLoaded() {
    if (waiting) return;
    waiting = true;
    D.math.ready().then(() => {
      const app = D.app;
      if (!app || !app.scene) return;
      for (const it of app.scene.items) if (it.type === 'graph') app.scene.dirty(it);
      app.requestDraw();
    }).catch(() => { waiting = false; });
  }

  /* ── making one ────────────────────────────────────────────────── */
  function make(at, o = {}) {
    return Object.assign({
      id: U.uid(), type: 'graph', x: at.x, y: at.y, w: 520, h: 340,
      fns: ['sin(x)'], x0: -10, x1: 10, y0: -2, y1: 2, yAuto: true, angle: 'rad', size: 13, alpha: 1
    }, o);
  }
  function add(app, at, o = {}, opts = {}) {
    const it = make(at, o);
    it.x -= it.w / 2; it.y -= it.h / 2;
    app.scene.begin('graph'); app.scene.add(it); app.scene.commit();
    app.setTool('select'); app.select([it]); app.afterEdit();
    if (opts.edit !== false) edit(app, it);
    return it;
  }

  /* ── the editor ────────────────────────────────────────────────── */
  /* The functions and the ranges, beside the graph. Every change shows
     at once; the lot is one undo step, closed when the editor is. */
  let pop = null;
  function close() {
    if (!pop) return;
    if (D.calc && D.calc.typeInto) D.calc.typeInto(null);
    const { app, it, box } = pop;
    box.remove();
    removeEventListener('pointerdown', pop.away, true);
    removeEventListener('keydown', pop.key, true);
    pop = null;
    app.scene.commit();
    app.afterEdit();
  }

  function edit(app, it) {
    close();
    app.scene.begin('edit graph');
    app.scene.touch(it);
    let refit = () => {};
    const changed = () => { app.scene.touch(it); it._lines = null; app.requestDraw(); refit(); };
    const list = el('div', { class: 'graph-fns' });
    const lhs = () => is3(it) ? 'z =' : 'y =';
    const unLhs = text => text.replace(/^\s*[yz]\s*=\s*/i, '');
    const rows = () => {
      list.replaceChildren(...it.fns.map((src, k) => {
        const f = el('input', { class: 'graph-fn', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: is3(it) ? 'sin(x)·cos(y)' : 'x^2 − 3', 'aria-label': `Function ${k + 1}` });
        f.value = src;
        f.addEventListener('input', () => { it.fns = it.fns.slice(); it.fns[k] = f.value; changed(); });
        // the calculator's keys type into whichever function was last tapped
        f.addEventListener('focus', () => { if (D.calc && D.calc.typeInto) D.calc.typeInto(f); });
        const write = () => D.inkmath && D.inkmath.writePad(app, { title: `Write ${lhs().slice(0, 1)}${it.fns.length > 1 ? ' ' + (k + 1) : ''} =`, start: f.value, near: box,
          use: text => { f.value = unLhs(text); f.dispatchEvent(new Event('input')); } });
        if (D.inkmath) U.penField(f, write);
        return el('div', { class: 'graph-row' },
          el('span', { class: 'graph-sw', style: `background:${COLOURS[k % COLOURS.length]}` }), el('span', { class: 'graph-y' }, lhs()), f,
          D.inkmath ? el('button', { class: 'icon graph-w', type: 'button', title: 'Write it with the pen', 'aria-label': 'Write this function with the pen', html: PEN_SVG, onclick: write }) : null,
          el('button', { class: 'icon graph-x', type: 'button', title: 'Remove', 'aria-label': 'Remove this function', onclick: () => { it.fns = it.fns.filter((_, i) => i !== k); changed(); rows(); },
            html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>' }));
      }));
    };

    /* ── the ranges: a row an axis, label · from · to · one more thing ── */
    const evalNum = s => {
      const v = D.math.loaded ? D.math.evaluate(s, D.math.scope(), { angle: 'rad' }) : { ok: true, value: +s };
      return v && v.ok ? toNum(v.value) : NaN;
    };
    const num = (label, put) => {
      const f = el('input', { class: 'graph-num', type: 'text', inputmode: 'decimal', spellcheck: 'false', 'aria-label': label });
      if (D.inkmath) U.penField(f, () => D.inkmath.writePad(app, { title: label, start: f.value, near: f, use: t => { f.value = t; f.dispatchEvent(new Event('input')); } }));
      f.addEventListener('input', () => {
        const s = f.value.trim();
        if (!s) { f.classList.remove('bad'); put(null); return; }
        const n = evalNum(s);
        f.classList.toggle('bad', !isFinite(n));
        if (isFinite(n)) put(n);
      });
      return f;
    };
    /* the usual ranges, from a short list, so the pen need not write numbers */
    const presets = (axes, fields) => {
      const s = el('select', { class: 'graph-preset', title: 'Usual ranges', 'aria-label': 'Usual ranges' },
        el('option', { value: '' }, '±…'), ...PRESETS.map(([label], i) => el('option', { value: String(i) }, label)));
      s.addEventListener('change', () => {
        const p = PRESETS[+s.value];
        s.value = '';
        if (!p) return;
        for (const a of axes) { it[a + '0'] = p[1]; it[a + '1'] = p[2]; }
        for (const f of fields) { f[0].value = fmtRange(p[1]); f[1].value = fmtRange(p[2]); f[0].classList.remove('bad'); f[1].classList.remove('bad'); }
        changed();
      });
      return s;
    };
    /** an axis whose range is typed: x, and y in 3D */
    const fixedRow = a => {
      const f0 = num(a + ' from', v => { if (v != null) { it[a + '0'] = v; changed(); } });
      const f1 = num(a + ' to', v => { if (v != null) { it[a + '1'] = v; changed(); } });
      f0.value = fmtRange(+it[a + '0']); f1.value = fmtRange(+it[a + '1']);
      return { a, f: [f0, f1] };
    };
    /**
     * An axis that follows the curves until it is given numbers: y in 2D,
     * z in 3D. While it follows, its fields are empty and show what it has
     * fitted to, faintly; typing in either sets both, and Fit lets go.
     */
    const autoRow = a => {
      const auto = a + 'Auto', lo = a + '0', hi = a + '1';
      const fit = () => { const p = it._lines || (is3(it) ? sample3(it) : sample(it)); return p ? [p[lo], p[hi]] : [+it[lo], +it[hi]]; };
      let f0, f1;
      const put = (key, other) => v => {
        if (v == null) {
          if (!f0.value.trim() && !f1.value.trim()) { it[auto] = true; changed(); }
          return;
        }
        if (it[auto] !== false) {
          const [a0, a1] = fit();
          it[lo] = +a0.toPrecision(3); it[hi] = +a1.toPrecision(3);
          other.value = String(it[key === lo ? hi : lo]);
          it[auto] = false;
        }
        it[key] = v; changed();
      };
      f0 = num(a + ' from', v => put(lo, f1)(v));
      f1 = num(a + ' to', v => put(hi, f0)(v));
      const fitB = el('button', { class: 'graph-fit', type: 'button', title: `Fit ${a} to what is plotted`, onclick: () => { it[auto] = true; f0.value = f1.value = ''; f0.classList.remove('bad'); f1.classList.remove('bad'); changed(); } }, 'Fit');
      // set, the fields hold what was typed, and are only filled in to begin with
      if (it[auto] === false) { f0.value = String(it[lo]); f1.value = String(it[hi]); }
      const show = () => {
        const on = it[auto] !== false;
        fitB.classList.toggle('on', on);
        if (!on) return;
        const [a0, a1] = fit(), step = Math.abs(a1 - a0) / 10 || 1;
        f0.value = f1.value = '';
        f0.placeholder = fmt(a0, step); f1.placeholder = fmt(a1, step);
      };
      return { a, f: [f0, f1], extra: fitB, show };
    };
    const ranges = el('div', { class: 'graph-ranges' });
    const view = el('div', { class: 'graph-view' });
    const buildRanges = () => {
      const rs = is3(it) ? [fixedRow('x'), fixedRow('y'), autoRow('z')] : [fixedRow('x'), autoRow('y')];
      const fixed = rs.filter(r => !r.show);
      fixed[0].extra = presets(fixed.map(r => r.a), fixed.map(r => r.f));
      ranges.replaceChildren(...rs.flatMap(r => [el('span', { class: 'graph-ax' }, r.a), r.f[0], el('span', { class: 'graph-to' }, '–'), r.f[1], r.extra || el('span')]));
      const auto = rs.find(r => r.show);
      refit = () => auto.show();
      auto.show();
      view.hidden = !is3(it);
    };
    /* 3D: which way round and how far over it is seen */
    const slider = (label, min, max, get, set) => {
      const s = el('input', { type: 'range', min: String(min), max: String(max), step: '1', 'aria-label': label });
      s.value = String(Math.round(get()));
      s.addEventListener('input', () => { set(+s.value); app.scene.touch(it); app.requestDraw(); });
      return el('label', { class: 'graph-slide' }, el('span', {}, label), s);
    };
    view.append(
      slider('Turn', -180, 180, () => (it.az ?? VIEW.az) * 180 / Math.PI, v => { it.az = v * Math.PI / 180; }),
      slider('Tilt', 0, 90, () => (it.el ?? VIEW.el) * 180 / Math.PI, v => { it.el = v * Math.PI / 180; }));

    const seg = (opts, now, set, label) => {
      const s = el('div', { class: 'seg graph-seg', role: 'group', 'aria-label': label });
      const paint = v => { for (const b of s.children) b.classList.toggle('on', b.dataset.v === String(v)); };
      for (const [v, text, title] of opts) {
        const b = el('button', { type: 'button', 'data-v': String(v), title }, text);
        b.onclick = () => { set(v); paint(v); changed(); };
        s.appendChild(b);
      }
      paint(now);
      return s;
    };
    const setDim = d => {
      if ((d === 3) === is3(it)) return;
      if (d === 3) {
        it.dim = 3;
        // a square floor to start from, and z following the surface
        if (+it.x0 === -10 && +it.x1 === 10) { it.x0 = -2 * Math.PI; it.x1 = 2 * Math.PI; }   // the usual ±10 is a lot of waves in 3D
        it.y0 = it.x0; it.y1 = it.x1; it.zAuto = true;
        if (it.fns.length === 1 && /^\s*sin\(x\)\s*$/.test(it.fns[0])) it.fns = ['sin(x)·cos(y)'];
      } else { delete it.dim; it.yAuto = true; }
      it._lines = null;
      rows(); buildRanges();
      if (app.ui) app.ui.refresh();
    };
    const box = el('div', { class: 'graph-pop', role: 'dialog', 'aria-label': 'Graph' },
      el('div', { class: 'graph-head' }, el('span', {}, 'Graph'),
        seg([[2, '2D', 'y = f(x), a curve'], [3, '3D', 'z = f(x, y), a surface']], is3(it) ? 3 : 2, setDim, 'Dimensions'),
        seg([['rad', 'rad', 'Trig in radians'], ['deg', 'deg', 'Trig in degrees']], it.angle || 'rad', v => { it.angle = v; }, 'Angles'),
        el('button', { class: 'icon', type: 'button', title: 'Done', 'aria-label': 'Done', onclick: () => close(),
          html: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' })),
      list,
      el('div', { class: 'graph-acts' },
        el('button', { class: 'btn graph-add', type: 'button', onclick: () => { it.fns = it.fns.concat(''); changed(); rows(); const fs = list.querySelectorAll('.graph-fn'); if (fs.length) fs[fs.length - 1].focus(); } }, '+ Add'),
        D.inkmath ? el('button', { class: 'btn graph-add', type: 'button', onclick: () => D.inkmath.writePad(app, { title: `Write ${lhs()}`, near: box,
          use: text => { it.fns = it.fns.filter(s => s.trim()).concat(unLhs(text)); changed(); rows(); } }), html: PEN_SVG + '<span>Write</span>' }) : null,
        D.calc ? el('button', { class: 'btn graph-add', type: 'button', onclick: () => {
          D.calc.open();
          const fs = list.querySelectorAll('.graph-fn'), f = fs[fs.length - 1];
          if (f) { f.focus(); D.calc.typeInto(f); }
        }, html: KEYS_SVG + '<span>Keypad</span>' }) : null),
      ranges, view);
    rows();
    buildRanges();
    document.body.appendChild(box);
    // beside the graph, on whichever side has room
    const b = app.scene.bbox(it), a = app.camera.toScreen(b.x2, b.y), l = app.camera.toScreen(b.x, b.y);
    const W = 340;
    const left = a.x + 12 + W < innerWidth - 8 ? a.x + 12 : Math.max(8, l.x - 12 - W);
    box.style.left = U.clamp(left, 8, Math.max(8, innerWidth - W - 8)) + 'px';
    box.style.top = U.clamp(a.y, 64, Math.max(64, innerHeight - 380)) + 'px';
    pop = {
      app, it, box,
      // the keypad and the writing pad work for the editor: pressing them does not close it
      away: e => { if (!box.contains(e.target) && !(e.target.closest && e.target.closest('#calc-panel, .inkmath-write'))) close(); },
      key: e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    };
    setTimeout(() => { if (pop && pop.box === box) { addEventListener('pointerdown', pop.away, true); addEventListener('keydown', pop.key, true); } }, 0);
    D.math.ready().then(() => { if (pop && pop.it === it) { it._lines = null; app.requestDraw(); refit(); } }).catch(() => {});
    if (app.pointerType === 'mouse') setTimeout(() => { const f = list.querySelector('.graph-fn'); if (f) f.focus(); }, 30);
    return { el: box, close };
  }

  const PEN_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20l4.5-1.2L20 7.3a2 2 0 0 0 0-2.8l-.5-.5a2 2 0 0 0-2.8 0L5.2 15.5z"/><path d="M14.5 6.5l3 3"/></svg>';
  const KEYS_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01"/></svg>';
  const PRESETS = [['±1', -1, 1], ['±10', -10, 10], ['±100', -100, 100], ['0…10', 0, 10], ['±2π', -2 * Math.PI, 2 * Math.PI], ['0…2π', 0, 2 * Math.PI]];
  const fmtRange = v => Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : Math.abs(Math.abs(v) - 2 * Math.PI) < 1e-9 ? (v < 0 ? '-2pi' : '2pi') : String(+v.toFixed(4));

  /** the x (or y) range, zoomed about its middle (k < 1 in, > 1 out) */
  function zoomX(it, k, a = 'x') {
    const lo = +it[a + '0'], hi = +it[a + '1'], m = (lo + hi) / 2, h = (hi - lo) / 2 * k;
    it[a + '0'] = +(m - h).toPrecision(6); it[a + '1'] = +(m + h).toPrecision(6);
  }
  const zoomY = (it, k) => zoomX(it, k, 'y');

  /* ── plugging in ───────────────────────────────────────────────── */
  const ICON = { graph: 'M4 4v16h16|M6.5 15c2-6 3.5-8 5.5-8s3 4 4.5 4 2-2 2.5-3' };

  D.ext.items.graph = {
    label: 'Graph',
    bbox: it => ({ x: it.x, y: it.y, w: it.w, h: it.h }),
    draw, svg,
    rotate: 'box',
    scale(it, o, sx, sy) {
      const x2 = o.x + (it.x + it.w - o.x) * sx, y2 = o.y + (it.y + it.h - o.y) * sy;
      it.x = o.x + (it.x - o.x) * sx; it.y = o.y + (it.y - o.y) * sy;
      it.w = x2 - it.x; it.h = y2 - it.y;
      if (it.w < 0) { it.x += it.w; it.w = -it.w; }
      if (it.h < 0) { it.y += it.h; it.h = -it.h; }
      // the labels grow with the graph, a little, so a big one is still read from across a room
      it.size = U.clamp((it.size || 13) * Math.sqrt(Math.abs(sx * sy)) ** 0.5, 8, 80);
    },
    edit: (app, it) => edit(app, it),
    panel(ui, items) {
      const app = ui.app, one = items.length === 1 && items[0], three = items.every(is3);
      const btn = (text, title, fn) => el('button', { class: 'btn', type: 'button', title, onclick: () => ui.apply(items, it => { fn(it); it._lines = null; }) }, text);
      ui.add(
        ui.group(items.length > 1 ? items.length + ' graphs' : three ? 'Graph · 3D' : 'Graph', el('div', { class: 'graph-acts' },
          one ? el('button', { class: 'btn', type: 'button', onclick: () => edit(app, one) }, 'Functions and ranges') : null,
          btn(three ? 'Zoom in' : 'x in', three ? 'Zoom in on x and y' : 'Zoom in on x', it => { zoomX(it, 0.5); if (is3(it)) zoomY(it, 0.5); }),
          btn(three ? 'Zoom out' : 'x out', three ? 'Zoom out on x and y' : 'Zoom out on x', it => { zoomX(it, 2); if (is3(it)) zoomY(it, 2); }),
          btn(three ? 'Fit z' : 'Fit y', three ? 'Fit z to the surface' : 'Fit y to the curves', it => { if (is3(it)) it.zAuto = true; else it.yAuto = true; }))),
        three ? ui.group('View', el('div', { class: 'graph-acts' },
          btn('⟲ Turn', 'Turn it 30° one way', it => { it.az = (it.az ?? VIEW.az) - Math.PI / 6; }),
          btn('Turn ⟳', 'Turn it 30° the other way', it => { it.az = (it.az ?? VIEW.az) + Math.PI / 6; }),
          btn('Reset', 'Back to the usual view', it => { delete it.az; delete it.el; }))) : null,
        ui.group('Label size', ui.seg([[11, 'S'], [13, 'M'], [17, 'L'], [24, 'XL']], items[0].size || 13, v => ui.apply(items, it => { it.size = v; }))),
        ui.slider('Opacity', items[0].alpha ?? 1, 0.1, 1, 0.05, v => ui.apply(items, it => it.alpha = v), v => Math.round(v * 100) + '%')
      );
    }
  };

  class GraphTool {
    constructor(app) { this.app = app; this.at = null; }
    down(ev) { this.at = { x: ev.x, y: ev.y }; }
    move() { }
    up() {
      const at = this.at; this.at = null;
      if (!at) return;
      const hit = this.app.scene.hitTest(at.x, at.y, 6 / this.app.camera.zoom);
      if (hit && hit.type === 'graph') { this.app.setTool('select'); this.app.select([hit]); edit(this.app, hit); return; }
      add(this.app, at);
    }
    cancel() { this.at = null; }
    paint() { }
  }

  D.ext.tools.push({
    name: 'graph',
    create: app => new GraphTool(app),
    rail: { icon: ICON.graph, key: 'y', title: 'Graph · Y', after: 'calc' },
    panel: ui => ui.add(ui.group('', el('div', { class: 'rowlbl' }, el('span', { style: 'line-height:1.5' },
      'Tap the board for a graph of y = f(x): sin(x), x^2 − 3, e^(−x)… Double-tap one to change what it plots.'))))
  });

  D.ext.pressActions.push({
    id: 'graph-new', label: 'New graph here', icon: ICON.graph, order: 62,
    when: ctx => ctx.source === 'menu' && !ctx.selection.length,
    run: ctx => add(ctx.app, { x: ctx.x, y: ctx.y })
  });

  D.ext.on('board', () => { if (pop) { pop.box.remove(); removeEventListener('pointerdown', pop.away, true); removeEventListener('keydown', pop.key, true); pop = null; } });

  /** a graph of `fn` beside a box (world units), as the prompts to graph make one */
  function beside(app, box, fn) {
    const at = { x: box.x2 + 40 + 260, y: box.y + box.h / 2 };
    return add(app, at, { fns: [fn] }, { edit: false });
  }

  D.graph = { sample, parts, sample3, parts3, make, add, edit, close, ticks, graphable, beside, COLOURS };
})(window.DPO);

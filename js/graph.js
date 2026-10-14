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
     yAuto, angle: 'rad'|'deg', size }
   fns     what is plotted, as typed; x is the variable
   x0, x1  the x range;  y0, y1  the y range, used unless yAuto
   angle   what x is in, for trig: radians unless asked
   size    the label size, in board units

   D.graph.sample(it) → { curves: [[x, y, …]…], y0, y1 }  (null until D.math loads)
   D.graph.parts(it, plot) → the primitives one graph is drawn from       */
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

  /** a function's source compiled, or an error to show beside it */
  function compile(src) {
    const M = D.math.lib;
    let s = String(src || '').trim().replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
    if (!s) return { error: '' };
    try { return { code: M.compile(D.math.preprocess(s)) }; }
    catch (err) { return { error: (err && err.message || 'Cannot read that').replace(/\s*\(char \d+\)/, '') }; }
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
    // the y range: most of the values, not the spikes either side of an asymptote
    let y0 = -1, y1 = 1;
    if (all.length) {
      all.sort((a, b) => a - b);
      const lo = all[Math.floor(all.length * 0.02)], hi = all[Math.min(all.length - 1, Math.ceil(all.length * 0.98) - 1)];
      const min = all[0], max = all[all.length - 1];
      // a curve that is all there (no spikes): its full range; otherwise the trimmed one
      const spread = hi - lo, spiky = (max - min) > spread * 8;
      y0 = spiky ? lo : min; y1 = spiky ? hi : max;
      if (y1 - y0 < 1e-9) { const m = Math.abs(y0) || 1; y0 -= m * 0.5; y1 += m * 0.5; }
      const pad = (y1 - y0) * 0.08;
      y0 -= pad; y1 += pad;
    }
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
  function graphable(src, scope) {
    if (!D.math.loaded || !src) return null;
    let s = String(src).trim().replace(/=\s*$/, '').trim();
    const def = /^\s*(?:y|f\s*\(\s*x\s*\))\s*=(?!=)\s*(.+)$/i.exec(s);
    if (def) s = def[1].trim();
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
    (it.fns || []).forEach((src, k) => {
      const e = plot.errors[k];
      if (!String(src).trim()) return;
      out.legend.push({ color: COLOURS[k % COLOURS.length], text: 'y = ' + String(src).trim().replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, ''), error: e });
    });
    return out;
  }

  const FONT = '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';

  function draw(ctx, it, r) {
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
    // the formulas, top left of the plot, on a wash of paper so they read over the curves
    ctx.textAlign = 'left';
    ctx.font = `600 ${fs}px ${FONT}`;
    P.legend.forEach((l, i) => {
      const lx = P.plot.x + fs * 0.5, ly = P.plot.y + fs * (1.3 + i * 1.35);
      const text = l.error ? l.text + '  — ' + l.error : l.text;
      const tw = ctx.measureText(text).width;
      ctx.globalAlpha = a0 * 0.85; ctx.fillStyle = paper; ctx.fillRect(lx - fs * 0.3, ly - fs * 1.05, tw + fs * 0.6, fs * 1.35);
      ctx.globalAlpha = a0; ctx.fillStyle = l.error ? '#e5484d' : l.color; ctx.fillText(text, lx, ly);
    });
    if (P.note) { ctx.fillStyle = ink; ctx.globalAlpha = a0 * 0.5; ctx.textAlign = 'center'; ctx.fillText(P.note, P.plot.x + P.plot.w / 2, P.plot.y + P.plot.h / 2); }
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function svg(it) {
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
    const changed = () => { app.scene.touch(it); it._lines = null; app.requestDraw(); };
    const list = el('div', { class: 'graph-fns' });
    const field = (label, value, set, cls) => {
      const f = el('input', { class: 'graph-num' + (cls ? ' ' + cls : ''), type: 'text', inputmode: 'decimal', spellcheck: 'false', 'aria-label': label });
      f.value = String(value);
      f.addEventListener('input', () => {
        const v = D.math.loaded ? D.math.evaluate(f.value, D.math.scope(), { angle: 'rad' }) : { ok: true, value: +f.value };
        const n = v && v.ok ? toNum(v.value) : NaN;
        f.classList.toggle('bad', !isFinite(n));
        if (isFinite(n)) { set(n); changed(); }
      });
      return f;
    };
    const rows = () => {
      list.replaceChildren(...it.fns.map((src, k) => {
        const f = el('input', { class: 'graph-fn', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'x^2 − 3', 'aria-label': `Function ${k + 1}` });
        f.value = src;
        f.addEventListener('input', () => { it.fns = it.fns.slice(); it.fns[k] = f.value; changed(); });
        // the calculator's keys type into whichever function was last tapped
        f.addEventListener('focus', () => { if (D.calc && D.calc.typeInto) D.calc.typeInto(f); });
        const write = el('button', { class: 'icon graph-w', type: 'button', title: 'Write it with the pen', 'aria-label': 'Write this function with the pen',
          html: '<svg viewBox="0 0 24 24"><path d="M4 20l4.5-1.2L20 7.3a2 2 0 0 0 0-2.8l-.5-.5a2 2 0 0 0-2.8 0L5.2 15.5z"/><path d="M14.5 6.5l3 3"/></svg>',
          onclick: () => D.inkmath && D.inkmath.writePad(app, { title: `Write y${it.fns.length > 1 ? ' ' + (k + 1) : ''} =`, start: f.value, near: box,
            use: text => { f.value = text.replace(/^\s*y\s*=\s*/i, ''); f.dispatchEvent(new Event('input')); } }) });
        return el('div', { class: 'graph-row' },
          el('span', { class: 'graph-sw', style: `background:${COLOURS[k % COLOURS.length]}` }), el('span', { class: 'graph-y' }, 'y ='), f, write,
          el('button', { class: 'icon graph-x', type: 'button', title: 'Remove', 'aria-label': 'Remove this function', onclick: () => { it.fns = it.fns.filter((_, i) => i !== k); changed(); rows(); },
            html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>' }));
      }));
    };
    rows();
    let x0f, x1f;
    const yFrom = field('y from', it.y0, v => { it.y0 = v; }), yTo = field('y to', it.y1, v => { it.y1 = v; });
    const yRow = el('div', { class: 'graph-range' }, el('span', {}, 'y from'), yFrom, el('span', {}, 'to'), yTo);
    const showY = () => { yRow.hidden = it.yAuto !== false; };
    const seg = (opts, now, set) => {
      const s = el('div', { class: 'seg' });
      const paint = v => { for (const b of s.children) b.classList.toggle('on', b.dataset.v === String(v)); };
      for (const [v, label] of opts) {
        const b = el('button', { type: 'button', 'data-v': String(v) }, label);
        b.onclick = () => { set(v); paint(v); changed(); };
        s.appendChild(b);
      }
      paint(now);
      return s;
    };
    const box = el('div', { class: 'graph-pop', role: 'dialog', 'aria-label': 'Graph' },
      el('div', { class: 'graph-head' }, el('span', {}, 'Graph'),
        el('button', { class: 'icon', type: 'button', title: 'Done', 'aria-label': 'Done', onclick: () => close(),
          html: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' })),
      list,
      el('div', { class: 'graph-acts' },
        el('button', { class: 'btn graph-add', type: 'button', onclick: () => { it.fns = it.fns.concat(''); changed(); rows(); const fs = list.querySelectorAll('.graph-fn'); if (fs.length) fs[fs.length - 1].focus(); } }, '+ Another'),
        D.inkmath ? el('button', { class: 'btn graph-add', type: 'button', onclick: () => D.inkmath.writePad(app, { title: 'Write y =', near: box,
          use: text => { it.fns = it.fns.filter(s => s.trim()).concat(text.replace(/^\s*y\s*=\s*/i, '')); changed(); rows(); } }) }, '✎ Write one') : null,
        D.calc ? el('button', { class: 'btn graph-add', type: 'button', onclick: () => {
          D.calc.open();
          const fs = list.querySelectorAll('.graph-fn'), f = fs[fs.length - 1];
          if (f) { f.focus(); D.calc.typeInto(f); }
        } }, 'Keypad') : null),
      el('div', { class: 'graph-range' }, el('span', {}, 'x from'), x0f = field('x from', it.x0, v => { it.x0 = v; }), el('span', {}, 'to'), x1f = field('x to', it.x1, v => { it.x1 = v; })),
      // the usual ranges, a tap each, so the pen need not write numbers
      el('div', { class: 'graph-presets' }, ...PRESETS.map(([label, a, b]) => el('button', { class: 'btn', type: 'button', onclick: () => {
        it.x0 = a; it.x1 = b; x0f.value = fmtRange(a); x1f.value = fmtRange(b); x0f.classList.remove('bad'); x1f.classList.remove('bad'); changed();
      } }, label))),
      el('div', { class: 'graph-opts' },
        seg([[true, 'y: fit'], [false, 'y: set']], it.yAuto !== false, v => {
          if (!v && it._lines) { it.y0 = +it._lines.y0.toPrecision(3); it.y1 = +it._lines.y1.toPrecision(3); yFrom.value = it.y0; yTo.value = it.y1; }
          it.yAuto = v; showY();
        }),
        seg([['rad', 'Radians'], ['deg', 'Degrees']], it.angle || 'rad', v => { it.angle = v; })),
      yRow,
      el('p', { class: 'graph-note' }, 'Anything the calculator reads: sin(x), 3x^2 − 2, e^(−x/2)·cos(3x), sqrt(x). Constants such as g and π work.'));
    showY();
    document.body.appendChild(box);
    // beside the graph, on whichever side has room
    const b = app.scene.bbox(it), a = app.camera.toScreen(b.x2, b.y), l = app.camera.toScreen(b.x, b.y);
    const W = 340;
    const left = a.x + 12 + W < innerWidth - 8 ? a.x + 12 : Math.max(8, l.x - 12 - W);
    box.style.left = U.clamp(left, 8, Math.max(8, innerWidth - W - 8)) + 'px';
    box.style.top = U.clamp(a.y, 64, Math.max(64, innerHeight - 420)) + 'px';
    pop = {
      app, it, box,
      // the keypad and the writing pad work for the editor: pressing them does not close it
      away: e => { if (!box.contains(e.target) && !(e.target.closest && e.target.closest('#calc-panel, .inkmath-write'))) close(); },
      key: e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    };
    setTimeout(() => { if (pop && pop.box === box) { addEventListener('pointerdown', pop.away, true); addEventListener('keydown', pop.key, true); } }, 0);
    D.math.ready().then(() => { if (pop && pop.it === it) { it._lines = null; app.requestDraw(); } }).catch(() => {});
    if (app.pointerType === 'mouse') setTimeout(() => { const f = list.querySelector('.graph-fn'); if (f) f.focus(); }, 30);
    return { el: box, close };
  }

  const PRESETS = [['±1', -1, 1], ['±10', -10, 10], ['±100', -100, 100], ['0…10', 0, 10], ['±2π', -2 * Math.PI, 2 * Math.PI], ['0…2π', 0, 2 * Math.PI]];
  const fmtRange = v => Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : Math.abs(Math.abs(v) - 2 * Math.PI) < 1e-9 ? (v < 0 ? '-2pi' : '2pi') : String(+v.toFixed(4));

  /** the x range, zoomed about its middle (k < 1 in, > 1 out) */
  function zoomX(it, k) {
    const m = (it.x0 + it.x1) / 2, h = (it.x1 - it.x0) / 2 * k;
    it.x0 = +(m - h).toPrecision(6); it.x1 = +(m + h).toPrecision(6);
  }

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
      const app = ui.app, one = items.length === 1 && items[0];
      ui.add(
        ui.group(items.length > 1 ? items.length + ' graphs' : 'Graph', el('div', { class: 'graph-acts' },
          one ? el('button', { class: 'btn', type: 'button', onclick: () => edit(app, one) }, 'Functions and ranges') : null,
          el('button', { class: 'btn', type: 'button', title: 'Zoom in on x', onclick: () => ui.apply(items, it => { zoomX(it, 0.5); it._lines = null; }) }, 'x in'),
          el('button', { class: 'btn', type: 'button', title: 'Zoom out on x', onclick: () => ui.apply(items, it => { zoomX(it, 2); it._lines = null; }) }, 'x out'),
          el('button', { class: 'btn', type: 'button', title: 'Fit y to the curves', onclick: () => ui.apply(items, it => { it.yAuto = true; it._lines = null; }) }, 'Fit y'))),
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

  D.graph = { sample, parts, make, add, edit, close, ticks, graphable, beside, COLOURS };
})(window.DPO);

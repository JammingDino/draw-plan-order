/* ── inkmath.js ── handwritten maths, read and answered ───────────────
   Like Math Notes: write a sum by hand, finish it with "=", pause, and
   the answer appears beside the "=" in a handwriting-like hand. A line
   such as "x = 5" defines x for the lines below it, and those answers
   follow when it changes. With strokes selected, "Solve this ink" in the
   long-press menu or the action bar shows what was read, in a field
   that fixes a misreading in one tap, with the answer and Insert, Open
   in calculator and Teach.

   Everything is offline and small. The recogniser is a point-cloud
   matcher of the $P family (Vatavu, Anthony & Wobbrock, 2012): a symbol
   is resampled to 32 points and compared, as an unordered cloud, with
   templates — so stroke order, stroke direction and the number of
   strokes (a 5 in one stroke or two, a + either way round) do not
   matter. The templates are not shipped as data: they are synthesised
   on first use from a few dozen glyph outlines below, each bent into a
   handful of slants, widths and wobbles. What a point cloud cannot see —
   whether a dash is a minus or a fraction bar, whether a 2 is an
   exponent — is a structural pass over the boxes afterwards. Strokes a
   person corrects become personal templates (Teach), kept in
   localStorage and capped.

   It must never get in the way of writing. The stroke handler does a
   few comparisons unless the stroke could be half of an "="; reading
   waits for the pen to rest; and a line that is not read with
   confidence, uses a letter nothing defines, or does not work out, is
   left alone without a word.

   ── The answers ──────────────────────────────────────────────────────

   { type: 'inkresult', x, y, size, text, expr, src, eq, fp, uses, color, lead }
   x, y   where the text starts, on its baseline
   text   the answer as shown;  expr  what was read (and worked out)
   src    the ids of the strokes it was read from, eq the two of the "="
   fp     a fingerprint of those strokes, to notice when they change
   uses   the variables it depends on;  lead  true: drawn as "= text"

   An answer is derived from the ink, not written, so it is never an
   undo step of its own: it is added and removed outside the history,
   and follows the strokes. Undo a stroke of the line and the answer
   goes; redo it and the answer comes back. Erasing or moving an answer
   yourself is an ordinary edit, and undone like one.

   ── For tests and features ───────────────────────────────────────────

   D.inkmath.read(strokes, eqIds?, allow?) → reading     strokes: items with pts [x,y,p,…]
     { ok, shaped, close, conf, worst, expr, lhs, rhs, eq: 'end'|'mid'|null, syms, map, H, base }
     eqIds: the two strokes known to be the "=" (read as one, whatever
     their shape); allow: ch → bool, the symbols the line may hold
   D.inkmath.state.eqs   each "=" found keeps .why ('answered', 'unsure',
     'eval', 'shape', 'not-a-sum', 'no-end', 'alone', 'right') and .reading
   D.inkmath.state.marks the "?" (and "Show why" notes) on the page now
   D.inkmath.classify(strokes, H?) → [{ ch, d }] best first
   D.inkmath.flush(app) → Promise        run waiting work now, not after the pause
   D.inkmath.solve(app, strokes, opts?)  the "Solve this ink" popover       */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;
  /* The matcher's inner loops, kept off the global object: under the
     tests' vm realm every read of a global is a slow lookup. */
  const { sqrt, abs, floor, min: mmin } = Math, INF = 1 / 0;

  /* ══ glyphs ══════════════════════════════════════════════════════════
     Control points of each symbol as it is usually handwritten, in a box
     where a digit is 1 tall (y down, the baseline at 1). Each stroke is
     run through a Catmull–Rom spline, so a corner is written by repeating
     its point. Several shapes per symbol: the ways people actually write
     a 4, a 7 or an a differ more than any jitter can cover. */
  const arc = (cx, cy, rx, ry, a0, a1, n = 14) => {
    const o = [];
    for (let i = 0; i <= n; i++) {
      const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
      o.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    }
    return o;
  };
  const mirror = (strokes, w) => strokes.map(s => s.map((v, i) => i % 2 ? v : w - v));

  const PAREN = [[0.36, -0.08, 0.12, 0.2, 0.04, 0.5, 0.12, 0.8, 0.36, 1.08]];
  const PAREN2 = [[0.3, -0.08, 0.1, 0.25, 0.08, 0.5, 0.1, 0.75, 0.3, 1.08]];

  const GLYPHS = [
    ['0', [arc(0.3, 0.5, 0.28, 0.5, -90, 270)]],
    ['0', [arc(0.3, 0.5, 0.26, 0.5, -110, 280)]],
    ['1', [[0.12, 0.22, 0.32, 0, 0.32, 0, 0.32, 1]]],
    ['1', [[0.14, 0.18, 0.3, 0.02, 0.3, 0.02, 0.3, 1], [0.08, 1, 0.52, 1]]],
    ['2', [[0.04, 0.22, 0.18, 0.04, 0.38, 0, 0.56, 0.12, 0.56, 0.32, 0.4, 0.55, 0.02, 1, 0.02, 1, 0.62, 1]]],
    ['2', [[0.06, 0.16, 0.3, 0, 0.55, 0.12, 0.5, 0.4, 0.05, 0.96, 0.05, 0.96, 0.25, 0.9, 0.62, 0.98]]],
    ['3', [[0.05, 0.1, 0.3, 0, 0.55, 0.13, 0.5, 0.35, 0.25, 0.47, 0.25, 0.47, 0.55, 0.6, 0.58, 0.85, 0.3, 1, 0.03, 0.88]]],
    ['3', [[0.04, 0.02, 0.56, 0.02, 0.56, 0.02, 0.24, 0.42, 0.52, 0.56, 0.58, 0.82, 0.32, 1, 0.04, 0.9]]],
    ['4', [[0.42, 0, 0.02, 0.66, 0.02, 0.66, 0.64, 0.66], [0.46, 0.3, 0.46, 1]]],
    ['4', [[0.06, 0, 0.04, 0.6, 0.04, 0.6, 0.64, 0.6], [0.48, 0.02, 0.48, 1]]],
    ['4', [[0.46, 1, 0.46, 0, 0.46, 0, 0.02, 0.66, 0.02, 0.66, 0.66, 0.66]]],
    ['5', [[0.12, 0, 0.08, 0.45, 0.08, 0.45, 0.32, 0.38, 0.55, 0.52, 0.56, 0.8, 0.32, 1, 0.02, 0.9], [0.12, 0, 0.58, 0]]],
    ['5', [[0.58, 0, 0.12, 0, 0.12, 0, 0.08, 0.45, 0.08, 0.45, 0.32, 0.38, 0.55, 0.52, 0.56, 0.8, 0.32, 1, 0.02, 0.9]]],
    ['6', [[0.5, 0.04, 0.3, 0, 0.1, 0.25, 0.04, 0.65, 0.2, 0.98, 0.45, 0.95, 0.56, 0.72, 0.42, 0.5, 0.18, 0.52, 0.05, 0.7]]],
    ['6', [[0.46, 0, 0.16, 0.3, 0.06, 0.66, 0.24, 0.98, 0.5, 0.88, 0.5, 0.6, 0.26, 0.5, 0.08, 0.66]]],
    ['7', [[0.02, 0, 0.6, 0, 0.6, 0, 0.22, 1]]],
    ['7', [[0.02, 0, 0.6, 0, 0.6, 0, 0.22, 1], [0.14, 0.5, 0.56, 0.5]]],
    ['7', [[0.02, 0.16, 0.02, 0, 0.02, 0, 0.6, 0, 0.6, 0, 0.28, 1]]],
    ['8', [[0.52, 0.12, 0.3, 0, 0.08, 0.12, 0.12, 0.35, 0.3, 0.48, 0.52, 0.62, 0.56, 0.86, 0.3, 1, 0.04, 0.86, 0.08, 0.64, 0.3, 0.48, 0.48, 0.36, 0.54, 0.14, 0.32, 0]]],
    ['8', [arc(0.3, 0.25, 0.22, 0.25, -90, 270, 12), arc(0.3, 0.74, 0.27, 0.26, -90, 270, 12)]],
    ['9', [[0.55, 0.18, 0.32, 0, 0.06, 0.12, 0.06, 0.36, 0.3, 0.48, 0.55, 0.3, 0.55, 0.18, 0.55, 0.18, 0.52, 1]]],
    ['9', [[0.55, 0.2, 0.32, 0, 0.06, 0.12, 0.06, 0.36, 0.3, 0.48, 0.55, 0.3, 0.55, 0.18, 0.55, 0.18, 0.55, 0.72, 0.4, 0.98, 0.14, 0.94]]],
    ['9', [arc(0.3, 0.24, 0.25, 0.24, 0, 360, 12), [0.56, 0.1, 0.54, 1]]],
    ['+', [[0, 0.5, 1, 0.5], [0.5, 0, 0.5, 1]]],
    ['x', [[0, 0, 1, 1], [1, 0, 0, 1]]],
    ['x', [[0.05, 0, 0.42, 0.18, 0.5, 0.5, 0.42, 0.82, 0.05, 1], [0.95, 0, 0.58, 0.18, 0.5, 0.5, 0.58, 0.82, 0.95, 1]]],
    // the round school x: two bowls back to back, ɔ then c, touching in the middle
    ['x', [arc(0.02, 0.5, 0.46, 0.5, -75, 75, 10), arc(0.98, 0.5, 0.46, 0.5, 105, 255, 10)]],
    ['(', PAREN], ['(', PAREN2],
    [')', mirror(PAREN, 0.4)], [')', mirror(PAREN2, 0.4)],
    ['^', [[0, 1, 0.5, 0, 0.5, 0, 1, 1]]],
    ['√', [[0, 0.62, 0.12, 0.52, 0.12, 0.52, 0.32, 1, 0.32, 1, 0.7, 0]]],
    ['√', [[0, 0.6, 0.14, 0.52, 0.14, 0.52, 0.3, 1, 0.3, 1, 0.56, 0, 0.56, 0, 0.9, 0]]],
    ['y', [[0, 0, 0.3, 0.6], [0.62, 0, 0.1, 1.45]]],
    ['y', [[0.02, 0, 0.06, 0.42, 0.3, 0.62, 0.56, 0.42, 0.58, 0, 0.58, 0, 0.58, 1.15, 0.36, 1.45, 0.06, 1.3]]],
    ['z', [[0, 0, 0.7, 0, 0.7, 0, 0, 1, 0, 1, 0.72, 1]]],
    ['z', [[0, 0, 0.7, 0, 0.7, 0, 0, 1, 0, 1, 0.72, 1], [0.12, 0.5, 0.6, 0.5]]],
    ['a', [[0.62, 0.18, 0.4, 0, 0.12, 0.12, 0.04, 0.6, 0.22, 0.98, 0.5, 0.86, 0.62, 0.5, 0.62, 0.05, 0.62, 0.05, 0.62, 0.85, 0.72, 1]]],
    ['a', [arc(0.33, 0.5, 0.3, 0.48, -20, 330, 12), [0.64, 0, 0.64, 1]]],
    ['b', [[0.06, -0.7, 0.05, 1, 0.05, 1, 0.05, 0.55, 0.3, 0.05, 0.58, 0.25, 0.6, 0.75, 0.32, 1, 0.06, 0.9]]],
    ['b', [[0.06, -0.7, 0.06, 1], arc(0.32, 0.5, 0.27, 0.48, 180, 540, 12)]],
    ['c', [arc(0.38, 0.5, 0.38, 0.5, -40, -320)]],
    ['n', [[0.03, 0, 0.03, 1, 0.03, 1, 0.06, 0.4, 0.3, 0.02, 0.55, 0.15, 0.6, 1]]],
    ['n', [[0.03, 0, 0.03, 1], [0.04, 0.35, 0.3, 0.02, 0.56, 0.15, 0.6, 1]]],
    ['t', [[0.3, -0.55, 0.28, 0.85, 0.4, 1, 0.58, 0.9], [0.02, 0.02, 0.6, 0.02]]],
    ['t', [[0.3, -0.55, 0.3, 1], [0.02, 0.02, 0.62, 0.02]]],
    ['θ', [arc(0.3, 0.5, 0.28, 0.5, -90, 270), [0.04, 0.5, 0.56, 0.5]]],
    ['π', [[0, 0.12, 0.3, 0.02, 1, 0.02], [0.32, 0.04, 0.28, 1], [0.7, 0.04, 0.72, 0.88, 0.85, 1]]],
    ['π', [[0, 0.02, 1, 0.02], [0.3, 0.02, 0.3, 1], [0.7, 0.02, 0.7, 1]]]
  ];

  /* What a template-matched label may be read as. The rules below the
     matcher give "−", "=", ".", "·", "/", "÷", "1", "+" and "x" too. */
  const LABELS = [...new Set(GLYPHS.map(g => g[0]))];
  /* what can be taught: the shapes above, and the ones only rules read */
  const TEACHABLE = LABELS.concat(['/', '÷']);
  const DIGIT = /[0-9]/, LETTER = /[a-zπθ]/;

  /* ══ synthesis ═══════════════════════════════════════════════════════ */
  /* A small seeded generator, so the templates — and so the readings — are
     the same on every machine and in every test run. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Catmull–Rom through the control points, `per` samples a span */
  function spline(c, per = 6) {
    const n = c.length / 2;
    if (n < 2) return c.slice();
    const out = [];
    const P = i => { i = i < 0 ? 0 : i >= n ? n - 1 : i; return [c[i * 2], c[i * 2 + 1]]; };
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = P(i - 1), [x1, y1] = P(i), [x2, y2] = P(i + 1), [x3, y3] = P(i + 2);
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        out.push(
          0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
          0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3));
      }
    }
    out.push(c[c.length - 2], c[c.length - 1]);
    return out;
  }

  /** a glyph as it might come off a pen: wobbled, slanted, squeezed, turned */
  function warp(strokes, r, amt) {
    const slant = (r() - 0.45) * 0.6 * amt, rot = (r() - 0.5) * 0.16 * amt;
    const sx = 1 + (r() - 0.5) * 0.45 * amt, wob = 0.035 * amt;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    return strokes.map(s => {
      const p = spline(s.map(v => v + (r() - 0.5) * 2 * wob));
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i] * sx - (p[i + 1] - 0.5) * slant, y = p[i + 1];
        p[i] = x * cs - y * sn; p[i + 1] = x * sn + y * cs;
      }
      return p;
    });
  }

  /* ══ the point cloud ($P) ═════════════════════════════════════════ */
  const N = 32;

  /**
   * Strokes ([x,y,x,y…] each) → N points spread evenly along the ink,
   * scaled into a unit box and centred on their centroid. Gaps between
   * strokes are not ink, so they take no points; that is what makes
   * the number and order of strokes not matter.
   */
  function cloud(strokes) {
    let len = 0;
    for (const s of strokes) for (let i = 2; i < s.length; i += 2) len += Math.hypot(s[i] - s[i - 2], s[i + 1] - s[i - 1]);
    const out = new Float64Array(N * 2);
    let k = 0;
    if (len <= 0) {
      // all dots: put the points on them, in turn
      for (; k < N; k++) { const s = strokes[k % strokes.length]; out[k * 2] = s[0]; out[k * 2 + 1] = s[1]; }
    } else {
      const I = len / (N - 1);
      let acc = 0;
      for (const s of strokes) {
        let px = s[0], py = s[1];
        if (k === 0) { out[0] = px; out[1] = py; k = 1; }
        for (let i = 2; i < s.length && k < N; i += 2) {
          let qx = s[i], qy = s[i + 1];
          let d = Math.hypot(qx - px, qy - py);
          while (d > 0 && acc + d >= I && k < N) {
            const t = (I - acc) / d;
            px = px + t * (qx - px); py = py + t * (qy - py);
            out[k * 2] = px; out[k * 2 + 1] = py; k++;
            d = Math.hypot(qx - px, qy - py);
            acc = 0;
          }
          acc += d; px = qx; py = qy;
        }
      }
      const last = strokes[strokes.length - 1];
      for (; k < N; k++) { out[k * 2] = last[last.length - 2]; out[k * 2 + 1] = last[last.length - 1]; }
    }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, cx = 0, cy = 0;
    for (let i = 0; i < N; i++) {
      const x = out[i * 2], y = out[i * 2 + 1];
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
    }
    const size = Math.max(x2 - x1, y2 - y1) || 1;
    for (let i = 0; i < N; i++) { cx += out[i * 2]; cy += out[i * 2 + 1]; }
    cx /= N; cy /= N;
    for (let i = 0; i < N; i++) { out[i * 2] = (out[i * 2] - cx) / size; out[i * 2 + 1] = (out[i * 2 + 1] - cy) / size; }
    // the aspect is kept beside the points, not on the array: a named
    // property on a typed array slows every read of its elements
    return { p: out, a: Math.log(((x2 - x1) + size * 0.04) / ((y2 - y1) + size * 0.04)), g: gridOf(out) };
  }

  /* A coarse picture of the cloud — how much ink falls in each cell of a
     6×6 grid, shared out between neighbouring cells — to rank the
     templates cheaply before the real match. Like the cloud, it does not
     care how the ink was drawn. */
  const G = 6, GR = 0.7;
  function gridOf(p) {
    const g = new Float64Array(G * G);
    for (let i = 0; i < N; i++) {
      const fx = U.clamp((p[i * 2] + GR) / (2 * GR) * (G - 1), 0, G - 1), fy = U.clamp((p[i * 2 + 1] + GR) / (2 * GR) * (G - 1), 0, G - 1);
      const ix = mmin(floor(fx), G - 2), iy = mmin(floor(fy), G - 2), tx = fx - ix, ty = fy - iy;
      g[iy * G + ix] += (1 - tx) * (1 - ty); g[iy * G + ix + 1] += tx * (1 - ty);
      g[(iy + 1) * G + ix] += (1 - tx) * ty; g[(iy + 1) * G + ix + 1] += tx * ty;
    }
    return g;
  }
  function gridDistance(a, b) {
    let d = 0;
    for (let i = 0; i < G * G; i++) d += abs(a[i] - b[i]);
    return d;
  }

  /* The full match, $P's greedy pairing tried from several starting
     points each way round. Every try reads the same point-to-point
     distances, so they are worked out once, into a table. */
  const used = new Uint8Array(N), DIST = new Float64Array(N * N);
  function greedy(start, swap, best) {
    used.fill(0);
    let sum = 0, i = start;
    for (let step = 0; step < N; step++) {
      let min = INF, idx = 0;
      for (let j = 0; j < N; j++) {
        if (used[j]) continue;
        const d = swap ? DIST[j * N + i] : DIST[i * N + j];
        if (d < min) { min = d; idx = j; }
      }
      used[idx] = 1;
      sum += (1 - step / N) * min;
      if (sum >= best) return sum;
      i = (i + 1) % N;
    }
    return sum;
  }
  const STEP = floor(sqrt(N));
  function match(a, b, best = INF) {
    for (let i = 0; i < N; i++) {
      const ax = a[i * 2], ay = a[i * 2 + 1];
      for (let j = 0; j < N; j++) { const dx = ax - b[j * 2], dy = ay - b[j * 2 + 1]; DIST[i * N + j] = sqrt(dx * dx + dy * dy); }
    }
    for (let i = 0; i < N; i += STEP) {
      const d1 = greedy(i, false, best);
      if (d1 < best) best = d1;
      const d2 = greedy(i, true, best);
      if (d2 < best) best = d2;
    }
    return best;
  }

  /* ── the templates: built on first use ───────────────────────────── */
  const VARIANTS = 7;
  let TEMPLATES = null;
  function templates() {
    if (TEMPLATES) return TEMPLATES;
    const r = rng(0x5eed);
    TEMPLATES = [];
    for (const [ch, strokes] of GLYPHS) {
      TEMPLATES.push({ ch, c: cloud(strokes.map(s => spline(s))) });
      for (let v = 0; v < VARIANTS; v++) TEMPLATES.push({ ch, c: cloud(warp(strokes, r, 1)) });
    }
    for (const t of learned()) TEMPLATES.push(t);
    return TEMPLATES;
  }

  /* ── personal templates ──────────────────────────────────────────── */
  const LEARN_KEY = 'dpo:inkmath-learned';
  const LEARN_PER = 12, LEARN_MAX = 400;
  let LEARNED = null;
  function learned() {
    if (LEARNED) return LEARNED;
    LEARNED = [];
    try {
      const raw = JSON.parse(localStorage.getItem(LEARN_KEY) || '[]');
      for (const t of raw) {
        if (!t || typeof t.ch !== 'string' || !Array.isArray(t.p) || t.p.length !== N * 2) continue;
        const p = Float64Array.from(t.p);
        LEARNED.push({ ch: t.ch, c: { p, a: +t.a || 0, g: gridOf(p) }, mine: true, b: t.b || 0, s: Array.isArray(t.s) ? t.s : null });
      }
    } catch (_) { }
    return LEARNED;
  }
  function saveLearned() {
    try {
      localStorage.setItem(LEARN_KEY, JSON.stringify(LEARNED.map(t => ({
        ch: t.ch, a: U.round(t.c.a, 3), p: Array.from(t.c.p, v => U.round(v, 3)), b: t.b, s: t.s
      }))));
    } catch (_) { }
  }
  /* Every sample belongs to a batch: the one thing that was taught at
     once (a symbol on the pad, a chip, or all the symbols one Teach put
     right), so Undo takes back exactly the last thing done. */
  let lastBatch = 0;
  const batch = () => (lastBatch = Math.max(Date.now(), lastBatch + 1));

  /** the strokes, small, to show the sample by: fitted to a unit box, a dozen points a stroke */
  function sketch(strokes) {
    const b = boxOf(strokes), k = 1 / Math.max(b.w, b.h, 1e-9);
    return strokes.map(s => {
      const xy = s.xy, n = xy.length / 2, step = Math.max(1, Math.floor(n / 12)), o = [];
      for (let i = 0; i < n; i += step) o.push(U.round((xy[i * 2] - b.x) * k, 2), U.round((xy[i * 2 + 1] - b.y) * k, 2));
      o.push(U.round((xy[xy.length - 2] - b.x) * k, 2), U.round((xy[xy.length - 1] - b.y) * k, 2));
      return o;
    });
  }

  /** strokes the person says are `ch`: a template of their own from now on */
  function teach(strokes, ch, b = batch()) {
    learned();
    // the board's lines read again once a run of teaching is over, not once a sample
    if (!rereadSoon) rereadSoon = setTimeout(() => { rereadSoon = 0; rereadAll(); }, 0);
    const c = cloud(strokes.map(s => s.xy));
    const t = { ch, c, mine: true, b, s: sketch(strokes) };
    LEARNED.push(t);
    // the oldest of that symbol go first, then the oldest of all
    let mine = LEARNED.filter(x => x.ch === ch);
    while (mine.length > LEARN_PER) { LEARNED.splice(LEARNED.indexOf(mine[0]), 1); mine = mine.slice(1); }
    while (LEARNED.length > LEARN_MAX) LEARNED.shift();
    saveLearned();
    TEMPLATES = null;
    return t;
  }
  function forget() { LEARNED = []; saveLearned(); TEMPLATES = null; }
  let rereadSoon = 0;
  /** every "=" on the board read again: what was taught may change what they say */
  function rereadAll() {
    const app = S.app;
    if (!app) return;
    for (const e of S.eqs.values()) queue('eq:' + e.key, { kind: 'eq', ids: e.ids });
    arm(app);
  }

  /** take back the last thing taught (one batch); gives what went */
  function undoTeach() {
    learned();
    if (!LEARNED.length) return [];
    const b = LEARNED[LEARNED.length - 1].b;
    const gone = LEARNED.filter(t => t.b === b);
    LEARNED = LEARNED.filter(t => t.b !== b);
    saveLearned(); TEMPLATES = null;
    return gone;
  }
  /** every sample of one symbol forgotten */
  function forgetSymbol(ch) {
    learned();
    const n = LEARNED.length;
    LEARNED = LEARNED.filter(t => t.ch !== ch);
    saveLearned(); TEMPLATES = null;
    return n - LEARNED.length;
  }
  /** one sample forgotten */
  function forgetSample(t) {
    learned();
    const i = LEARNED.indexOf(t);
    if (i < 0) return false;
    LEARNED.splice(i, 1);
    saveLearned(); TEMPLATES = null;
    return true;
  }
  const samplesOf = ch => learned().filter(t => t.ch === ch);

  /* ══ strokes, measured ══════════════════════════════════════════════ */
  /** what the reader needs of a stroke: its points, box and shape */
  function feature(it) {
    const p = it.pts, xy = new Array((p.length / 3) * 2);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, len = 0;
    for (let i = 0, j = 0; i < p.length; i += 3, j += 2) {
      const x = p[i], y = p[i + 1];
      xy[j] = x; xy[j + 1] = y;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (j) len += Math.hypot(x - xy[j - 2], y - xy[j - 1]);
    }
    const n = xy.length;
    const ax = xy[0], ay = xy[1], bx = xy[n - 2], by = xy[n - 1];
    const chord = Math.hypot(bx - ax, by - ay);
    // how far the ink strays from the line between its ends, either side
    let left = 0, right = 0;
    if (chord > 0) {
      for (let i = 2; i < n - 2; i += 2) {
        const d = ((bx - ax) * (xy[i + 1] - ay) - (by - ay) * (xy[i] - ax)) / chord;
        if (d > left) left = d; else if (-d > right) right = -d;
      }
    }
    const w = x2 - x1, h = y2 - y1;
    const dev = chord > 0 ? Math.max(left, right) / chord : 1;
    // 0 is flat, 90 upright; lean > 0 when the top end is to the right (a "/")
    const ang = Math.atan2(Math.abs(by - ay), Math.abs(bx - ax)) * 180 / Math.PI;
    const top = ay < by ? [ax, bx] : [bx, ax];
    const straight = chord > 0 && dev < 0.085 && len < chord * 1.18;
    return {
      id: it.id, item: it, xy, len, chord, dev, ang, lean: Math.sign(top[0] - top[1]),
      bulge: chord > 0 ? (left - right) / chord : 0,
      straight,
      /* a dash as a pen writes it: near level, and straight or only bowed
         or hooked at an end — real bars are seldom ruled */
      dash: ang < 24 && (straight || (chord > 0 && dev < 0.32 && len < chord * 1.45 && h < 0.5 * w)),
      x: x1, y: y1, x2, y2, w, h, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2
    };
  }

  const boxOf = list => {
    let x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const s of list) { if (s.x < x) x = s.x; if (s.y < y) y = s.y; if (s.x2 > x2) x2 = s.x2; if (s.y2 > y2) y2 = s.y2; }
    return { x, y, x2, y2, w: x2 - x, h: y2 - y, cx: (x + x2) / 2, cy: (y + y2) / 2 };
  };
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  const flat = (s, H) => s.dash && s.w > 0.18 * H;
  const isDot = (s, H) => Math.max(s.w, s.h) < 0.2 * H && s.len < 0.5 * H;

  /** how tall a symbol is on this line: the middle of the tall ones, dashes and dots aside */
  function lineHeight(strokes) {
    const hs = strokes.filter(s => !s.dash).map(s => s.h).filter(h => h > 0);
    if (!hs.length) return Math.max(1, ...strokes.map(s => s.w)) * 0.8;
    const top = Math.max(...hs);
    return Math.max(median(hs.filter(h => h > 0.55 * top)), 1);
  }

  /* ══ one symbol ══════════════════════════════════════════════════════
     Rules first, for the shapes a point cloud cannot tell apart once it
     is scaled to a unit box (a dot, a dash and a fraction bar are the same
     cloud), then the matcher. Each answer has a distance: rules give a
     small fixed one, the matcher its own. */
  const SURE = 0.3;
  function classify(strokes, H) {
    if (!strokes.length) return [];
    if (strokes[0] && !strokes[0].xy) strokes = strokes.map(feature);
    if (!H) H = lineHeight(strokes);
    const base = byRule(strokes, H);
    return learned().length ? yoursFirst(strokes, H, base) : base;
  }

  /* What the person taught comes before the rules and the built-in
     shapes, or teaching a 1 that leans like a / could never take. But
     only when it is plainly theirs: close, clear of anything else they
     taught, and a better match than the shape the rules settled on. The
     dot, the dash and the "=" stay with the rules: the reading of a whole
     line hangs on them. */
  const MINE = 0.85;          // a taught symbol must match at least this well…
  const MINE_ALONE = 0.55;    // …or this well, against a rule's symbol with no shape to compare
  const STRUCTURAL = new Set(['.', '−', '=']);
  function yoursFirst(strokes, H, base) {
    const top = base[0];
    if (!top || STRUCTURAL.has(top.ch)) return base;
    const n = strokes.length, box = boxOf(strokes);
    const c = cloud(strokes.filter(s => !isDot(s, H) || n === 1).map(s => s.xy));
    const near = [];
    for (const t of learned()) {
      if (Math.abs(t.c.a - c.a) > 1.15 || (ALLOW && !ALLOW(t.ch))) continue;
      near.push({ t, d: gridDistance(c.g, t.c.g) + 6 * Math.abs(t.c.a - c.a) });
    }
    if (!near.length) return base;
    near.sort((a, b) => a.d - b.d);
    const best = new Map();
    for (let i = 0; i < near.length && i < 12; i++) {
      const t = near[i].t, d = match(c.p, t.c.p) + sizePenalty(t.ch, box, H);
      if (!best.has(t.ch) || d < best.get(t.ch)) best.set(t.ch, d);
    }
    const ranked = [...best].sort((a, b) => a[1] - b[1]);
    const [ch, d] = ranked[0];
    if (ch === top.ch || (ranked[1] && ranked[1][1] - d < MARGIN)) return base;
    const ref = shapeDistance(c, top.ch, box, H);
    if (ref == null ? d > MINE_ALONE : d > MINE || d + MARGIN > ref) return base;
    return [{ ch, d, mine: true }].concat(base.filter(b => b.ch !== ch));
  }
  /** how well the built-in shapes of `ch` match this cloud; null: it has none */
  function shapeDistance(c, ch, box, H) {
    let d = Infinity;
    for (const t of templates()) if (!t.mine && t.ch === ch) d = Math.min(d, match(c.p, t.c.p, d));
    return d === Infinity ? null : d + sizePenalty(ch, box, H);
  }

  function byRule(strokes, H) {
    const box = boxOf(strokes);
    const n = strokes.length;
    const dots = strokes.filter(s => isDot(s, H));

    if (n === dots.length) return [{ ch: '.', d: SURE }];
    if (n === 1) {
      const s = strokes[0];
      if (s.dash) return [{ ch: '−', d: SURE }];
      if (s.straight) {
        // a 1 stands nearly upright; a / leans further, and reaches past the digits
        const slash = s.lean > 0 && (s.ang < 64 || (s.ang < 72 && s.h > 1.03 * H));
        if (!slash && (s.ang > 62 || (s.lean < 0 && s.ang > 50))) return [{ ch: '1', d: SURE }, { ch: '/', d: SURE * 3 }];
        if (s.lean > 0) return [{ ch: '/', d: SURE }, { ch: '1', d: SURE * 3 }];
      }
      // a bracket: a shallow one-sided bow, upright
      if (s.ang > 60 && s.dev < 0.3 && s.len < s.chord * 1.35 && Math.abs(s.bulge) > 0.06 && s.h > s.w * 2) {
        // the bow's middle is left of its ends for "(" — whichever way it was drawn
        const ys = s.xy, mid = midX(ys, s);
        // a bowed 1 is the same stroke: the line's brackets decide (repair, below)
        return [{ ch: mid < (ys[0] + ys[ys.length - 2]) / 2 ? '(' : ')', d: SURE }, { ch: '1', d: SURE * 3 }];
      }
    }
    if (n === 2 && strokes[0].eqBar && strokes[1].eqBar) return [{ ch: '=', d: SURE }];
    if (n === 2 && strokes.every(s => s.dash)) return [{ ch: '=', d: SURE }];
    if (n === 2 && strokes.every(s => s.straight)) {
      const [a, b] = strokes;
      const t = crossing(a, b);
      if (t) {
        const [h, v] = a.ang < b.ang ? [a, b] : [b, a];
        const th = h === a ? t[0] : t[1], tv = h === a ? t[1] : t[0];
        if (h.ang < 30 && v.ang > 60) {
          // where the bar crosses the stem: the middle for +, high for t
          const tvTop = v.xy[1] < v.xy[v.xy.length - 1] ? tv : 1 - tv;
          if (tvTop < 0.3 && v.h > 0.8 * H) return [{ ch: 't', d: SURE }, { ch: '+', d: SURE * 2 }];
          if (th > 0.2 && th < 0.8 && tvTop > 0.2 && tvTop < 0.8) return [{ ch: '+', d: SURE }];
        }
        // two diagonals crossing near their middles; a y meets at an end
        if (h.ang > 25 && v.ang < 70 && h.lean !== v.lean && t[0] > 0.2 && t[0] < 0.8 && t[1] > 0.2 && t[1] < 0.8) return [{ ch: 'x', d: SURE }];
      }
    }
    if (n === 2) {
      // y as two strokes: a short one meeting the long one part-way down, from above
      const [p, q] = strokes[0].len < strokes[1].len ? strokes : [strokes[1], strokes[0]];
      if (p.dev < 0.15 && q.dev < 0.2 && p.len < 0.75 * q.len && q.ang > 45 && p.ang > 30) {
        const pb = p.xy[1] > p.xy[p.xy.length - 1] ? [p.xy[0], p.xy[1]] : [p.xy[p.xy.length - 2], p.xy[p.xy.length - 1]];
        const qt = q.xy[1] < q.xy[q.xy.length - 1] ? [q.xy[0], q.xy[1]] : [q.xy[q.xy.length - 2], q.xy[q.xy.length - 1]];
        const qb = qt[0] === q.xy[0] && qt[1] === q.xy[1] ? [q.xy[q.xy.length - 2], q.xy[q.xy.length - 1]] : [q.xy[0], q.xy[1]];
        // how far down the long stroke the short one meets it, and how near
        const vx = qb[0] - qt[0], vy = qb[1] - qt[1], ll = vx * vx + vy * vy || 1;
        const t = ((pb[0] - qt[0]) * vx + (pb[1] - qt[1]) * vy) / ll;
        const gap = Math.abs((pb[0] - qt[0]) * vy - (pb[1] - qt[1]) * vx) / Math.sqrt(ll);
        if (t > 0.2 && t < 0.7 && gap < 0.15 * q.len && p.y < pb[1] - 0.2 * p.h && Math.abs(p.y - q.y) < 0.25 * q.h)
          return [{ ch: 'y', d: SURE }];
      }
      // a loop with a bar across its middle: θ (to the matcher it is a 0 with a few points more)
      const bar = strokes.find(s => s.straight && s.ang < 30), loop = strokes.find(s => s !== bar);
      if (bar && loop && !loop.straight && loop.chord < 0.3 * Math.max(loop.w, loop.h) && loop.h > loop.w * 1.2 &&
        bar.cy > loop.y + 0.3 * loop.h && bar.cy < loop.y2 - 0.3 * loop.h && bar.cx > loop.x && bar.cx < loop.x2 && bar.w > 0.5 * loop.w)
        return [{ ch: 'θ', d: SURE }];
    }
    if (n === 3 && dots.length === 2) {
      const bar = strokes.find(s => !isDot(s, H));
      if (bar && bar.dash && dots.some(d => d.cy < bar.cy) && dots.some(d => d.cy > bar.cy)) return [{ ch: '÷', d: SURE }];
    }
    return cloudMatch(strokes.filter(s => !isDot(s, H) || n === 1), box, H);
  }

  /** the x of a stroke's bow at half its height */
  function midX(xy, s) {
    const half = s.cy;
    let best = Infinity, x = s.cx;
    for (let i = 0; i < xy.length; i += 2) { const d = Math.abs(xy[i + 1] - half); if (d < best) { best = d; x = xy[i]; } }
    return x;
  }

  /** where two straight strokes cross, as a fraction along each, or null */
  function crossing(a, b) {
    const ax = a.xy[0], ay = a.xy[1], bx = a.xy[a.xy.length - 2], by = a.xy[a.xy.length - 1];
    const cx = b.xy[0], cy = b.xy[1], dx = b.xy[b.xy.length - 2], dy = b.xy[b.xy.length - 1];
    const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(den) < 1e-9) return null;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
    // a little past the ends still counts: people stop short
    return t > -0.12 && t < 1.12 && u > -0.12 && u < 1.12 ? [t, u] : null;
  }

  /* Two passes, because the full match tries the pairing from seven
     starting points both ways round: first one pairing each way against
     every template, which is enough to rank them, then the full match
     against the closest few. A quarter of the work, and the same answer
     in every case the tests try. */
  const SHORTLIST = 24;
  const UNKNOWN = 9;
  function cloudMatch(strokes, box, H) {
    const c = cloud(strokes.map(s => s.xy));
    const rough = [];
    for (const t of templates()) {
      if (Math.abs(t.c.a - c.a) > 1.15 || (ALLOW && !ALLOW(t.ch))) continue;
      rough.push({ t, d: gridDistance(c.g, t.c.g) + 6 * Math.abs(t.c.a - c.a) });
    }
    rough.sort((a, b) => a.d - b.d);
    const best = new Map();
    let bound = Infinity;
    for (let i = 0; i < rough.length && i < SHORTLIST; i++) {
      const t = rough[i].t, have = best.get(t.ch);
      let d = match(c.p, t.c.p, Math.min(have == null ? Infinity : have, bound * 2.2) / (t.mine ? 0.9 : 1));
      if (t.mine) d *= 0.9;
      if (have == null || d < have) best.set(t.ch, d);
      if (d < bound) bound = d;
    }
    const out = [...best].map(([ch, d]) => ({ ch, d: d + sizePenalty(ch, box, H) })).sort((a, b) => a.d - b.d);
    // a shape no template comes near in proportion (a long wavy line): an unknown, never an empty answer
    if (!out.length) out.push({ ch: '?', d: UNKNOWN });
    out.cloud = c;
    return out;
  }

  /* Letters written at x-height against digits written full height: the
     only thing that tells a small z from a 2, or c from (. */
  const SMALL = new Set(['x', 'z', 'a', 'c', 'n', 'π']);
  function sizePenalty(ch, box, H) {
    const r = box.h / H;
    // read as a sum of numbers, an x is a times sign, and may be any size
    if (ch === 'x' && ALLOW && !ALLOW('y')) return 0;
    if (SMALL.has(ch) && r > 1.05) return (r - 1.05) * 1.2;
    if ((ch === '(' || ch === ')') && r < 0.8) return (0.8 - r) * 3;
    return 0;
  }

  /* ══ a line ══════════════════════════════════════════════════════════
     Strokes → nodes: symbols, fractions and roots, in x order, with
     exponents hung on what they raise. Fractions and long roots are taken
     out first, because their bars and roofs overlap everything under
     them; the rest are grouped into symbols by how much they overlap
     along the line. */
  const MAX_DEPTH = 4;

  function readNodes(strokes, depth = 0) {
    if (!strokes.length) return { nodes: [], H: 1 };
    const H = lineHeight(strokes);
    let rest = strokes.slice();
    const nodes = [];

    if (depth < MAX_DEPTH) {
      // fraction bars, the longest first so an outer bar takes its inner ones with it
      const bars = rest.filter(s => !s.eqBar && s.dash && s.ang < 14 && s.w > 0.45 * H).sort((a, b) => b.w - a.w);
      for (const bar of bars) {
        if (!rest.includes(bar)) continue;
        const pad = 0.12 * bar.w;
        const inRange = s => s !== bar && !s.eqBar && s.cx > bar.x - pad && s.cx < bar.x2 + pad;
        const like = s => s.dash && s.ang < 20 && s.w > 0.5 * bar.w && s.w < 2 * bar.w;      // the other half of an "="
        // clearly over or under it: the bar of a + beside it sits level with it
        const above = rest.filter(s => inRange(s) && s.cy < bar.cy - 0.15 * H && s.y2 < bar.cy + 0.25 * H && bar.cy - s.y2 < 1.3 * H);
        const below = rest.filter(s => inRange(s) && s.cy > bar.cy + 0.15 * H && s.y > bar.cy - 0.25 * H && s.y - bar.cy < 1.3 * H);
        const real = list => list.some(s => !like(s) && (s.h > 0.3 * H || s.w > 0.3 * H));
        if (!real(above) || !real(below)) continue;
        // take in what touches the numerator and denominator, upward and downward
        const num = grow(above, rest, bar, -1, H), den = grow(below, rest, bar, 1, H);
        const taken = new Set([bar, ...num, ...den]);
        rest = rest.filter(s => !taken.has(s));
        nodes.push({ kind: 'frac', bar, num: readNodes(num, depth + 1), den: readNodes(den, depth + 1), box: boxOf([bar, ...num, ...den]), strokes: [bar, ...num, ...den] });
      }
      // long roots: a tick and a roof over what they hold
      for (const s of rest.slice()) {
        if (!rest.includes(s)) continue;
        const roof = rootRoof(s);
        if (!roof) continue;
        if (s.eqBar) continue;
        const under = rest.filter(o => o !== s && !o.eqBar && o.cx > roof.x && o.cx < s.x2 + 0.2 * H && o.cy > roof.y && o.y < s.y2);
        if (!under.length) continue;
        const taken = new Set([s, ...under]);
        rest = rest.filter(o => !taken.has(o));
        nodes.push({ kind: 'sqrt', root: s, body: readNodes(under, depth + 1), box: boxOf([s, ...under]), strokes: [s, ...under] });
      }
    }

    for (const g of group(rest, H)) {
      const box = boxOf(g);
      let alts = classify(g, H);
      if (ALLOW) {
        /* Read as numbers, a symbol takes its best digit or operator — but
           one that was plainly a letter (a y, far nearer a y than the 0
           it would have to be) keeps the distance between them as doubt,
           so "y² =" in someone's notes never comes out as "0² = 0". */
        const free = alts[0];
        let kept = alts.filter(a => ALLOW(a.ch));
        if (kept.length && !ALLOW(free.ch) && kept[0].d - free.d > 0.15)
          kept = kept.map(a => ({ ch: a.ch, d: a.d + 3 * (a.d - free.d) }));
        kept.cloud = alts.cloud;
        alts = kept.length ? kept : Object.assign([{ ch: '?', d: UNKNOWN }], { cloud: alts.cloud });
      }
      nodes.push({ kind: 'sym', ch: alts[0].ch, d: alts[0].d, alts, strokes: g, box, cloud: alts.cloud });
    }
    nodes.sort((a, b) => a.box.x - b.box.x || a.box.cx - b.box.cx);
    descenders(nodes, H);
    repairBrackets(nodes);
    return { nodes, H };
  }

  /* Only y hangs below the line. A shape the matcher was unsure between
     y and something else (a 1 with a long flag, a 7) is settled by
     whether it does. */
  function descenders(nodes, H) {
    const on = nodes.filter(n => n.kind === 'sym' && (DIGIT.test(n.ch) || 'acnxzπ'.includes(n.ch)));
    if (!on.length || nodes.length < 2) return;
    for (const n of nodes) {
      if (n.kind !== 'sym' || !n.alts || n.alts.length < 2) continue;
      const others = on.filter(m => m !== n);
      if (!others.length) continue;
      const base = median(others.map(m => m.box.y2));
      const low = n.box.y2 > base + 0.18 * H, top = n.alts[0];
      let pick = null;
      if (low && top.ch !== 'y') pick = n.alts.find(a => a.ch === 'y' && a.d < top.d * 1.6 + 0.1);
      else if (!low && top.ch === 'y' && n.box.y2 < base + 0.08 * H) pick = n.alts.find(a => a.ch !== 'y' && a.d < top.d * 1.6 + 0.1);
      if (pick) { n.ch = pick.ch; n.d = pick.d; }
    }
  }

  /* A bracket with no partner on its line was most likely a bowed 1 —
     real 1s lean and curve as much as a written "(" does. Each such
     bracket takes its next reading, when it has one that is not a
     bracket and is not much worse. */
  function repairBrackets(nodes) {
    const open = [], lone = [];
    for (const n of nodes) {
      if (n.kind !== 'sym') continue;
      if (n.ch === '(') open.push(n);
      else if (n.ch === ')') { if (open.length) open.pop(); else lone.push(n); }
    }
    for (const n of lone.concat(open)) {
      const alt = n.alts && n.alts.find(a => a.ch !== '(' && a.ch !== ')' && a.d < n.d + 0.8);
      if (alt) { n.ch = alt.ch; n.d = alt.d; }
    }
  }

  /** a numerator or denominator, plus whatever stacks on it (an exponent, a dot) */
  function grow(seed, pool, bar, dir, H) {
    const got = new Set(seed);
    let more = true;
    while (more) {
      more = false;
      const box = boxOf([...got]);
      for (const s of pool) {
        if (got.has(s) || s === bar || s.eqBar) continue;
        if ((dir < 0 ? s.cy < bar.cy - 0.15 * H : s.cy > bar.cy + 0.15 * H) && s.x < box.x2 + 0.25 * H && s.x2 > box.x - 0.25 * H &&
          s.y < box.y2 + 0.2 * H && s.y2 > box.y - 0.6 * H && (dir < 0 ? s.y2 < bar.cy + 0.25 * H : s.y > bar.cy - 0.25 * H)) {
          got.add(s); more = true;
        }
      }
    }
    return [...got];
  }

  /**
   * Is this stroke a root sign with a roof — down to a vertex low on the
   * left, up to the top, and then along it? Gives the roof's start and
   * height, or null. A short √ with no roof is left to the matcher.
   */
  function rootRoof(s) {
    if (s.w < s.h * 0.9 || s.len < s.h * 2) return null;
    const p = s.xy, n = p.length / 2;
    let lo = 0;
    for (let i = 1; i < n; i++) if (p[i * 2 + 1] > p[lo * 2 + 1]) lo = i;
    if (p[lo * 2] > s.x + 0.4 * s.w) return null;
    let up = -1;
    for (let i = lo; i < n; i++) if (p[i * 2 + 1] < s.y + 0.15 * s.h) { up = i; break; }
    if (up < 0) return null;
    const x = p[up * 2];
    if (s.x2 - x < 0.4 * s.w) return null;
    // the roof runs right, along the top, for a good part of the width
    let far = x;
    for (let i = up; i < n; i++) { if (p[i * 2 + 1] > s.y + 0.3 * s.h) return null; if (p[i * 2] > far) far = p[i * 2]; }
    if (far - x < 0.35 * s.w || p[(n - 1) * 2] < x + 0.3 * s.w) return null;
    return { x, y: s.y + 0.1 * s.h };
  }

  /**
   * Strokes → symbols. Two strokes are one symbol when they overlap along
   * the line by much of the narrower one's width: an "=", a "+", a two-
   * stroke 5. A dot joins nothing but a bar it sits over or under (÷). A
   * merge that reads badly, where its parts read well, is undone — the
   * slanted 1 of "12" leaning into the 2.
   */
  function group(strokes, H) {
    // the "=" the line was found by is one already, whatever its bars look like
    const eq = strokes.filter(s => s.eqBar);
    if (eq.length) {
      const out = group(strokes.filter(s => !s.eqBar), H);
      out.push(eq);
      return out;
    }
    const n = strokes.length, parent = strokes.map((_, i) => i);
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const dots = strokes.map(s => isDot(s, H));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = strokes[i], b = strokes[j];
      if (dots[i] && dots[j]) continue;
      if (dots[i] || dots[j]) {
        const [d, o] = dots[i] ? [a, b] : [b, a];
        if (o.dash && d.cx > o.x && d.cx < o.x2 && Math.abs(d.cy - o.cy) < 0.7 * H && Math.abs(d.cy - o.cy) > 0.08 * H) parent[find(i)] = find(j);
        continue;
      }
      // a stroke too narrow to overlap anything (the stem of a +) is given some width
      const pa = Math.max(a.w, 0.14 * H) / 2, pb = Math.max(b.w, 0.14 * H) / 2;
      const ov = Math.min(a.cx + pa, b.cx + pb) - Math.max(a.cx - pa, b.cx - pb);
      const vgap = Math.max(a.y, b.y) - Math.min(a.y2, b.y2);
      if (vgap > 0.5 * H) continue;
      if (ov / (2 * Math.min(pa, pb)) > 0.45 || touch(a, b, 0.1 * H)) parent[find(i)] = find(j);
    }
    const sets = new Map();
    strokes.forEach((s, i) => { const r = find(i); if (!sets.has(r)) sets.set(r, []); sets.get(r).push(s); });
    const out = [];
    for (const g of sets.values()) {
      if (g.length < 2 || g.length > 4) { out.push(g); continue; }
      out.push(...maybeSplit(g, H));
    }
    return out;
  }

  /** do two strokes come within `tol` of each other? (the halves of a curly x) */
  function touch(a, b, tol) {
    if (a.x > b.x2 + tol || b.x > a.x2 + tol || a.y > b.y2 + tol || b.y > a.y2 + tol) return false;
    const p = a.xy, q = b.xy, t2 = tol * tol;
    const sp = Math.max(2, (p.length >> 5) << 1), sq = Math.max(2, (q.length >> 5) << 1);
    for (let i = 0; i < p.length; i += sp) for (let j = 0; j < q.length; j += sq) {
      const dx = p[i] - q[j], dy = p[i + 1] - q[j + 1];
      if (dx * dx + dy * dy < t2) return true;
    }
    return false;
  }

  const GOOD = 1.0, POOR = 1.3;
  function maybeSplit(g, H) {
    const whole = classify(g, H)[0];
    if (whole.d < GOOD) return [g];
    const sorted = g.slice().sort((a, b) => a.cx - b.cx);
    let best = null;
    for (let k = 1; k < sorted.length; k++) {
      const L = sorted.slice(0, k), R = sorted.slice(k);
      const dl = classify(L, H)[0].d, dr = classify(R, H)[0].d;
      const worst = Math.max(dl, dr);
      if (worst < whole.d * 0.6 && worst < POOR && (!best || worst < best.worst)) best = { worst, parts: [L, R] };
    }
    return best ? best.parts : [g];
  }

  /* ══ structure: exponents, then text ═════════════════════════════════ */
  const OPS = new Set(['+', '−', '×', '·', '/', '÷', '=', '^']);
  const opening = n => n.kind !== 'sym' || DIGIT.test(n.ch) || LETTER.test(n.ch) || n.ch === '(' || n.ch === '√' || n.ch === '.';
  const closing = n => n.kind !== 'sym' || DIGIT.test(n.ch) || LETTER.test(n.ch) || n.ch === ')' || n.ch === '.';

  /** a full-height symbol on this line: the taller of what was read, dashes and dots aside */
  function symbolHeight(nodes, H) {
    const hs = nodes.filter(n => n.kind !== 'sym' || !'−.·=÷'.includes(n.ch)).map(n => n.box.h).sort((a, b) => a - b);
    return hs.length ? Math.max(hs[Math.min(hs.length - 1, Math.floor(hs.length * 0.8))], H * 0.5) : H;
  }

  /** hang each run of raised, smaller symbols on the symbol before it */
  function exponents(nodes, H) {
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const base = nodes[i];
      out.push(base);
      if (!closing(base) || base.ch === '.') continue;
      const run = [];
      let yb = null;
      for (let j = i + 1; j < nodes.length; j++) {
        const m = nodes[j], b = m.box, bb = base.box;
        const raised = b.y2 < bb.y2 - 0.28 * H && b.cy < bb.cy - 0.12 * H && b.h < 0.95 * Math.max(bb.h, H) && b.x > bb.x + 0.3 * bb.w;
        if (!raised) break;
        if (m.kind === 'sym' && OPS.has(m.ch)) {
          // an operator belongs to the exponent only when it sits up there with it
          if (!run.length || !(b.cy < yb - 0.12 * H)) break;
        } else if (yb != null && b.y2 > yb + 0.3 * H) break;
        run.push(m);
        if (yb == null) yb = b.y2;
      }
      // an exponent that ends in an operator is the operator's, not the exponent's
      while (run.length && run[run.length - 1].kind === 'sym' && OPS.has(run[run.length - 1].ch)) run.pop();
      if (run.length) { base.sup = exponents(run, H * 0.65); i += run.length; }
    }
    return out;
  }

  /* pieces of text, each with the symbol it came from (or -1), so that a
     correction typed over the text can be traced back to the ink */
  function emit(nodes, syms, out) {
    let prev = null;
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k], next = nodes[k + 1] || null;
      let ch = n.ch;
      if (n.kind === 'sym') {
        // x between two numbers is a times sign; anywhere else, x
        if (ch === 'x' && !n.sup && prev && next && isNum(prev) && (isNum(next) || next.ch === '(')) ch = '×';
        if (ch === '.' || ch === '·') ch = dotKind(n, nodes, k);
      }
      if (prev && joins(prev, n, ch)) out.push(['·', -1]);
      if (n.kind === 'frac') {
        const wrap = (prev && closing(prev)) || n.sup || (next && opening(next) && next.kind !== 'sym') || (next && next.kind === 'sym' && (DIGIT.test(next.ch) || LETTER.test(next.ch)));
        if (wrap) out.push(['(', -1]);
        part(n.num.nodes, syms, out);
        out.push(['/', syms.push({ ch: '−', strokes: [n.bar], frac: true }) - 1]);
        part(n.den.nodes, syms, out);
        if (wrap) out.push([')', -1]);
      } else if (n.kind === 'sqrt') {
        out.push(['√', syms.push({ ch: '√', strokes: [n.root], roof: true }) - 1], ['(', -1]);
        emit(n.body.nodes, syms, out);
        out.push([')', -1]);
      } else {
        out.push([ch, syms.push({ ch, strokes: n.strokes, cloud: n.cloud, d: n.d, alts: n.alts }) - 1]);
      }
      if (n.sup) {
        out.push(['^', -1]);
        part(n.sup, syms, out);
      }
      prev = Object.assign({}, n, { ch });
    }
    return out;
  }
  /** a sub-expression, bracketed unless it is one number or one letter */
  function part(nodes, syms, out) {
    const one = nodes.length === 1 && nodes[0].kind === 'sym' && !nodes[0].sup && (DIGIT.test(nodes[0].ch) || LETTER.test(nodes[0].ch));
    const digits = nodes.every(n => n.kind === 'sym' && !n.sup && (DIGIT.test(n.ch) || n.ch === '.'));
    if (one || digits) return emit(nodes, syms, out);
    out.push(['(', -1]); emit(nodes, syms, out); out.push([')', -1]);
  }
  const isNum = n => n.kind !== 'sym' || DIGIT.test(n.ch) || n.ch === ')';
  /* Two things side by side with nothing between them multiply. Digits
     run on into a number, and "3x", "2(" and ")(" read as they are, but
     letters must be kept apart ("xy" would be one name) and so must
     anything after an exponent or a fraction. */
  function joins(prev, n, ch) {
    if (!closing(prev) || !(opening(n) || ch === '√')) return false;
    if (n.kind === 'sym' && (ch === '.' || OPS.has(ch))) return false;
    if (prev.ch === '.' || ch === '.') return false;
    if (prev.sup || prev.kind === 'frac' || n.kind === 'frac') return true;
    const pd = prev.kind === 'sym' && DIGIT.test(prev.ch);
    if (pd && n.kind === 'sym' && DIGIT.test(ch)) return false;
    if (pd || prev.ch === ')') return n.kind === 'sym' && DIGIT.test(ch);
    return true;
  }
  /** a dot on the baseline between digits is a decimal point; up in the line, a times */
  function dotKind(n, nodes, k) {
    const near = nodes.filter((m, i) => i !== k && m.kind === 'sym' && (DIGIT.test(m.ch) || LETTER.test(m.ch)) && Math.abs(m.box.cx - n.box.cx) < 3 * Math.max(m.box.w, 1));
    if (!near.length) return '·';
    const base = median(near.map(m => m.box.y2)), top = median(near.map(m => m.box.y));
    return n.box.cy > base - (base - top) * 0.3 ? '.' : '·';
  }

  /* ══ reading ═════════════════════════════════════════════════════════ */
  const ACCEPT = 1.4;           // the worst a symbol may match by for the line to be trusted
  const GUESS = 2.0;
  const MARGIN_FROM = 0.95, MARGIN = 0.1;   // a match this loose needs its runner-up this far behind            // …and for a "?" that offers its best guess instead

  /**
   * Read a line of ink. Strokes are scene items (pts [x,y,p,…]) or
   * already measured. The reading's `ok` is what auto-solve goes by:
   * every symbol matched well and the text is one that can be worked
   * out. `expr` is the line before a trailing "="; a line with an "="
   * in it gives `lhs` and `rhs` as well.
   */
  /* What a symbol may be read as, while a line is read for a sum whose
     letters nothing defines: digits, operators and brackets (and x,
     which between numbers is a times sign). Null: anything. */
  let ALLOW = null;
  const ARITH = /^[0-9+−×·/÷=().√^x]$/;

  function read(items, eqIds, allow) {
    ALLOW = allow || null;
    try { return read1(items, eqIds); } finally { ALLOW = null; }
  }
  function read1(items, eqIds) {
    const eqs = eqIds && eqIds.length === 2 ? new Set(eqIds) : null;
    let strokes = items.map(s => s.xy ? s : feature(s)).filter(s => s.xy.length >= 2);
    if (eqs) strokes = strokes.map(s => eqs.has(s.id) ? Object.assign({}, s, { eqBar: true }) : s.eqBar ? Object.assign({}, s, { eqBar: false }) : s);
    const empty = { ok: false, conf: 0, expr: '', lhs: '', rhs: '', eq: null, syms: [], map: [], H: 1, base: 0, box: null };
    if (!strokes.length) return empty;
    const { nodes, H } = readNodes(strokes);
    const top = exponents(nodes, symbolHeight(nodes, H));
    const syms = [], pieces = emit(top, syms, []);
    let text = '', map = [];
    for (const [s, i] of pieces) { text += s; for (let k = 0; k < s.length; k++) map.push(i); }
    // the "=": at the end it asks for the answer; in the middle it defines
    const eqAt = [];
    for (let i = 0; i < text.length; i++) if (text[i] === '=') eqAt.push(i);
    let eq = null, expr = text, lhs = '', rhs = '';
    if (eqAt.length === 1 && eqAt[0] === text.length - 1) { eq = 'end'; expr = text.slice(0, -1); map = map.slice(0, -1); }
    else if (eqAt.length === 1) { eq = 'mid'; lhs = text.slice(0, eqAt[0]); rhs = text.slice(eqAt[0] + 1); }
    let worst = 0;
    for (const s of syms) if (s.d != null && s.d > worst) worst = s.d;
    /* A loose match with a close second is a coin toss, however good the
       line looks: on a real hand, a 2 read as an 8 by a hair was the
       commonest wrong answer. Such a line is not trusted (it gets a "?"). */
    const close = syms.some(s => s.d != null && s.d > MARGIN_FROM && s.alts && s.alts.some(a => a.ch !== s.ch && !(a.ch === 'x' && s.ch === '×') && a.d - s.d < MARGIN));
    const conf = U.clamp(1 - worst / (ACCEPT * 1.6), 0, 1);
    const body = eq === 'mid' ? rhs : expr;
    const shaped = body.length > 0 && eqAt.length <= 1 && balanced(body) && !/^[+×·/÷^]|[+−×·/÷^]$/.test(body) && !/[+−×·/÷^]{2}/.test(body.replace(/[×·]−/g, '×'));
    const digits = nodes.filter(n => n.kind === 'sym' && DIGIT.test(n.ch));
    // the baseline, if the line has digits on it (a line of fractions has none)
    const base = digits.length ? median(digits.map(n => n.box.y2)) : null;
    // how tall this hand writes a digit, for an answer in the same size: in a
    // fraction, the digits over and under the bar will do
    const inner = nodes.filter(n => n.kind === 'frac').flatMap(n => n.num.nodes.concat(n.den.nodes)).filter(n => n.kind === 'sym' && DIGIT.test(n.ch));
    const size = median((digits.length ? digits : inner).map(n => n.box.h)) || null;
    return { ok: worst <= ACCEPT && shaped && !close, close, shaped, conf, worst, expr, lhs, rhs, eq, syms, map, H, base, size, box: boxOf(strokes), text };
  }
  function balanced(s) {
    let d = 0;
    for (const c of s) { if (c === '(') d++; else if (c === ')' && --d < 0) return false; }
    return d === 0;
  }

  /** the letters a line uses as variables (π is a constant) */
  function namesIn(expr) {
    const out = new Set();
    for (const c of expr) if (/[a-zθ]/.test(c)) out.add(c);
    return [...out];
  }

  /* ══ the board ═══════════════════════════════════════════════════════
     What happens between the pen and an answer. A stroke that might be
     half of an "=" is paired with the stroke before it; a stroke written
     on the line of an "=" already seen puts that line up to be read
     again. Nothing is read until the pen has rested for PAUSE ms — any
     touch of the glass puts it off — and then the waiting lines are read
     in one go, after a look to see that what they were about is still
     there. */
  D.ext.opts.inkmath = { auto: true, places: 'auto', color: 'accent', explain: false };

  const PAUSE = 800;
  const MAX_EQS = 60;          // "=" signs remembered, newest kept
  const LINE_W = 30;           // how far left of its "=" a line may run, in symbol heights

  const S = {
    app: null,
    timer: 0, down: 0, downAt: 0,
    jobs: new Map(),           // key → { kind: 'eq', ids } | { kind: 'deps' } | { kind: 'discover', box }
    eqs: new Map(),            // "=" signs: key → { key, ids, x, x2, cy, L }
    defs: new Map(),           // "x = 5" lines: eq key → { key, name, rhs, src, cy, x }
    known: new Map(),          // answers: id → { id, item, ours, why }
    marks: new Map(),          // "?" beside an "=" not answered: eq key → { el, e, why, reading, guess }
    byEq: new Map(),           // eq key → answer id
    lastFlat: null,
    quiet: false
  };

  function reset(app) {
    clearTimeout(S.timer);
    Object.assign(S, { app, timer: 0, lastFlat: null });
    S.jobs.clear(); S.eqs.clear(); S.defs.clear(); S.known.clear(); S.byEq.clear();
    unmarkAll();
    if (!app || !app.scene) return;
    // the answers already on the board, and the "=" each hangs on (once, on opening a board)
    let uses = null;
    for (const it of app.scene.items) {
      if (it.type !== 'inkresult') continue;
      know(it);
      if (Array.isArray(it.eq) && it.eq.length === 2) {
        const bars = it.eq.map(id => app.scene.get(id));
        if (bars.every(Boolean)) rememberEq(bars.map(feature));
      }
      if (it.uses && it.uses.length) uses = U.unionBox(uses, U.box(it.x - 40 * it.size, it.y - 40 * it.size, it.x + 10 * it.size, it.y));
    }
    // their variables are found when the pen next rests, so a changed "x = 5" is noticed
    if (uses) { S.jobs.set('discover', { kind: 'discover', box: uses }); arm(app); }
  }

  const keyOf = ids => ids.slice().sort().join('|');
  function know(it) {
    S.known.set(it.id, { id: it.id, item: it, ours: false, why: '' });
    if (it.eq) S.byEq.set(keyOf(it.eq), it.id);
    // the oldest answers stop being followed once there are very many
    if (S.known.size > 400) { const first = S.known.keys().next().value; S.known.delete(first); }
  }

  /**
   * Two strokes that make an "=": flat, about as long, one over the
   * other. Measured on a real hand, the second bar is often bowed or
   * hooked where the pen lifts (its ink strays a fifth of its length
   * from the chord) and the bars are not quite parallel, so the bars
   * are judged as dashes, not ruled lines; what keeps a pair honest is
   * that each is clear of the other — their middles further apart than
   * either is tall.
   */
  function pairs(a, b) {
    const wa = a.w, wb = b.w, w = Math.max(wa, wb);
    if (Math.min(wa, wb) < 0.45 * w) return false;
    const ov = Math.min(a.x2, b.x2) - Math.max(a.x, b.x);
    if (ov < 0.5 * Math.min(wa, wb)) return false;
    const gap = Math.abs(a.cy - b.cy);
    return gap > 0.1 * w && gap < 1.1 * w && gap > Math.max(a.h, b.h) * 0.6 && gap > Math.min(a.h, b.h);
  }
  /* A bar of an "=" — a dash — at least a few pixels long as it was
     written: world units mean nothing on a board that zooms, and lecture
     notes are written small. */
  const MIN_BAR_PX = 3;
  const flatish = (f, zoom = 1) => f.dash && f.w * zoom > MIN_BAR_PX;

  /* The arms of an F or an E, or the bars of a ≡ with a stroke through
     them, are two dashes one over the other too. What they have and an
     "=" has not is a stroke joining them: one that reaches from one bar
     to the other, over their width. Only asked of a pair, so rare. */
  function stemmed(app, a, b) {
    const [t, u] = a.cy < b.cy ? [a, b] : [b, a];
    const w = Math.max(a.w, b.w), tol = 0.2 * w;
    for (const it of app.scene.near(U.box(Math.min(a.x, b.x) - tol, t.cy - tol, Math.max(a.x2, b.x2) + tol, u.cy + tol))) {
      if (!isInk(it) || it.id === a.id || it.id === b.id) continue;
      const bx = app.scene.bbox(it), pad = (it.size || 0) / 2;
      const y1 = bx.y + pad, y2 = bx.y + bx.h - pad, cx = bx.x + bx.w / 2;
      if (y1 < t.cy + tol && y2 > u.cy - tol && cx > Math.min(a.x, b.x) - tol && cx < Math.max(a.x2, b.x2) + tol) return true;
    }
    return false;
  }

  function rememberEq(fs) {
    const key = keyOf(fs.map(f => f.id));
    const b = boxOf(fs);
    // a digit is about one and a half times as tall as an "=" is wide
    const e = { key, ids: fs.map(f => f.id), x: b.x, x2: b.x2, cx: b.cx, cy: b.cy, L: Math.max(b.w * 1.6, b.h * 2.6) || 1 };
    S.eqs.delete(key);
    S.eqs.set(key, e);
    if (S.eqs.size > MAX_EQS) S.eqs.delete(S.eqs.keys().next().value);
    return e;
  }

  /** does a box sit on the line of this "="? */
  const onLine = (b, e) => b.y + b.h / 2 > e.cy - 0.9 * e.L && b.y + b.h / 2 < e.cy + 0.9 * e.L &&
    b.x + b.w > e.x - LINE_W * e.L && b.x < e.x2 + 12 * e.L;

  function queue(key, job) { S.jobs.set(key, job); }

  /** wait for the pen to rest, then work */
  function arm(app) {
    clearTimeout(S.timer);
    if (!S.jobs.size) return;
    S.timer = setTimeout(() => run(app), PAUSE);
  }
  function run(app) {
    S.timer = 0;
    if (!S.jobs.size || S.app !== app) return;
    // still writing, or in the middle of something: later
    // (a lift that never arrived — the window lost focus mid-stroke — is given up on)
    if ((S.down && Date.now() - S.downAt < 8000) || (app.scene && app.scene.tx)) { arm(app); return; }
    S.down = 0;
    D.math.ready().then(() => work(app)).catch(err => console.warn('[dpo] inkmath', err));
  }

  /** do whatever is waiting, now (the tests use this rather than the pause) */
  function flush(app) {
    clearTimeout(S.timer); S.timer = 0;
    return D.math.ready().then(() => work(app));
  }

  function work(app) {
    if (S.app !== app || !app.scene) return;
    const jobs = [...S.jobs.values()];
    S.jobs.clear();
    const changed = new Set();
    for (const j of jobs) if (j.kind === 'discover') discover(app, j.box);
    // definitions first, top to bottom, so the answers below them see their values
    const lines = jobs.filter(j => j.kind === 'eq').map(j => ({ j, e: S.eqs.get(keyOf(j.ids)) })).filter(x => x.e);
    lines.sort((a, b) => a.e.cy - b.e.cy);
    for (const { e } of lines) {
      try { readLine(app, e, changed); }
      catch (err) { console.error('[dpo] inkmath', err); }
    }
    if (changed.size || jobs.some(j => j.kind === 'deps')) dependents(app, changed);
  }

  /* ── gathering a line ────────────────────────────────────────────── */
  const isInk = it => it.type === 'stroke' && it.blend !== 'multiply' && it.pts && it.pts.length >= 3;

  /**
   * The strokes of the line an "=" is on: those whose middles are level
   * with it, walked out from it to the left (and to the right, for
   * "x = 5") until a gap of two symbols. Bounded, so a
   * board of dense working is never swallowed whole.
   */
  function gather(app, e) {
    const L = e.L, ids = new Set(e.ids);
    const near = app.scene.near(U.box(e.x - LINE_W * L, e.cy - 2 * L, e.x2 + 14 * L, e.cy + 2 * L));
    const fs = [], wide = [];
    for (const it of near) {
      if (!isInk(it) || ids.has(it.id)) continue;
      const f = feature(it);
      if (f.h > 3.2 * L) continue;
      if (f.cy > e.cy - 0.85 * L && f.cy < e.cy + 0.85 * L) fs.push(f); else wide.push(f);
    }
    // a fraction reaches further up and down than the line: what is over and under its bar belongs
    for (const bar of fs.filter(f => f.dash && f.ang < 14 && f.w > 0.45 * L)) {
      for (const f of wide) {
        if (f.line || Math.abs(f.cy - bar.cy) > 1.8 * L || f.cx < bar.x - 0.1 * bar.w || f.cx > bar.x2 + 0.1 * bar.w) continue;
        f.line = true;
        fs.push(f);
      }
    }
    const walk = (list, dir) => {
      const out = [];
      let edge = dir < 0 ? e.x : e.x2;
      list.sort((a, b) => dir < 0 ? b.x2 - a.x2 : a.x - b.x);
      for (const f of list) {
        const gap = dir < 0 ? edge - f.x2 : f.x - edge;
        if (gap > 2 * L) break;
        out.push(f);
        edge = dir < 0 ? Math.min(edge, f.x) : Math.max(edge, f.x2);
        if (out.length >= 80) break;
      }
      return out;
    };
    return {
      left: walk(fs.filter(f => f.cx < e.cx), -1),
      right: walk(fs.filter(f => f.cx > e.cx && f.x > e.x2 - 0.2 * L), 1)
    };
  }

  /* ── reading a line, and answering it ────────────────────────────── */
  const NAME = /^[a-zθ]$/;

  function readLine(app, e, changed) {
    const scene = app.scene;
    const bars = e.ids.map(id => scene.get(id));
    if (!bars.every(Boolean)) {
      S.eqs.delete(e.key);
      dropDef(e.key, changed);
      unanswer(app, e.key, 'line');
      unmark(e.key);
      return;
    }
    const eqf = bars.map(feature);
    const { left, right } = gather(app, e);
    if (!left.length) { note(e, 'alone', null); dropDef(e.key, changed); unanswer(app, e.key); return; }

    if (right.length) {
      // "x = 5": a definition, if that is how it reads
      unanswer(app, e.key);
      unmark(e.key);
      let r = read([...left, ...eqf, ...right], e.ids);
      /* "x = 12" not read with confidence as a whole is read again as what
         a definition is — a letter, "=", a number — so a loose 1 or a
         rounded x does not leave every line below without its x. */
      if (!(r.ok && r.eq === 'mid' && NAME.test(r.lhs))) {
        const d = read([...left, ...eqf, ...right], e.ids, ch => DIGIT.test(ch) || LETTER.test(ch) || ch === '=' || ch === '.' || ch === '−');
        if (d.eq === 'mid' && NAME.test(d.lhs) && /^−?[0-9]+(\.[0-9]+)?$/.test(d.rhs) && d.worst <= GUESS) r = Object.assign(d, { ok: true });
      }
      e.reading = r; e.why = 'right';
      // "y = x² − 3": not a number to keep, a curve to offer
      if (r.ok && r.eq === 'mid' && r.lhs === 'y' && offerGraph(e, r.rhs, right)) { dropDef(e.key, changed); return; }
      if (r.ok && r.eq === 'mid' && NAME.test(r.lhs) && r.rhs) {
        const was = S.defs.get(e.key);
        const def = { key: e.key, name: r.lhs, rhs: r.rhs, src: [...left, ...eqf, ...right].map(f => f.id), cy: e.cy, x: e.x };
        S.defs.set(e.key, def);
        if (!was || was.name !== def.name || was.rhs !== def.rhs) { changed.add(def.name); if (was) changed.add(was.name); }
      } else dropDef(e.key, changed);
      return;
    }

    dropDef(e.key, changed);
    if (corrected(app, e.key)) { unmark(e.key); e.why = 'answered'; return; }
    const ink = [...left, ...eqf];
    let r = read(ink, e.ids);
    /* A letter nothing defines cannot be answered, so a reading that has
       one — or that is not sure of itself — is tried again as a sum of
       numbers: digits, operators, brackets, and the letters that are
       defined above. A 2 the matcher half took for a z, or a 1 for a t,
       is then a 2 and a 1. Lines of notes, all letters, read no better. */
    const scope = scopeAbove(e.cy);
    const unknown = q => namesIn(q.expr).some(n => !scope.has(n));
    if (r.eq !== 'mid' && (!r.ok || unknown(r))) {
      const n = read(ink, e.ids, ch => ARITH.test(ch) || scope.has(ch));
      if (n.eq === 'end' && n.shaped && (n.ok || !r.shaped || unknown(r) || n.worst < r.worst)) r = n;
    }
    if (r.eq !== 'end' || !worthAnswering(r.expr)) {
      note(e, r.eq !== 'end' ? 'no-end' : 'not-a-sum', r);
      unanswer(app, e.key); return;
    }
    /* "y² =" begins half the lines in a page of notes, and a written y
       is near enough a 0 to the matcher. One digit raised to a power,
       and nothing else, is answered only when that digit is clear. */
    if (/^[0-9]\^/.test(r.expr) && !/[+−×·÷/√]/.test(r.expr) && r.syms[0] && r.syms[0].d > 0.6) {
      note(e, 'unsure', r); unanswer(app, e.key); return;
    }
    const uses = namesIn(r.expr);
    const out = r.shaped ? work1(app, r.expr, uses, e.cy, around(U.box(e.x, e.cy, e.x2, e.cy), e.L)) : null;
    if (!r.ok || !out) {
      unanswer(app, e.key);
      /* Not sure enough to write an answer, but it is a sum that works
         out, of numbers alone: a faint "?" by the "=" says it was seen,
         and a tap puts the best guess in Solve this ink. Lines with
         letters in — notes — never get one. */
      const guess = out && !uses.length && r.worst <= GUESS;
      note(e, !r.shaped ? 'shape' : !out ? 'eval' : 'unsure', r, guess);
      return;
    }
    note(e, 'answered', r);
    answer(app, e, eqf, left, r, out, uses);
  }

  /**
   * A line that is a function of x — "y = x² − 3", or "x² − 3 =" with no
   * x above — gets a chip beside it that puts a graph of it on the board.
   * True if it did. `right`: the ink after the "=", for where the chip goes.
   */
  function offerGraph(e, fn, right) {
    const scope = scopeAbove(e.cy);
    if (scope.has('x') || !D.graph || !D.math.loaded) return false;
    const g = D.graph.graphable('y = ' + fn);          // it was written as y = …
    if (!g) return false;
    e.graph = g;
    e.gx = right && right.length ? Math.max(...right.map(f => f.x2)) : null;
    e.why = 'graph';
    mark(e, 'graph', e.reading, false);
    return true;
  }

  /* A bare number before an "=" ("Step 2 =") is not a sum; anything with
     an operator, a root, a fraction or a variable in it is. */
  const worthAnswering = expr => /[+−×·÷/^√]/.test(expr) || /[a-zθπ]/.test(expr);

  function dropDef(key, changed) {
    const d = S.defs.get(key);
    if (!d) return;
    S.defs.delete(key);
    changed.add(d.name);
  }

  /** the part of the board above a line where its variables would be defined */
  const around = (b, L) => U.box(b.x - 40 * L, b.y - 60 * L, (b.x2 ?? b.x) + 40 * L, b.y2 ?? b.y);

  /** evaluate an expression with the variables defined above `cy`; null if it does not work out */
  function work1(app, expr, uses, cy, area) {
    let scope = scopeAbove(cy);
    if (uses.some(n => !scope.has(n))) {
      // a variable nobody has defined yet, as far as we know: look up the board for it
      discover(app, area);
      scope = scopeAbove(cy);
      if (uses.some(n => !scope.has(n))) return null;
    }
    const res = D.math.evaluate(expr, scope.vars, evalOpts(app));
    if (!res || !res.ok || res.pending || !res.pretty || res.name) return null;
    const v = res.value;
    if (typeof v === 'function' || (v && typeof v === 'object' && !v.isUnit && !v.isComplex && !v.isFraction && !v.isBigNumber && !v.isMatrix)) return null;
    if (typeof v === 'number' && !isFinite(v)) return null;
    return res;
  }

  function evalOpts(app) {
    const p = app.opts.inkmath && app.opts.inkmath.places;
    return p === 'auto' || p == null ? undefined : { format: 'fixed', sig: U.clamp(+p, 0, 10) };
  }

  /** the variables in force at height cy: definitions above it, in order down the page */
  function scopeAbove(cy) {
    const defs = [...S.defs.values()].filter(d => d.cy < cy - 1e-6).sort((a, b) => a.cy - b.cy);
    const vars = D.math.scope();
    const names = new Set();
    for (const d of defs) {
      const r = D.math.evaluate(d.name + ' = ' + d.rhs, vars, {});
      if (r && r.ok) names.add(d.name);
    }
    return { vars, has: n => names.has(n) };
  }

  /**
   * Find the definitions in an area: every "=" in it that has ink to its
   * right is read as a line. Done when an answer needs a variable that is
   * not known yet — after a board is opened, say — never on every stroke.
   */
  function discover(app, box) {
    const flats = [];
    for (const it of app.scene.near(box)) {
      if (!isInk(it)) continue;
      const b = app.scene.bbox(it), pad = (it.size || 2) + 2;
      if (b.h - pad > (b.w - pad) * 0.6) continue;
      const f = feature(it);
      if (flatish(f, (app.camera && app.camera.zoom) || 1)) flats.push(f);
      if (flats.length > 200) break;
    }
    let found = 0;
    for (let i = 0; i < flats.length && found < 40; i++) for (let j = i + 1; j < flats.length; j++) {
      const a = flats[i], b = flats[j];
      if (!pairs(a, b) || stemmed(app, a, b)) continue;
      // an "=" already known has been read, and is read again when its line changes
      const key = keyOf([a.id, b.id]);
      if (S.eqs.has(key) || S.defs.has(key) || S.byEq.has(key)) continue;
      const e = rememberEq([a, b]);
      const { left, right } = gather(app, e);
      if (!left.length || !right.length) continue;
      const r = read([...left, a, b, ...right], e.ids);
      if (r.ok && r.eq === 'mid' && NAME.test(r.lhs) && r.rhs) {
        S.defs.set(key, { key, name: r.lhs, rhs: r.rhs, src: [...left, a, b, ...right].map(f => f.id), cy: e.cy, x: e.x });
        found++;
      }
    }
  }

  /* ── the answer on the board ─────────────────────────────────────── */
  const FONT = '"Segoe Print","Ink Free","Bradley Hand","Segoe Script","Comic Sans MS",cursive';

  /** where each source stroke starts, and how long it is: enough to notice any change */
  function fingerprint(scene, ids) {
    const out = [];
    for (const id of ids) {
      const it = scene.get(id);
      if (!it || !it.pts) return null;
      out.push(U.round(it.pts[0], 2), U.round(it.pts[1], 2), it.pts.length);
    }
    return out;
  }
  const sameFp = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

  function answer(app, e, eqf, left, r, res, uses) {
    const scene = app.scene;
    const src = [...left.map(f => f.id), ...e.ids];
    const H = r.size || e.L;
    const size = U.clamp(H * 1.05, 6, 600);
    const x = e.x2 + 0.35 * e.L;
    // on the digits' baseline when there are digits, else level with the "="
    const base = r.base != null && Math.abs(r.base - (e.cy + 0.5 * H)) < H ? r.base : e.cy + 0.42 * H;
    const fields = {
      x, y: base, size, text: res.pretty, expr: r.expr, src, eq: e.ids.slice(),
      fp: fingerprint(scene, src), uses, at: [U.round(x, 2), U.round(base, 2)]
    };
    const id = S.byEq.get(e.key);
    const rec = id && S.known.get(id);
    const have = id && scene.get(id);
    if (have) {
      // the line was changed: the answer changes with it, where it is
      const keepX = have.x, keepY = have.y;
      if (have.text === fields.text && have.expr === fields.expr && sameFp(have.fp, fields.fp)) return;
      Object.assign(have, fields, { x: keepX, y: keepY, at: [U.round(keepX, 2), U.round(keepY, 2)] });
      quietDirty(app, have);
      return;
    }
    if (rec && !rec.ours) return;            // taken off by hand: not put back on its own
    const it = Object.assign({ id: U.uid(), type: 'inkresult', color: 'accent', alpha: 1 }, fields);
    if (rec) S.known.delete(rec.id);
    quietAdd(app, it);
    know(it);
  }

  /**
   * The answer on this "=" goes. Because its "=" went ('line'), it comes
   * back by itself if the "=" does — an undo, then a redo. Because the
   * line no longer reads ('unread'), only a new reading brings it back.
   */
  function unanswer(app, key, why = 'unread') {
    const id = S.byEq.get(key);
    const it = id && app.scene.get(id);
    if (!it) return;
    // put right by hand (Solve this ink): the person's, kept until its ink goes
    if (it.fixed && why !== 'line') return;
    quietRemove(app, it, why);
  }
  /** is the answer on this "=" one the person corrected? */
  function corrected(app, key) {
    const id = S.byEq.get(key), it = id && app.scene.get(id);
    return !!(it && it.fixed);
  }

  /* ── why it did not answer ───────────────────────────────────────────
     Every "=" read keeps what it was read as and why it was or was not
     answered (e.why, e.reading), for the tests and for this. A sum of
     numbers read with too little confidence gets a faint "?" beside its
     "=": the board saw it, and a tap opens Solve this ink on the best
     guess, so a misreading is one correction away. With "Show why it
     did not answer" on (Settings), every "=" that went unanswered says
     why, the same way. The marks are page furniture, not board items:
     never saved, never in the history, and gone as soon as the line
     reads again. */
  const WHY = {
    alone: 'Nothing written before this "="',
    'no-end': 'Read, but not as a sum that ends in "="',
    'not-a-sum': 'Nothing to work out: no operator',
    shape: 'Read, but not as a sum that makes sense',
    eval: 'Read, but it does not work out — a letter nothing defines?',
    graph: 'A function of x — tap to graph it',
    unsure: 'Not sure of the reading — tap to check it'
  };
  function note(e, why, r, guess = false) {
    e.why = why; e.reading = r || null;
    const o = S.app && S.app.opts && S.app.opts.inkmath;
    if (why !== 'answered' && (guess || (o && o.explain))) mark(e, why, r, guess);
    else unmark(e.key);
  }
  function mark(e, why, r, guess) {
    let m = S.marks.get(e.key);
    if (!m) {
      if (typeof document === 'undefined' || !document.getElementById) return;
      const host = document.getElementById('overlay');
      if (!host) return;
      m = { key: e.key, el: el('button', { class: 'inkmath-ask', type: 'button' }) };
      m.el.addEventListener('pointerdown', ev => { ev.stopPropagation(); ev.preventDefault(); });
      m.el.addEventListener('click', ev => { ev.stopPropagation(); ask(m); });
      host.append(m.el);
      S.marks.set(e.key, m);
      if (S.marks.size === 1) D.ext.on('frame', placeMarks);
    }
    Object.assign(m, { e, why, reading: r || null, guess });
    const said = (WHY[why] || why) + (r && r.text ? ' (read as ' + r.text + (r.worst != null ? ', ' + r.worst.toFixed(2) : '') + ')' : '');
    m.el.title = said;
    m.el.setAttribute('aria-label', said);
    m.el.classList.toggle('why', !guess && why !== 'graph');
    m.el.classList.toggle('graph', why === 'graph');
    if (why === 'graph') m.el.innerHTML = U.GRAPH_ICON + '<span>Graph</span>';
    else m.el.textContent = guess ? '?' : '?  ' + why;
    placeMark(m);
    if (S.app && S.app.requestDrawLive) S.app.requestDrawLive();
  }
  function unmark(key) {
    const m = S.marks.get(key);
    if (!m) return;
    m.el.remove();
    S.marks.delete(key);
    if (!S.marks.size) D.ext.off('frame', placeMarks);
  }
  function unmarkAll() { for (const k of [...S.marks.keys()]) unmark(k); }
  function placeMark(m) {
    const app = S.app, cam = app && app.camera;
    if (!cam || !cam.toScreen) return;
    const e = m.e, p = cam.toScreen((m.why === 'graph' && e.gx != null ? e.gx : e.x2) + 0.3 * e.L, e.cy);
    const px = U.clamp(e.L * cam.zoom * 0.7, 13, 26);
    m.el.style.left = p.x + 'px'; m.el.style.top = p.y + 'px';
    m.el.style.fontSize = px + 'px';
  }
  function placeMarks() { for (const m of S.marks.values()) placeMark(m); }
  /** a "?" tapped: Solve this ink, on what it was read as; a "Graph" chip: the graph */
  function ask(m) {
    const app = S.app;
    if (m.why === 'graph' && app && m.e.graph) {
      const e = m.e, x2 = e.gx != null ? e.gx : e.x2;
      D.graph.beside(app, U.box(e.x, e.cy - e.L, x2, e.cy + e.L), m.e.graph);
      return;
    }
    if (!app || !m.reading) return;
    const items = m.reading.syms.flatMap(s => s.strokes.map(f => app.scene.get(f.id))).filter(Boolean);
    const b = m.el.getBoundingClientRect ? m.el.getBoundingClientRect() : null;
    solve(app, items, { reading: m.reading, sx: b ? b.left : undefined, sy: b ? b.bottom : undefined });
  }

  /* Answers are added, changed and removed outside the undo history: they
     follow from the ink, like a calc block's answers follow from its text
     (see calc.js). The core is still told, so the board is repainted and
     saved. */
  function quietAdd(app, it) {
    S.quiet = true;
    try { app.scene.add(it); } finally { S.quiet = false; }
    done(app);
  }
  function quietRemove(app, it, why) {
    const rec = S.known.get(it.id) || (know(it), S.known.get(it.id));
    S.quiet = true;
    try { app.scene.remove(it); } finally { S.quiet = false; }
    rec.ours = true; rec.why = why; rec.item = clone(it);
    done(app);
  }
  function quietDirty(app, it) {
    it._lines = null; it._b = null;
    app.scene.dirty(it);
    done(app);
  }
  function done(app) {
    if (app.requestDraw) app.requestDraw();
    if (app.markDirty) app.markDirty();
  }
  const clone = it => { const o = {}; for (const k in it) if (k[0] !== '_') o[k] = Array.isArray(it[k]) ? it[k].slice() : it[k]; return o; };

  /* ── following the ink ───────────────────────────────────────────────
     After every edit, each answer looks at its strokes: O(answers), and
     a few array reads each. Strokes gone or reshaped: the line is read
     again when the pen rests (the "=" itself gone: the answer goes at
     once). The whole line moved: the answer moves with it. An answer this
     file took away comes back when its strokes are back as they were —
     which is what makes undo and redo of a stroke carry its answer. */
  function follow(app) {
    if (S.quiet || S.app !== app || (!S.known.size && !S.marks.size)) return;
    const scene = app.scene;
    let more = false;
    for (const rec of S.known.values()) {
      const it = scene.get(rec.id);
      if (!it) {
        if (!rec.ours || rec.why !== 'line') continue;
        const was = rec.item;
        if (sameFp(fingerprint(scene, was.src), was.fp)) {
          const back = clone(was);
          rec.ours = false;
          S.quiet = true;
          try { scene.add(back); } finally { S.quiet = false; }
          rec.item = back;
          if (back.eq) rememberEq(back.eq.map(id => feature(scene.get(id))));
          done(app);
        }
        continue;
      }
      rec.item = it; rec.ours = false;
      const fp = fingerprint(scene, it.src || []);
      if (sameFp(fp, it.fp)) {
        // the answer alone was moved: that is where it lives now
        if (!it.at || it.at[0] !== U.round(it.x, 2) || it.at[1] !== U.round(it.y, 2)) it.at = [U.round(it.x, 2), U.round(it.y, 2)];
        continue;
      }
      // an answer inserted after ink with no "=" goes when that ink does
      const eqGone = it.eq ? it.eq.some(id => !scene.get(id)) : !fp;
      if (eqGone) { quietRemove(app, it, 'line'); continue; }
      const shift = fp && uniformShift(it.fp, fp);
      if (shift) {
        const rx = it.x - (it.at ? it.at[0] : it.x), ry = it.y - (it.at ? it.at[1] : it.y);
        // moved with its line (both selected): nothing to do; the line alone: follow it
        if (Math.abs(rx - shift[0]) > 0.5 || Math.abs(ry - shift[1]) > 0.5) { it.x += shift[0] - rx; it.y += shift[1] - ry; }
        it.fp = fp; it.at = [U.round(it.x, 2), U.round(it.y, 2)];
        quietDirty(app, it);
        continue;
      }
      if (it.fixed || !it.eq) {
        // a corrected answer is not read again: its sum was typed, not written
        if (!fp) quietRemove(app, it, 'line');
        else { it.fp = fp; it.at = [U.round(it.x, 2), U.round(it.y, 2)]; }
        continue;
      }
      queue('eq:' + keyOf(it.eq), { kind: 'eq', ids: it.eq });
      if (!S.eqs.has(keyOf(it.eq))) rememberEq(it.eq.map(id => feature(scene.get(id))));
      more = true;
    }
    // a "?" whose "=" went goes with it
    for (const m of S.marks.values()) if (m.e.ids.some(id => !scene.get(id))) unmark(m.key);
    // a definition whose strokes went is read again too
    for (const d of S.defs.values()) {
      if (d.src.every(id => scene.get(id))) continue;
      const e = S.eqs.get(d.key);
      if (e) { queue('eq:' + d.key, { kind: 'eq', ids: e.ids }); more = true; }
    }
    if (more) arm(app);
  }

  /** the offset every source stroke moved by, if they all moved by one */
  function uniformShift(was, now) {
    if (!was || was.length !== now.length) return null;
    const dx = now[0] - was[0], dy = now[1] - was[1];
    for (let i = 0; i < now.length; i += 3) {
      if (now[i + 2] !== was[i + 2]) return null;
      if (Math.abs(now[i] - was[i] - dx) > 0.05 || Math.abs(now[i + 1] - was[i + 1] - dy) > 0.05) return null;
    }
    return [dx, dy];
  }

  /** a definition changed: the answers that use it are worked out again */
  function dependents(app, names) {
    const scene = app.scene;
    for (const rec of S.known.values()) {
      const it = scene.get(rec.id) || (rec.ours && rec.why === 'eval' ? rec.item : null);
      if (!it || !it.uses || !it.uses.length) continue;
      if (names.size && !it.uses.some(n => names.has(n))) continue;
      const eqs = it.eq && it.eq.map(id => scene.get(id));
      if (!eqs || !eqs.every(Boolean)) continue;
      const cy = boxOf(eqs.map(feature)).cy;
      const res = work1(app, it.expr, it.uses, cy, around(U.box(it.x, cy, it.x, cy), it.size || 20));
      const live = scene.get(rec.id);
      if (!res) { if (live) quietRemove(app, live, 'eval'); continue; }
      if (live) {
        if (live.text !== res.pretty) { live.text = res.pretty; quietDirty(app, live); }
      } else {
        const back = clone(rec.item);
        back.text = res.pretty;
        rec.ours = false;
        S.quiet = true;
        try { scene.add(back); } finally { S.quiet = false; }
        rec.item = back;
        done(app);
      }
    }
  }

  /* ── the pen ─────────────────────────────────────────────────────── */
  /* After every pen stroke, so it must be cheap: a box test against the
     "=" signs seen so far, and — only for a short flat stroke — a pairing
     with the one before it. */
  function onStroke(app, it) {
    const o = app.opts.inkmath;
    if (!o || !o.auto || !it || !it.pts) return;
    if (S.app !== app) reset(app);
    // the scene's box is the ink's grown by half the nib and a pixel more
    // (scene.js): take both off, or a short bar looks half as tall as wide
    const b = app.scene.bbox(it), pad = (it.size || 2) / 2 + 1;
    const w = b.w - 2 * pad, h = b.h - 2 * pad;
    let touched = false;
    for (const e of S.eqs.values()) {
      if (e.ids.includes(it.id) || !onLine(b, e)) continue;
      queue('eq:' + e.key, { kind: 'eq', ids: e.ids });
      touched = true;
    }
    const z = (app.camera && app.camera.zoom) || 1;
    if (w * z > MIN_BAR_PX && h < 0.6 * w) {
      const f = feature(it);
      if (flatish(f, z)) {
        const prev = S.lastFlat;
        S.lastFlat = { f, t: Date.now() };
        if (prev && Date.now() - prev.t < 5000 && app.scene.get(prev.f.id) && pairs(prev.f, f) && !stemmed(app, prev.f, f)) {
          const e = rememberEq([prev.f, f].sort((p, q) => p.cy - q.cy));
          queue('eq:' + e.key, { kind: 'eq', ids: e.ids });
          S.lastFlat = null;
          touched = true;
        }
      } else S.lastFlat = null;
    } else S.lastFlat = null;
    if (touched || S.jobs.size) arm(app);
  }

  /* The pen touching down puts the reading off; lifting lets the pause run. */
  function watchPen() {
    if (typeof addEventListener !== 'function') return;
    const down = () => { S.down++; S.downAt = Date.now(); if (S.timer) { clearTimeout(S.timer); S.timer = 0; } };
    const up = () => { S.down = Math.max(0, S.down - 1); if (S.jobs.size && S.app) arm(S.app); };
    addEventListener('pointerdown', down, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
  }

  /* ══ the answer item ═════════════════════════════════════════════════ */
  const COLOURS = {
    green: ['#12a150', '#3ecf8e'], orange: ['#e8590c', '#fbbf24'],
    red: ['#e5484d', '#ff6b6b'], purple: ['#8e4ec6', '#c084fc'], blue: ['#0ea5e9', '#38bdf8']
  };
  function colourOf(name, r) {
    const tok = r.tokens();
    const c = COLOURS[name];
    return c ? c[tok.dark ? 1 : 0] : name === 'ink' ? U.color('ink') : tok.accent;
  }

  let mctx = null;
  const measurer = () => mctx || (mctx = document.createElement('canvas').getContext('2d'));

  /** the answer's text and size, measured once and kept in _lines */
  function layout(it) {
    const was = it._lines;
    if (was && was.ink) return was;
    const size = it.size || 24;
    const font = `${size}px ${FONT}`;
    const text = (it.lead ? '= ' : '') + String(it.text || '');
    const m = measurer();
    m.font = font;
    const mt = m.measureText(text);
    const asc = isFinite(mt.actualBoundingBoxAscent) ? Math.max(mt.actualBoundingBoxAscent, size * 0.5) : size * 0.8;
    const desc = isFinite(mt.actualBoundingBoxDescent) ? Math.max(mt.actualBoundingBoxDescent, size * 0.12) : size * 0.25;
    return (it._lines = { ink: true, font, text, w: Math.max(mt.width, size * 0.5), asc: asc + size * 0.08, desc: desc + size * 0.06 });
  }

  function drawAnswer(ctx, it, r) {
    const L = layout(it);
    const z = r.paintZoom || (r.app && r.app.camera && r.app.camera.zoom) || 1;
    ctx.fillStyle = colourOf(it.color, r);
    if ((it.size || 24) * z < 4) { ctx.globalAlpha *= 0.6; ctx.fillRect(it.x, it.y - L.asc * 0.6, L.w, L.asc * 0.5); return; }
    ctx.font = L.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(L.text, it.x, it.y);
  }

  function svgAnswer(it, r) {
    const L = layout(it), R = U.round;
    return `<text x="${R(it.x, 1)}" y="${R(it.y, 1)}" font-family="Segoe Print, Ink Free, Bradley Hand, cursive" font-size="${R(it.size || 24, 1)}" fill="${colourOf(it.color, r)}" xml:space="preserve">${U.escapeXml(L.text)}</text>`;
  }

  D.ext.items.inkresult = {
    label: 'Answer',
    erasable: true,
    bbox(it) { const L = layout(it); return { x: it.x, y: it.y - L.asc, w: L.w, h: L.asc + L.desc }; },
    draw: drawAnswer,
    svg: svgAnswer,
    edit(app, it) {
      const strokes = (it.src || []).map(id => app.scene.get(id)).filter(Boolean);
      const b = app.scene.bbox(it), c = app.camera;
      const at = c && c.toScreen ? c.toScreen(b.x, b.y2) : { x: 200, y: 200 };
      if (strokes.length) solve(app, strokes, { sx: at.x, sy: at.y, answer: it });
    },
    scale(it, o, sx, sy) {
      it.x = o.x + (it.x - o.x) * sx; it.y = o.y + (it.y - o.y) * sy;
      it.size = U.clamp((it.size || 24) * Math.sqrt(Math.abs(sx * sy)), 4, 800);
      it._lines = null;
    },
    panel(ui, items) {
      const app = ui.app, one = items.length === 1 ? items[0] : null;
      ui.add(
        ui.group(items.length > 1 ? items.length + ' answers' : 'Answer',
          one ? el('div', { class: 'rowlbl' }, el('span', { class: 'inkmath-expr' }, 'Read as ' + one.expr)) : null,
          el('div', { class: 'inkmath-acts' },
            one ? el('button', { class: 'btn', type: 'button', onclick: () => D.ext.items.inkresult.edit(app, one) }, 'Check the reading') : null,
            one && D.calc ? el('button', { class: 'btn', type: 'button', onclick: () => D.calc.open(one.expr) }, 'Open in calculator') : null)),
        ui.slider('Opacity', items[0].alpha ?? 1, 0.1, 1, 0.05, v => ui.apply(items, it => it.alpha = v), v => Math.round(v * 100) + '%')
      );
    }
  };

  /* ══ Solve this ink ══════════════════════════════════════════════════
     The reading, out in the open: what the strokes were read as, in a
     field to put right with one tap, the answer as you type, and Insert
     (onto the board, after the ink), Open in calculator, and Teach —
     which makes the symbols you corrected templates of your own. */
  let pop = null;

  function closePop() {
    if (!pop) return;
    pop.el.remove();
    if (typeof removeEventListener === 'function') {
      removeEventListener('pointerdown', pop.away, true);
      removeEventListener('keydown', pop.key, true);
    }
    pop = null;
  }

  const shown = r => r.eq === 'mid' ? r.lhs + ' = ' + r.rhs : r.expr;
  /** what can be typed for a symbol, as the recogniser names it */
  const TYPED = { '*': 'x', '×': 'x', '-': '−', 'p': 'π', 'π': 'π' };

  /**
   * Open the popover for these strokes. opts: { sx, sy } where to put it
   * (screen px), answer: an answer item it was opened from.
   */
  function solve(app, items, opts = {}) {
    closePop();
    const strokes = items.filter(isInk).map(feature);
    const reading = opts.reading || read(strokes);
    const original = shown(reading);
    const field = el('input', {
      class: 'inkmath-field', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
      'aria-label': 'The ink, read as'
    });
    field.value = original || '';
    const out = el('div', { class: 'inkmath-out', 'aria-live': 'polite' });
    const ins = el('button', { class: 'btn primary', type: 'button' }, 'Insert result');
    const calc = el('button', { class: 'btn', type: 'button' }, 'Open in calculator');
    const teachB = el('button', { class: 'btn', type: 'button', title: 'Remember the symbols you corrected, for your handwriting' }, 'Teach');
    const note = el('p', { class: 'inkmath-note' },
      reading.ok ? 'Tap the line to put a misreading right, or a symbol below to teach it.' : 'Not sure of this one. Tap a symbol below that is wrong, and pick what it is: it is learnt for next time.');
    const chips = el('div', { class: 'inkmath-chips', 'aria-label': 'The symbols, as read' });
    const pick = el('div', { class: 'inkmath-pick', hidden: true });
    const box = el('div', { class: 'inkmath-pop', role: 'dialog', 'aria-label': 'Solve this ink' },
      el('div', { class: 'inkmath-head' }, el('span', {}, 'Solve this ink'),
        el('button', { class: 'btn inkmath-trainb', type: 'button', title: 'Write each symbol a few times, so your hand is read right', onclick: () => train(app) }, 'Train'),
        el('button', { class: 'icon', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: () => closePop(),
          html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>' })),
      field, out, el('div', { class: 'inkmath-acts' }, ins, calc, teachB), chips, pick, note);
    /* each symbol as it was read, with its own ink: tap one, pick what it
       really is, and that is taught on the spot — no retyping the line,
       and it works however the line was split into symbols */
    const reread = () => {
      Object.assign(reading, read(strokes));
      field.value = shown(reading) || '';
      work();
      drawChips();
    };
    const drawChips = () => {
      chips.replaceChildren();
      pick.hidden = true;
      reading.syms.forEach(sym => {
        if (sym.frac || sym.roof || STRUCTURAL.has(sym.ch) || sym.ch === '·' || !sym.strokes || !sym.strokes.length) return;
        const b = el('button', { class: 'inkmath-chip' + (sym.d != null && sym.d > MARGIN_FROM ? ' unsure' : ''), type: 'button', title: `Read as ${sym.ch}: tap to teach what it really is` },
          el('span', { class: 'inkmath-thumb', html: thumb(sym.strokes, 26) }), el('b', {}, sym.ch));
        b.onclick = () => {
          const on = !b.classList.contains('on');
          for (const c of chips.children) c.classList.toggle('on', on && c === b);
          if (!on) { pick.hidden = true; return; }
          pick.replaceChildren(...TEACHABLE.map(ch => el('button', { class: 'btn', type: 'button', onclick: () => {
            teach(sym.strokes, ch);
            if (app.toast) app.toast(`Learnt: that is ${ch}, in your hand`, 'Undo', () => { undoTeach(); reread(); });
            reread();
          } }, ch)));
          pick.hidden = false;
        };
        chips.appendChild(b);
      });
      chips.hidden = !chips.children.length;
    };
    drawChips();

    let result = null;
    const work = () => {
      const src = field.value.trim();
      const def = /^\s*([a-zθ])\s*=(?!=)\s*(.+)$/.exec(src);
      const expr = (def ? def[2] : src).replace(/=\s*$/, '');
      const uses = namesIn(expr);
      const cy = reading.box ? reading.box.cy : 0;
      result = expr ? work1(app, expr, uses, cy, around(reading.box || U.box(0, 0, 0, 0), reading.H || 20)) : null;
      out.textContent = result ? (def ? def[1] + ' = ' : '= ') + result.pretty : expr ? 'No answer yet' : '';
      out.classList.toggle('none', !result);
      ins.disabled = !result || !!def || !reading.box;
      teachB.disabled = field.value === original || !reading.syms.length;
    };
    field.addEventListener('input', work);
    field.addEventListener('keydown', e => { if (e.key === 'Enter' && !ins.disabled) { e.preventDefault(); ins.click(); } });
    ins.onclick = () => { if (result) insert(app, reading, field.value.trim().replace(/=\s*$/, ''), result, opts.answer); closePop(); };
    calc.onclick = () => { const v = field.value.trim().replace(/=\s*$/, ''); closePop(); if (D.calc) D.calc.open(v); };
    teachB.onclick = () => {
      const n = learn(reading, field.value);
      if (app.toast) {
        if (n) app.toast(`Learnt ${n} symbol${n > 1 ? 's' : ''} of your handwriting`, 'Undo', () => { undoTeach(); teachB.disabled = false; });
        else app.toast('Correct a symbol in place — the same number of symbols — to teach it');
      }
      if (n) { teachB.disabled = true; }
    };

    document.body.appendChild(box);
    const vw = innerWidth, vh = innerHeight, w = 320;
    const x = U.clamp((opts.sx ?? vw / 2) - w / 2, 8, Math.max(8, vw - w - 8));
    const y0 = (opts.sy ?? vh / 3) + 14;
    /* Clear of the selection's action bar (press.js) when it shows below
       the ink — looked for again a moment later, as the bar can follow
       the selection on in. */
    const place = () => {
      let y = y0;
      const bar = document.querySelector('.press-bar.on');
      const r = bar && bar.getBoundingClientRect ? bar.getBoundingClientRect() : null;
      if (r && r.bottom > y - 10 && r.top < y + 260 && r.right > x && r.left < x + w) y = r.bottom + 10;
      box.style.left = x + 'px'; box.style.top = U.clamp(y, 64, Math.max(64, vh - 250)) + 'px';
    };
    place();
    setTimeout(() => { if (pop && pop.el === box) place(); }, 260);
    pop = {
      el: box, field,
      away: e => { if (!box.contains(e.target)) closePop(); },
      key: e => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } }
    };
    setTimeout(() => { if (pop && pop.el === box) { addEventListener('pointerdown', pop.away, true); addEventListener('keydown', pop.key, true); } }, 0);
    out.textContent = '…';
    D.math.ready().then(() => { if (pop && pop.el === box) work(); }).catch(() => { out.textContent = 'The maths engine could not load'; });
    // only for a mouse: on a tablet, focus would put a keyboard up over the ink unasked
    if (opts.focus !== false && app.pointerType === 'mouse') setTimeout(() => { try { field.focus(); field.select(); } catch (_) { } }, 30);
    return { el: box, field, reading, work: () => work(), result: () => result, insert: () => ins.onclick(), teach: () => teachB.onclick() };
  }

  /**
   * The symbols that were corrected in place — the same number of them,
   * each changed for another — become templates of the person's own.
   * Gives how many were learnt.
   */
  function learn(reading, typed) {
    const a = shown(reading), b = typed.trim();
    if (!a || a === b) return 0;
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0;
    while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    const from = a.slice(p, a.length - q), to = b.slice(p, b.length - q);
    if (from.length !== to.length || !from.length) return 0;
    // the shown text has spaces round a defining "="; the map does not
    const mapAt = i => {
      if (reading.eq !== 'mid') return reading.map[i];
      const eq = a.indexOf(' = ');
      return i < eq ? reading.map[i] : i < eq + 3 ? -1 : reading.map[i - 2];
    };
    let n = 0;
    const one = batch();
    for (let i = 0; i < from.length; i++) {
      const sym = reading.syms[mapAt(p + i)];
      const ch = TYPED[to[i]] || to[i];
      if (!sym || sym.frac || sym.roof || !TEACHABLE.includes(ch) || from[i] === to[i]) continue;
      teach(sym.strokes, ch, one);
      n++;
    }
    return n;
  }

  /**
   * Ink that may run to several lines → one reading per line, top to
   * bottom. A new line starts where there is a clear gap below the last
   * (a third of a line's height), so a fraction's top, bar and bottom stay
   * one line. Each: { text, reading }, text as the calculator takes it —
   * "x = 2", "3x² + 2" (an "=" at the end dropped).
   */
  function readLines(items) {
    const strokes = items.map(s => s.xy ? s : feature(s)).filter(s => s.xy.length >= 2);
    if (!strokes.length) return [];
    const H = lineHeight(strokes);
    const byTop = strokes.slice().sort((a, b) => a.y - b.y);
    const lines = [];
    let cur = null, bottom = -Infinity;
    for (const s of byTop) {
      if (!cur || s.y > bottom + H * 0.33) { cur = []; lines.push(cur); bottom = s.y2; }
      cur.push(s); bottom = Math.max(bottom, s.y2);
    }
    return lines.map(ln => {
      const r = read(ln);
      const text = r.eq === 'mid' ? r.lhs + ' = ' + r.rhs : r.expr || r.text || '';
      return { text, reading: r };
    }).filter(l => l.text);
  }

  /* ══ the write pad ═══════════════════════════════════════════════════
     For a pen with no keyboard: write a sum, a function or a few lines on
     a pad and it is read as you go — into a field to put right with one
     tap — then Use puts it where it was wanted: a graph's function, the
     calculator's line, a calc block. Several lines when `multi`. */
  let writer = null;
  function closeWriter() {
    if (!writer) return;
    clearTimeout(writer.timer);
    writer.el.remove();
    if (typeof removeEventListener === 'function') {
      removeEventListener('pointerdown', writer.away, true);
      removeEventListener('keydown', writer.key, true);
    }
    writer = null;
  }
  function writePad(app, opts = {}) {
    closeWriter();
    const st = { ink: [], live: null, timer: 0 };
    const pad = el('canvas', { class: 'inkmath-pad inkmath-wpad' + (opts.multi ? ' tall' : ''), 'aria-label': 'Write here' });
    const field = opts.multi
      ? el('textarea', { class: 'inkmath-field inkmath-wfield', rows: '3', spellcheck: 'false', 'aria-label': 'Read as' })
      : el('input', { class: 'inkmath-field', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Read as' });
    field.value = opts.start || '';
    const useB = el('button', { class: 'btn primary', type: 'button' }, opts.useLabel || 'Use');
    const undoB = el('button', { class: 'btn', type: 'button' }, 'Undo stroke');
    const clearB = el('button', { class: 'btn', type: 'button' }, 'Clear');
    const box = el('div', { class: 'inkmath-pop inkmath-write', role: 'dialog', 'aria-label': opts.title || 'Write' },
      el('div', { class: 'inkmath-head' }, el('span', {}, opts.title || 'Write it'),
        el('button', { class: 'icon', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: () => closeWriter(),
          html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>' })),
      pad, field, el('div', { class: 'inkmath-acts' }, undoB, clearB, useB),
      el('p', { class: 'inkmath-note' }, opts.multi ? 'One line under another. Tap the text to put a misreading right.' : 'Tap the text to put a misreading right.'));
    document.body.appendChild(box);
    // beside what it is for, else in the middle
    const nr = opts.near && opts.near.getBoundingClientRect ? opts.near.getBoundingClientRect() : null;
    const W = Math.min(380, innerWidth - 16);
    let x = innerWidth / 2 - W / 2, y = 80;
    if (nr) {
      x = nr.right + 12 + W < innerWidth - 8 ? nr.right + 12 : nr.left - 12 - W >= 8 ? nr.left - 12 - W : U.clamp(nr.left, 8, innerWidth - W - 8);
      y = U.clamp(nr.top, 64, Math.max(64, innerHeight - (opts.multi ? 470 : 380)));
    }
    box.style.left = U.clamp(x, 8, Math.max(8, innerWidth - W - 8)) + 'px';
    box.style.top = y + 'px';
    box.style.width = W + 'px';

    const ctx = pad.getContext('2d');
    let Wp = 340, Hp = 160;
    const size = () => {
      const r = pad.getBoundingClientRect ? pad.getBoundingClientRect() : null;
      Wp = (r && r.width) || 340; Hp = (r && r.height) || 160;
      const dpr = devicePixelRatio || 1;
      pad.width = Math.round(Wp * dpr); pad.height = Math.round(Hp * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint();
    };
    const paint = () => {
      ctx.clearRect(0, 0, Wp, Hp);
      const css = getComputedStyle(box), ink = css.getPropertyValue('--text').trim() || '#222';
      ctx.strokeStyle = css.getPropertyValue('--stroke').trim() || '#8886'; ctx.lineWidth = 1;
      const rows = opts.multi ? 3 : 1;
      for (let i = 1; i <= rows; i++) { const yy = Hp * i / rows - Hp * 0.18 / rows; ctx.beginPath(); ctx.moveTo(10, yy); ctx.lineTo(Wp - 10, yy); ctx.stroke(); }
      ctx.strokeStyle = ink; ctx.lineWidth = 2.6; ctx.lineCap = ctx.lineJoin = 'round';
      for (const s of st.live ? st.ink.concat([st.live]) : st.ink) {
        ctx.beginPath();
        for (let i = 0; i < s.length; i += 3) i ? ctx.lineTo(s[i], s[i + 1]) : ctx.moveTo(s[i], s[i + 1]);
        if (s.length === 3) ctx.lineTo(s[0] + 0.1, s[1]);
        ctx.stroke();
      }
    };
    const readNow = () => {
      const strokes = st.ink.filter(p => p.length >= 3).map(pts => feature({ id: U.uid(), pts }));
      if (!strokes.length) { field.value = opts.start || ''; return; }
      field.value = opts.multi ? readLines(strokes).map(l => l.text).join('\n') : (readLines(strokes)[0] || { text: '' }).text;
    };
    let pid = null;
    const at = e => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5]; };
    pad.addEventListener('pointerdown', e => {
      if (pid != null) return;
      e.preventDefault(); pid = e.pointerId;
      try { pad.setPointerCapture(pid); } catch (_) { }
      clearTimeout(st.timer);
      st.live = at(e); paint();
    });
    pad.addEventListener('pointermove', e => {
      if (e.pointerId !== pid || !st.live) return;
      const all = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const c of all.length ? all : [e]) st.live.push(...at(c));
      paint();
    });
    const up = e => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (st.live) st.ink.push(st.live);
      st.live = null; paint();
      st.timer = setTimeout(readNow, 450);
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    undoB.onclick = () => { st.ink.pop(); paint(); readNow(); };
    clearB.onclick = () => { st.ink = []; paint(); field.value = opts.start || ''; };
    useB.onclick = () => {
      clearTimeout(st.timer);
      if (st.ink.length && field.value === (opts.start || '')) readNow();
      const text = field.value.trim();
      closeWriter();
      if (text && opts.use) opts.use(text);
    };
    field.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !opts.multi) { e.preventDefault(); useB.onclick(); } });
    U.penField(field, () => { pad.classList.add('nudge'); setTimeout(() => pad.classList.remove('nudge'), 500); });
    writer = {
      el: box, timer: 0,
      away: ev => { if (!box.contains(ev.target)) closeWriter(); },
      key: ev => { if (ev.key === 'Escape') { ev.stopPropagation(); closeWriter(); } },
      /** for tests: lay strokes on the pad as if written there, and read them */
      write(strokes) { st.ink.push(...strokes.map(s => s.pts.slice())); readNow(); },
      field, use: () => useB.onclick()
    };
    Object.defineProperty(writer, 'timer', { get: () => st.timer });
    setTimeout(() => { if (writer && writer.el === box && typeof addEventListener === 'function') { addEventListener('pointerdown', writer.away, true); addEventListener('keydown', writer.key, true); } }, 0);
    requestAnimationFrame(size);
    D.math.ready().catch(() => {});
    return writer;
  }

  /** strokes as a little SVG, fitted to a `px` square */
  function thumb(strokes, px) {
    const b = boxOf(strokes), k = (px - 4) / Math.max(b.w, b.h, 1);
    const ox = (px - b.w * k) / 2, oy = (px - b.h * k) / 2;
    const d = strokes.map(s => {
      let o = '';
      for (let i = 0; i < s.xy.length; i += 2) o += (i ? 'L' : 'M') + U.round(ox + (s.xy[i] - b.x) * k, 1) + ' ' + U.round(oy + (s.xy[i + 1] - b.y) * k, 1);
      return o;
    }).join('');
    return `<svg viewBox="0 0 ${px} ${px}" width="${px}" height="${px}"><path d="${d}"/></svg>`;
  }

  /** a taught sample as a small SVG: its strokes if kept, else its point cloud */
  function sampleSvg(t, px = 30) {
    const k = px - 6;
    if (t.s && t.s.length) {
      const d = t.s.map(s => { let o = ''; for (let i = 0; i < s.length; i += 2) o += (i ? 'L' : 'M') + U.round(3 + s[i] * k, 1) + ' ' + U.round(3 + s[i + 1] * k, 1); return o; }).join('');
      return `<svg viewBox="0 0 ${px} ${px}" width="${px}" height="${px}"><path d="${d}"/></svg>`;
    }
    const p = t.c.p;
    let dots = '';
    for (let i = 0; i < p.length; i += 2) dots += `<circle cx="${U.round(px / 2 + p[i] * k, 1)}" cy="${U.round(px / 2 + p[i + 1] * k, 1)}" r=".9"/>`;
    return `<svg viewBox="0 0 ${px} ${px}" width="${px}" height="${px}">${dots}</svg>`;
  }

  /* ══ Teach your handwriting ══════════════════════════════════════════
     A pad to write each symbol on a few times, as you write it, so the
     reader learns your hand before it has misread anything. It walks
     through every symbol (or the ones you tap), takes a sample once the
     pen has rested, and moves on. "Try it" reads whatever you write and
     says what it saw; tap a symbol in the strip to teach it that instead.
     The samples are the same personal templates Teach makes: on this
     device, at most twelve a symbol, kept until Forget. */
  const TRAIN_EACH = 3, TRAIN_REST = 900;
  let trainer = null;

  function train(app, only) {
    closeTrainer();
    closePop();
    const order = (only && only.length ? only : TEACHABLE).slice();
    const st = { i: 0, k: 0, ink: [], live: null, timer: 0, mode: 'teach' };
    const taughtOf = ch => learned().filter(t => t.ch === ch).length;

    const pad = el('canvas', { class: 'inkmath-pad', 'aria-label': 'Write here' });
    const prompt = el('div', { class: 'inkmath-prompt', 'aria-live': 'polite' });
    const strip = el('div', { class: 'inkmath-strip' });
    const seen = el('div', { class: 'inkmath-seen', 'aria-live': 'polite' });
    const modeSeg = el('div', { class: 'seg inkmath-mode' });
    const undoB = el('button', { class: 'btn', type: 'button', title: 'Take back the last sample taught' }, 'Undo');
    const samples = el('div', { class: 'inkmath-samples' });
    const resetB = el('button', { class: 'inkmath-link', type: 'button' }, 'Forget everything taught…');
    const clearB = el('button', { class: 'btn', type: 'button' }, 'Clear');
    const skipB = el('button', { class: 'btn', type: 'button' }, 'Skip');
    const doneB = el('button', { class: 'btn primary', type: 'button' }, 'Done');
    const sheet = el('div', { class: 'inkmath-train', role: 'dialog', 'aria-label': 'Teach your handwriting' },
      el('div', { class: 'inkmath-head' }, el('span', {}, 'Teach your handwriting'), modeSeg,
        el('button', { class: 'icon', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: () => closeTrainer(),
          html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>' })),
      strip, samples, prompt, pad, seen, el('div', { class: 'inkmath-acts' }, undoB, clearB, skipB, doneB),
      el('p', { class: 'inkmath-note' }, 'Digits and brackets fill the space between the solid lines; small letters reach the dashes. Kept on this device only. ', resetB));
    const scrim = el('div', { class: 'inkmath-scrim', onclick: () => closeTrainer() });
    document.body.append(scrim, sheet);

    const ctx = pad.getContext('2d');
    let W = 300, Hp = 220;
    const size = () => {
      const r = pad.getBoundingClientRect ? pad.getBoundingClientRect() : null;
      W = (r && r.width) || 300; Hp = (r && r.height) || 220;
      const dpr = devicePixelRatio || 1;
      pad.width = Math.round(W * dpr); pad.height = Math.round(Hp * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint();
    };
    // guides: a digit runs TOP to BASE, a small letter MID to BASE
    const TOP = () => Hp * 0.16, BASE = () => Hp * 0.84, MID = () => BASE() - (BASE() - TOP()) * 0.62;
    const paint = () => {
      ctx.clearRect(0, 0, W, Hp);
      const css = getComputedStyle(sheet);
      const rule = css.getPropertyValue('--stroke').trim() || '#8886', ink = css.getPropertyValue('--text').trim() || '#222';
      ctx.lineWidth = 1; ctx.strokeStyle = rule;
      ctx.setLineDash([]);
      for (const y of [TOP(), BASE()]) { ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(W - 12, y); ctx.stroke(); }
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(12, MID()); ctx.lineTo(W - 12, MID()); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = ctx.lineJoin = 'round';
      for (const s of st.live ? st.ink.concat([st.live]) : st.ink) {
        ctx.beginPath();
        for (let i = 0; i < s.length; i += 3) i ? ctx.lineTo(s[i], s[i + 1]) : ctx.moveTo(s[i], s[i + 1]);
        if (s.length === 3) ctx.lineTo(s[0] + 0.1, s[1]);
        ctx.stroke();
      }
    };
    const strokesNow = () => st.ink.filter(p => p.length >= 3).map(pts => feature({ id: U.uid(), pts }));
    const H = () => BASE() - TOP();

    const current = () => order[st.i % order.length];
    const show = () => {
      const ch = current();
      if (st.mode === 'teach') {
        prompt.replaceChildren(el('span', {}, 'Write'), el('b', {}, ch), el('span', {}, `${Math.min(st.k + 1, TRAIN_EACH)} of ${TRAIN_EACH}`));
      } else prompt.replaceChildren(el('span', {}, 'Write any symbol. If it is misread, tap what it really is'));
      strip.replaceChildren(...TEACHABLE.map(c => {
        const n = taughtOf(c);
        return el('button', { class: 'inkmath-sym' + (st.mode === 'teach' && c === ch ? ' on' : '') + (n ? ' done' : ''), type: 'button',
          title: n ? `${n} taught` : 'Not taught yet', onclick: () => pickSym(c) }, c, n ? el('i', {}, String(n)) : null);
      }));
      skipB.hidden = st.mode !== 'teach';
      undoB.disabled = !learned().length;
      drawSamples(st.mode === 'teach' ? ch : st.focus);
    };
    /* what has been taught for one symbol: each sample as it was written,
       with a cross to forget that one, and a button to forget the lot */
    const drawSamples = ch => {
      const list = ch ? samplesOf(ch) : [];
      if (!list.length) { samples.replaceChildren(); samples.hidden = true; return; }
      samples.hidden = false;
      samples.replaceChildren(
        el('span', { class: 'inkmath-samples-l' }, `${list.length} of your ${ch}`),
        ...list.map(t => el('button', { class: 'inkmath-sample', type: 'button', title: 'Forget this one', 'aria-label': `Forget this sample of ${ch}`,
          html: sampleSvg(t) + '<i>×</i>', onclick: () => { forgetSample(t); show(); } })),
        el('button', { class: 'inkmath-link', type: 'button', onclick: () => { forgetSymbol(ch); seen.textContent = `Forgot your ${ch}`; show(); } }, `Forget all ${ch}`));
    };
    const pickSym = c => {
      if (st.mode === 'try') {
        const s = strokesNow();
        if (!s.length) { seen.textContent = 'Write it first, then tap what it is'; return; }
        clearTimeout(st.timer);
        teach(s, c);
        seen.textContent = `Learnt: that is ${c}`;
        st.focus = c;
        st.ink = []; paint(); show();
        return;
      }
      st.i = order.indexOf(c) >= 0 ? order.indexOf(c) : (order.push(c), order.length - 1);
      st.k = 0; st.ink = []; paint(); show();
    };
    /* Undo: the last sample goes, and the count steps back to ask for it again */
    const undo = () => {
      clearTimeout(st.timer);
      const gone = undoTeach();
      if (!gone.length) return;
      const ch = gone[0].ch;
      if (st.mode === 'teach') {
        if (order[st.i] === ch && st.k > 0) st.k--;
        else if (st.k === 0 && st.i > 0 && order[st.i - 1] === ch) { st.i--; st.k = TRAIN_EACH - 1; }
      }
      st.focus = ch;
      seen.textContent = `Took back a ${ch}`;
      st.ink = []; paint(); show();
    };
    undoB.onclick = undo;
    // two taps, so it is never done by a slip of the pen
    resetB.onclick = () => {
      if (resetB.dataset.armed) {
        forget(); delete resetB.dataset.armed; resetB.textContent = 'Forget everything taught…';
        st.i = 0; st.k = 0; seen.textContent = 'Forgot everything you taught'; show();
        return;
      }
      resetB.dataset.armed = '1'; resetB.textContent = 'Tap again to forget everything';
      setTimeout(() => { if (resetB.dataset.armed) { delete resetB.dataset.armed; resetB.textContent = 'Forget everything taught…'; } }, 3500);
    };
    const advance = () => {
      st.k++;
      if (st.k >= TRAIN_EACH) {
        st.k = 0; st.i++;
        if (st.i >= order.length) {
          setMode('try');
          seen.textContent = `All done: ${learned().length} samples of your handwriting. Try it out, or close.`;
          return;
        }
      }
      show();
    };
    const take = () => {
      clearTimeout(st.timer);
      const s = strokesNow();
      if (!s.length) return;
      if (st.mode === 'teach') {
        const ch = current();
        teach(s, ch);
        seen.textContent = `Got it: ${ch}`;
        st.ink = []; paint();
        advance();
      } else {
        const got = classify(s, H()).slice(0, 3);
        seen.replaceChildren(...[el('span', {}, 'Read as '), el('b', {}, got.length ? got[0].ch : '?'),
          got[0] && got[0].mine ? el('span', {}, ', from what you taught') : got[0] && got[0].d > ACCEPT ? el('span', {}, ', not sure') : null,
          got.length > 1 ? el('span', { class: 'alts' }, ' · then ' + got.slice(1).map(g => g.ch).join(', ')) : null].filter(Boolean));
      }
    };
    const setMode = m => {
      st.mode = m;
      modeSeg.replaceChildren(...[['teach', 'Teach'], ['try', 'Try it']].map(([k, label]) =>
        el('button', { class: k === m ? 'on' : '', type: 'button', onclick: () => { setMode(k); seen.textContent = ''; } }, label)));
      st.ink = []; paint(); show();
    };

    // the pad takes any pointer: pen, finger or mouse, one stroke at a time
    let pid = null;
    const at = e => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5]; };
    pad.addEventListener('pointerdown', e => {
      if (pid != null) return;
      e.preventDefault();
      pid = e.pointerId;
      try { pad.setPointerCapture(pid); } catch (_) { }
      clearTimeout(st.timer);
      if (st.mode === 'try' && !st.ink.length) seen.textContent = '';
      st.live = at(e); paint();
    });
    pad.addEventListener('pointermove', e => {
      if (e.pointerId !== pid || !st.live) return;
      const all = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const c of all.length ? all : [e]) st.live.push(...at(c));
      paint();
    });
    const up = e => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (st.live) st.ink.push(st.live);
      st.live = null; paint();
      st.timer = setTimeout(take, TRAIN_REST);
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    clearB.onclick = () => { clearTimeout(st.timer); st.ink = []; paint(); seen.textContent = ''; };
    skipB.onclick = () => { clearTimeout(st.timer); st.ink = []; paint(); st.k = TRAIN_EACH - 1; advance(); };
    doneB.onclick = () => closeTrainer();

    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); closeTrainer(); } };
    if (typeof addEventListener === 'function') { addEventListener('keydown', key, true); addEventListener('resize', size); }
    trainer = {
      el: sheet, scrim, key, size, st, setMode, pickSym, take, undo, reset: () => { resetB.onclick(); resetB.onclick(); },
      /** for tests: lay strokes on the pad as if written there */
      write(strokes) { st.ink.push(...strokes.map(s => s.pts.slice())); }
    };
    setMode('teach');
    requestAnimationFrame(size);
    return trainer;
  }
  function closeTrainer() {
    if (!trainer) return;
    clearTimeout(trainer.st.timer);
    trainer.el.remove(); trainer.scrim.remove();
    if (typeof removeEventListener === 'function') { removeEventListener('keydown', trainer.key, true); removeEventListener('resize', trainer.size); }
    trainer = null;
  }

  /** the answer, put on the board by hand: an ordinary edit, undone like one */
  function insert(app, reading, expr, res, from) {
    const scene = app.scene, box = reading.box, H = reading.size || reading.H || 20;
    const eqSym = reading.eq === 'end' ? [...reading.syms].reverse().find(s => s.ch === '=') : null;
    const eqIds = eqSym ? eqSym.strokes.map(s => s.id) : null;
    const src = reading.syms.flatMap(s => s.strokes.map(f => f.id));
    const x = (eqSym ? boxOf(eqSym.strokes).x2 : box.x2) + 0.35 * H;
    const y = reading.base != null ? reading.base : box.cy + 0.42 * H;
    const fields = {
      x, y, size: U.clamp(H * 1.05, 6, 600), text: res.pretty, expr, src, eq: eqIds, lead: !eqIds,
      fp: fingerprint(scene, src), uses: namesIn(expr), at: [U.round(x, 2), U.round(y, 2)],
      fixed: expr !== reading.expr
    };
    if (from && scene.get(from.id)) {
      scene.begin('answer');
      scene.touch(from);
      Object.assign(from, fields, { x: from.x, y: from.y, at: [U.round(from.x, 2), U.round(from.y, 2)] });
      scene.commit();
      app.afterEdit();
      return from;
    }
    const it = Object.assign({ id: U.uid(), type: 'inkresult', color: 'accent', alpha: 1 }, fields);
    if (eqIds) {
      // an answer already on that "=" makes way
      const old = S.byEq.get(keyOf(eqIds));
      const was = old && scene.get(old);
      if (was) { quietRemove(app, was, 'replaced'); S.known.delete(old); }
    }
    scene.begin('answer'); scene.add(it); scene.commit();
    know(it);
    if (eqIds) { rememberEq(eqSym.strokes); unmark(keyOf(eqIds)); }
    app.afterEdit();
    return it;
  }

  /* ── plugging in ─────────────────────────────────────────────────── */
  const ICON = {
    solve: 'M4 6h7|M7.5 2.5v7|M4 16.5l5 5|M9 16.5l-5 5|M14.5 6h6|M14.5 17h6|M14.5 20h6',
    ink: 'M4 18c3-1 4-9 7-9s2 6 5 6 3-4 4-6|M15 4h5|M15 7h5'
  };
  const strokesOf = ctx => (ctx.selection || []).filter(isInk);

  D.ext.pressActions.push({
    id: 'inkmath-solve', label: 'Solve this ink', icon: ICON.solve, order: 62,
    when: ctx => {
      const sel = ctx.selection || [];
      const ink = strokesOf(ctx);
      return ink.length > 0 && ink.length <= 300 && sel.every(i => isInk(i) || i.type === 'inkresult');
    },
    run: ctx => {
      // under the ink rather than over it, so the line and its reading can be compared
      const app = ctx.app, ink = strokesOf(ctx);
      let b = null;
      for (const it of ink) b = U.unionBox(b, app.scene.bbox(it));
      const at = b && app.camera ? app.camera.toScreen(b.x + b.w / 2, b.y2) : { x: ctx.sx, y: ctx.sy };
      solve(app, ink, { sx: at.x, sy: at.y });
    }
  });

  D.ext.pressActions.push({
    id: 'inkmath-block', label: 'To calc block', icon: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z|M7.5 9h5|M7.5 14.5h4|M15.5 8.2h2|M15.5 13.7h2', order: 63,
    when: ctx => {
      const sel = ctx.selection || [], ink = strokesOf(ctx);
      return !!D.calc && ink.length > 0 && ink.length <= 600 && sel.every(i => isInk(i) || i.type === 'inkresult');
    },
    /* The selected writing, read a line at a time, as a calc block beside
       it: the lines it was read as, worked out, ready to change by keypad,
       by pen, or by hand. */
    run: ctx => {
      const app = ctx.app, ink = strokesOf(ctx);
      const lines = readLines(ink).map(l => l.text.replace(/\s*=\s*$/, '')).filter(Boolean);
      if (!lines.length) { app.toast('Could not read any lines there'); return; }
      let b = null;
      for (const it of ink) b = U.unionBox(b, app.scene.bbox(it));
      D.math.ready().then(() => {
        D.calc.newBlock(app, { x: b.x2 + 40, y: b.y }, lines.join('\n'));
        app.toast(`A calc block of ${lines.length} line${lines.length > 1 ? 's' : ''}: double-tap it to change one`);
      });
    }
  });

  D.ext.settings.push({
    id: 'inkmath', title: 'Handwritten maths', sub: 'Answers for sums written with the pen', icon: ICON.ink,
    render(ui) {
      const app = ui.app, o = app.opts.inkmath;
      const set = (k, v) => { o[k] = v; if (app.savePrefs) app.savePrefs(); };
      const sw = (name, title) => el('span', { class: 'inkmath-sw', title, style: `background:${name === 'accent' ? 'var(--accent)' : COLOURS[name][document.documentElement.dataset.theme === 'dark' ? 1 : 0]}` });
      const n = learned().length;
      return [
        ui.setGroup(
          ui.setToggle('Solve as I write', 'Write a sum with the pen, end it with =, and pause: the answer appears beside it. x = 5 on a line above sets x', !!o.auto, v => set('auto', v)),
          ui.setRow('Decimal places', 'Auto follows the calculator’s number settings', ui.setSeg([['auto', 'Auto'], [0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], o.places, v => { set('places', v); rework(app); })),
          ui.setRow('Answer colour', '', ui.setSeg(['accent', 'green', 'orange', 'red', 'purple'].map(c => [c, sw(c, c)]), o.color, v => { set('color', v); recolour(app, v); })),
          ui.setToggle('Show why it didn’t answer', 'A note beside each = it found but left alone, saying why. For when it misses one', !!o.explain, v => { set('explain', v); explainAll(app); })),
        ui.setGroup(
          ui.setRow('Your handwriting', n ? `${n} sample${n > 1 ? 's' : ''} of ${new Set(learned().map(t => t.ch)).size} symbols, taught on this device` : 'Nothing taught yet. Write each symbol a few times so it reads your hand',
            el('div', { class: 'set-actions' },
              ui.setButton('Train…', () => train(app), true),
              n ? ui.setButton('Undo last', () => { const g = undoTeach(); if (app.toast) app.toast(g.length ? `Took back the last ${g[0].ch} taught` : 'Nothing to take back'); if (ui.showSettings) ui.showSettings('inkmath'); }) : null,
              n ? ui.setButton('Forget all', () => { forget(); if (app.toast) app.toast('Forgot the symbols you taught'); if (ui.showSettings) ui.showSettings('inkmath'); }) : null)),
          n ? ui.setStack(ui.setLabel('Taught, by symbol — tap one to see and change its samples'),
            el('div', { class: 'inkmath-taught' }, ...TEACHABLE.filter(c => samplesOf(c).length).map(c =>
              el('button', { class: 'inkmath-sym done', type: 'button', title: `${samplesOf(c).length} taught: open in the trainer`, onclick: () => { train(app, [c]); } },
                c, el('i', {}, String(samplesOf(c).length)))))) : null),
        ui.setNote('Select handwriting and long-press it — or use the bar over the selection — for Solve this ink. Reading happens on this device; nothing is sent anywhere.')
      ];
    }
  });

  /** "Show why" switched: every "=" seen is read again, to put up or take down its note */
  function explainAll(app) {
    if (S.app !== app) return;
    for (const e of S.eqs.values()) queue('eq:' + e.key, { kind: 'eq', ids: e.ids });
    if (!app.opts.inkmath.explain) for (const m of [...S.marks.values()]) if (!m.guess) unmark(m.key);
    flush(app).catch(() => {});
  }

  /** every answer in the new colour (a setting, not an edit: no undo step) */
  function recolour(app, c) {
    for (const rec of S.known.values()) {
      const it = app.scene.get(rec.id);
      if (it && it.color !== c) { it.color = c; quietDirty(app, it); }
      else if (rec.ours && rec.item) rec.item.color = c;
    }
  }
  /** every answer worked out again, for a change of decimal places */
  function rework(app) {
    D.math.ready().then(() => {
      for (const rec of S.known.values()) {
        const it = app.scene.get(rec.id);
        if (!it || !it.expr) continue;
        const eqs = it.eq ? it.eq.map(id => app.scene.get(id)) : null;
        const cy = eqs && eqs.every(Boolean) ? boxOf(eqs.map(feature)).cy : it.y;
        const res = work1(app, it.expr, it.uses || [], cy, around(U.box(it.x, cy, it.x, cy), it.size || 20));
        if (res && res.pretty !== it.text) { it.text = res.pretty; quietDirty(app, it); }
      }
    });
  }


  D.ext.on('ready', app => { reset(app); watchPen(); });
  D.ext.on('board', app => { closePop(); closeTrainer(); closeWriter(); reset(app); });
  D.ext.on('stroke', onStroke);
  D.ext.on('change', follow);

  D.inkmath = {
    read, classify: (strokes, H) => classify(strokes.map(s => s.xy ? s : feature(s)), H), feature, namesIn,
    readLines, writePad, closeWriter,
    teach, forget, undoTeach, forgetSymbol, forgetSample, samplesOf, learned: () => learned().length, flush, solve, reset, train, closeTrainer, TEACHABLE,
    get state() { return S; },
    GLYPHS, LABELS, _cloud: cloud, _spline: spline, _gather: gather, _eq: rememberEq, _pairs: pairs, _ask: m => ask(m)
  };
})(window.DPO);

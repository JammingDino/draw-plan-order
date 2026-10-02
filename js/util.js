/* ── util.js ── maths, geometry and small helpers ─────────────────────
   Everything hangs off the global `DPO` namespace so the app runs
   straight from file:// with no build step and no module loader.      */
window.DPO = window.DPO || {};

(function (D) {
  'use strict';

  const U = D.util = {};

  /* ── ids & misc ─────────────────────────────────────────────────── */
  let seq = 0;
  U.uid = () => (Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6));

  U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  U.round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

  U.debounce = (fn, ms) => {
    let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  };
  U.throttle = (fn, ms) => {
    let last = 0, t = null, ctxArgs;
    return function (...a) {
      ctxArgs = a; const now = performance.now();
      if (now - last >= ms) { last = now; fn.apply(this, a); }
      else if (!t) t = setTimeout(() => { t = null; last = performance.now(); fn.apply(this, ctxArgs); }, ms - (now - last));
    };
  };

  /* ── bounding boxes ─────────────────────────────────────────────── */
  U.emptyBox = () => ({ x: Infinity, y: Infinity, w: 0, h: 0, x2: -Infinity, y2: -Infinity });

  U.boxFromPoints = (pts, stride = 2, pad = 0) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < pts.length; i += stride) {
      const x = pts[i], y = pts[i + 1];
      if (x < x1) x1 = x; if (y < y1) y1 = y;
      if (x > x2) x2 = x; if (y > y2) y2 = y;
    }
    return U.box(x1 - pad, y1 - pad, x2 + pad, y2 + pad);
  };

  U.box = (x1, y1, x2, y2) => ({
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    x2: Math.max(x1, x2), y2: Math.max(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1)
  });

  U.growBox = (b, p) => U.box(b.x - p, b.y - p, b.x2 + p, b.y2 + p);

  U.unionBox = (a, b) => {
    if (!a) return b; if (!b) return a;
    return U.box(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x2, b.x2), Math.max(a.y2, b.y2));
  };

  U.boxesOverlap = (a, b) => !(a.x2 < b.x || b.x2 < a.x || a.y2 < b.y || b.y2 < a.y);
  U.boxContains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x2 <= outer.x2 && inner.y2 <= outer.y2;
  U.pointInBox = (x, y, b) => x >= b.x && x <= b.x2 && y >= b.y && y <= b.y2;
  U.boxCenter = b => ({ x: (b.x + b.x2) / 2, y: (b.y + b.y2) / 2 });

  /* ── segment maths ──────────────────────────────────────────────── */
  U.distToSegment2 = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return U.dist2(px, py, ax, ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return U.dist2(px, py, ax + t * dx, ay + t * dy);
  };

  U.segmentsIntersect = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };

  /** Does polyline A (flat [x,y,...]) come within `tol` of polyline B? */
  U.polylineNear = (a, b, tol) => {
    const t2 = tol * tol;
    for (let i = 0; i < a.length - 2; i += 2) {
      for (let j = 0; j < b.length - 2; j += 2) {
        if (U.segmentsIntersect(a[i], a[i + 1], a[i + 2], a[i + 3], b[j], b[j + 1], b[j + 2], b[j + 3])) return true;
        if (U.distToSegment2(a[i], a[i + 1], b[j], b[j + 1], b[j + 2], b[j + 3]) < t2) return true;
      }
    }
    // handle degenerate single-point polylines
    if (a.length === 2) for (let j = 0; j < b.length - 2; j += 2)
      if (U.distToSegment2(a[0], a[1], b[j], b[j + 1], b[j + 2], b[j + 3]) < t2) return true;
    return false;
  };

  U.pointNearPolyline = (x, y, pts, tol, stride = 2) => {
    const t2 = tol * tol;
    if (pts.length === stride) return U.dist2(x, y, pts[0], pts[1]) < t2;
    for (let i = 0; i + stride + 1 < pts.length; i += stride)
      if (U.distToSegment2(x, y, pts[i], pts[i + 1], pts[i + stride], pts[i + stride + 1]) < t2) return true;
    return false;
  };

  U.pointInPolygon = (x, y, poly, stride = 2) => {
    let inside = false;
    for (let i = 0, j = poly.length - stride; i < poly.length; j = i, i += stride) {
      const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  /* ── polyline processing ────────────────────────────────────────── */

  /** Ramer–Douglas–Peucker on a flat point array (stride-aware, keeps xy only). */
  U.simplify = (pts, tol, stride = 2) => {
    const n = pts.length / stride;
    if (n < 3) { const o = []; for (let i = 0; i < pts.length; i += stride) o.push(pts[i], pts[i + 1]); return o; }
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]], t2 = tol * tol;
    while (stack.length) {
      const [s, e] = stack.pop();
      let idx = -1, max = t2;
      const ax = pts[s * stride], ay = pts[s * stride + 1], bx = pts[e * stride], by = pts[e * stride + 1];
      for (let i = s + 1; i < e; i++) {
        const d = U.distToSegment2(pts[i * stride], pts[i * stride + 1], ax, ay, bx, by);
        if (d > max) { max = d; idx = i; }
      }
      if (idx > -1) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * stride], pts[i * stride + 1]);
    return out;
  };

  /** Resample a flat polyline to evenly spaced points. */
  U.resample = (pts, count) => {
    const len = U.pathLength(pts);
    if (len === 0 || pts.length < 4) return pts.slice();
    const step = len / (count - 1), out = [pts[0], pts[1]];
    let d = 0;
    for (let i = 0; i < pts.length - 2; i += 2) {
      let ax = pts[i], ay = pts[i + 1];
      const bx = pts[i + 2], by = pts[i + 3];
      let seg = U.dist(ax, ay, bx, by);
      while (d + seg >= step) {
        const t = (step - d) / seg;
        ax = ax + (bx - ax) * t; ay = ay + (by - ay) * t;
        out.push(ax, ay);
        seg = U.dist(ax, ay, bx, by); d = 0;
      }
      d += seg;
    }
    while (out.length < count * 2) out.push(pts[pts.length - 2], pts[pts.length - 1]);
    return out.slice(0, count * 2);
  };

  U.pathLength = pts => {
    let l = 0;
    for (let i = 0; i < pts.length - 2; i += 2) l += U.dist(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    return l;
  };

  /* ── colour ─────────────────────────────────────────────────────── */
  U.withAlpha = (hex, a) => {
    if (a >= 1) return hex;
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
    const n = parseInt(v, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  /* Two colours are semantic rather than literal: "ink" and "paper" follow
     the board's theme, so a note written on a light board is still readable
     when you flip to dark. Everything else is a plain CSS colour. */
  let _theme = null, _sem = {};
  U.color = c => {
    if (c !== 'ink' && c !== 'paper') return c;
    const th = U.theme();
    if (th !== _theme) {
      _theme = th;
      if (th !== document.documentElement.dataset.theme) _sem = U.THEMES[th === 'dark' ? 'dark' : 'light'];
      else {
        const cs = getComputedStyle(document.documentElement);
        _sem = { ink: cs.getPropertyValue('--text').trim() || '#14161c', paper: cs.getPropertyValue('--paper').trim() || '#fff' };
      }
    }
    return _sem[c];
  };

  /* An export can be asked for in the other theme from the one on screen.
     The painter then has to resolve "ink" and "paper" for a theme the page
     is not showing, and it cannot ask CSS: flipping the root attribute to
     read the other set of tokens would set every themed transition in the
     chrome running. So the two semantic colours are mirrored here — they
     must match --text and --paper in css/app.css, which a test checks. */
  U.THEMES = {
    light: { ink: '#14161c', paper: '#fbfbfd' },
    dark: { ink: '#e9ecf2', paper: '#14171d' }
  };

  /* The theme the painter works in: the page's, unless an export has
     taken it over for the length of one synchronous paint (see paintAs). */
  let _forced = null;
  U.theme = () => _forced || document.documentElement.dataset.theme || 'light';

  /** run `fn` with "ink", "paper" and the renderer's tokens resolved for `theme` */
  U.paintAs = (theme, fn) => {
    const was = _forced;
    _forced = theme || null;
    try { return fn(); } finally { _forced = was; }
  };

  /* ── input classification ───────────────────────────────────────── */

  /**
   * Is this event the blunt end of the stylus?
   *
   * Windows and Chrome report the eraser end as a pen carrying the X2
   * button — bit 32 of `buttons`, or `button === 5` on the press itself.
   * Crucially `buttons` reads 32 while the eraser merely *hovers* in
   * range, which is what lets a size preview appear before anything has
   * been rubbed out.
   *
   * `pointerType === 'eraser'` is not in the Pointer Events spec, which
   * lists only mouse, pen and touch — but engines have shipped it, and
   * testing for it costs nothing.
   */
  U.isEraserEnd = e =>
    !!e && (e.pointerType === 'eraser' ||
      (e.pointerType === 'pen' && (((e.buttons || 0) & 32) !== 0 || e.button === 5)));

  U.escapeXml = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

  /* ── DOM sugar ──────────────────────────────────────────────────── */
  U.el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  };
  U.$ = s => document.querySelector(s);

})(window.DPO);

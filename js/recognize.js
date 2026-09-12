/* ── recognize.js ── turn rough ink into clean geometry ──────────────
   Two jobs:
     • recognise()  – line / arrow / rect / ellipse / diamond / triangle
     • scribble()   – "did the user scrub this out?"                    */
(function (D) {
  'use strict';
  const U = D.util;
  const R = D.recognize = {};

  /** strip pressure: [x,y,p,…] → [x,y,…] */
  R.xy = pts => {
    const o = new Array((pts.length / 3) * 2);
    for (let i = 0, j = 0; i < pts.length; i += 3, j += 2) { o[j] = pts[i]; o[j + 1] = pts[i + 1]; }
    return o;
  };

  function shoelace(p) {
    let a = 0;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1];
    return Math.abs(a) / 2;
  }

  function angleAt(p, i) {
    const n = p.length;
    const ax = p[(i - 2 + n) % n], ay = p[(i - 1 + n) % n];
    const bx = p[i], by = p[i + 1];
    const cx = p[(i + 2) % n], cy = p[(i + 3) % n];
    const a1 = Math.atan2(ay - by, ax - bx), a2 = Math.atan2(cy - by, cx - bx);
    let d = Math.abs(a1 - a2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d;
  }

  /**
   * @param  raw  flat [x,y,p,…]
   * @param  opt  {snapAngle:true}
   * @return null | {kind, box|x1..y2, rotate?}
   */
  R.recognise = (raw, opt = {}) => {
    const p = R.xy(raw);
    if (p.length < 6) return null;

    const box = U.boxFromPoints(p);
    const diag = Math.hypot(box.w, box.h);
    const len = U.pathLength(p);
    if (diag < 12 || len < 20) return null;

    const gap = U.dist(p[0], p[1], p[p.length - 2], p[p.length - 1]);
    const closed = gap < Math.max(diag * 0.28, 18) && len > diag * 1.6;

    /* ── open shapes ── */
    if (!closed) {
      const straightness = diag / len;
      if (straightness > 0.9) {
        let x1 = p[0], y1 = p[1], x2 = p[p.length - 2], y2 = p[p.length - 1];
        if (opt.snapAngle !== false) [x2, y2] = snapAngle(x1, y1, x2, y2, 5);
        return { kind: 'line', x1, y1, x2, y2 };
      }
      const arrow = detectArrow(p, len);
      if (arrow) return arrow;
      // gentle "clean up my wobbly line" for near-straight strokes
      if (straightness > 0.8) {
        const x1 = p[0], y1 = p[1];
        let [x2, y2] = snapAngle(x1, y1, p[p.length - 2], p[p.length - 1], 5);
        return { kind: 'line', x1, y1, x2, y2 };
      }
      return null;
    }

    /* ── closed shapes ── */
    const area = shoelace(p);
    const circularity = (4 * Math.PI * area) / (len * len);          // 1 = perfect circle
    const fill = area / (box.w * box.h || 1);                        // 0.785 circle, 1 square, 0.5 diamond

    const tol = Math.max(diag * 0.055, 4);
    let s = U.simplify(p, tol);
    // drop the duplicate closing point
    if (s.length >= 4 && U.dist(s[0], s[1], s[s.length - 2], s[s.length - 1]) < tol * 1.5) s = s.slice(0, -2);
    const corners = s.length / 2;

    if (circularity > 0.74 && fill > 0.62 && fill < 0.92 && corners > 4) return { kind: 'ellipse', box };

    if (corners === 3 && fill > 0.34 && fill < 0.68) return { kind: 'triangle', box };

    if (corners === 4) {
      // diamond: corners sit near the midpoints of the bounding box edges
      const cx = (box.x + box.x2) / 2, cy = (box.y + box.y2) / 2;
      let mids = 0;
      for (let i = 0; i < 8; i += 2) {
        const nearVMid = Math.abs(s[i] - cx) < box.w * 0.22 && (Math.abs(s[i + 1] - box.y) < box.h * 0.22 || Math.abs(s[i + 1] - box.y2) < box.h * 0.22);
        const nearHMid = Math.abs(s[i + 1] - cy) < box.h * 0.22 && (Math.abs(s[i] - box.x) < box.w * 0.22 || Math.abs(s[i] - box.x2) < box.w * 0.22);
        if (nearVMid || nearHMid) mids++;
      }
      if (mids >= 3 && fill < 0.72) return { kind: 'diamond', box };
      if (fill > 0.66) return { kind: 'rect', box };
    }

    if (corners >= 4 && corners <= 6 && fill > 0.72) return { kind: 'rect', box };
    if (circularity > 0.62 && corners > 4) return { kind: 'ellipse', box };
    return null;
  };

  /** snap a segment to 0/45/90° when it is already close. */
  function snapAngle(x1, y1, x2, y2, degTol) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    let a = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const snapped = Math.round(a / step) * step;
    if (Math.abs(a - snapped) < degTol * Math.PI / 180) a = snapped;
    return [x1 + Math.cos(a) * len, y1 + Math.sin(a) * len];
  }
  R.snapAngle = snapAngle;

  /** an arrow is a long shaft with a short barb (or two) doubling back at the end */
  function detectArrow(p, len) {
    const tol = Math.max(len * 0.03, 4);
    const s = U.simplify(p, tol);
    const n = s.length / 2;
    if (n < 3 || n > 6) return null;

    // shaft = from start to the point where the barbs begin
    let shaftEnd = -1;
    for (let i = 1; i < n - 1; i++) {
      const segLen = U.dist(s[i * 2], s[i * 2 + 1], s[(i + 1) * 2], s[(i + 1) * 2 + 1]);
      if (segLen < len * 0.3) { shaftEnd = i; break; }
    }
    if (shaftEnd < 1) return null;

    const x1 = s[0], y1 = s[1], x2 = s[shaftEnd * 2], y2 = s[shaftEnd * 2 + 1];
    const shaft = U.dist(x1, y1, x2, y2);
    if (shaft < len * 0.45) return null;

    // barbs must fold back toward the shaft
    const sa = Math.atan2(y2 - y1, x2 - x1);
    for (let i = shaftEnd; i < n - 1; i++) {
      const ba = Math.atan2(s[(i + 1) * 2 + 1] - s[i * 2 + 1], s[(i + 1) * 2] - s[i * 2]);
      let d = Math.abs(sa - ba); if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < Math.PI * 0.45) return null;                   // still heading forward: not a barb
    }
    const [ex, ey] = snapAngle(x1, y1, x2, y2, 5);
    return { kind: 'arrow', x1, y1, x2: ex, y2: ey };
  }

  /**
   * Scribble ("scratch out") detection.
   * A scribble is a dense zig-zag: it crosses itself a lot and reverses
   * direction repeatedly inside a small area.
   */
  R.scribble = raw => {
    const p = R.xy(raw);
    if (p.length < 16) return { is: false };
    const box = U.boxFromPoints(p);
    const diag = Math.hypot(box.w, box.h);
    const len = U.pathLength(p);
    if (diag < 16 || len < diag * 2.4) return { is: false };

    const s = U.simplify(p, Math.max(diag * 0.03, 2.5));
    const n = s.length / 2;
    if (n < 5) return { is: false };

    // direction reversals
    let reversals = 0;
    for (let i = 1; i < n - 1; i++) {
      const ax = s[i * 2] - s[(i - 1) * 2], ay = s[i * 2 + 1] - s[(i - 1) * 2 + 1];
      const bx = s[(i + 1) * 2] - s[i * 2], by = s[(i + 1) * 2 + 1] - s[i * 2 + 1];
      const dot = ax * bx + ay * by;
      const m = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (m > 0 && dot / m < -0.25) reversals++;
    }

    // self intersections
    let crossings = 0;
    for (let i = 0; i < s.length - 2 && crossings < 12; i += 2)
      for (let j = i + 4; j < s.length - 2; j += 2)
        if (U.segmentsIntersect(s[i], s[i + 1], s[i + 2], s[i + 3], s[j], s[j + 1], s[j + 2], s[j + 3])) crossings++;

    const is = crossings >= 4 || (reversals >= 4 && len > diag * 3.2);
    return { is, crossings, reversals, box, poly: p };
  };

})(window.DPO);

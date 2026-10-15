/* ── freehand.js ── pressure-aware stroke outlines ───────────────────
   Input points are stored flat as [x, y, pressure, x, y, pressure…].
   We build a closed outline polygon so a whole stroke is a single
   fill() — much cheaper (and prettier) than stroking every segment.  */
(function (D) {
  'use strict';
  const U = D.util;
  const F = {};
  D.freehand = F;

  /* Low-pass filter on raw pointer samples. Removes the jitter a
     digitiser produces without adding the lag of a big moving average. */
  F.STREAMLINE = 0.42;

  F.smooth = (pts, amount = F.STREAMLINE) => {
    if (pts.length <= 6) return pts.slice();
    const out = pts.slice(0, 3);
    let px = pts[0], py = pts[1], pp = pts[2];
    for (let i = 3; i < pts.length; i += 3) {
      px += (pts[i] - px) * (1 - amount);
      py += (pts[i + 1] - py) * (1 - amount);
      pp += (pts[i + 2] - pp) * 0.5;
      out.push(px, py, pp);
    }
    return out;
  };

  /**
   * Append one just-arrived raw sample to an already-smoothed array.
   *
   * The filter is causal — each output depends only on the previous output
   * and the new sample — so a stroke in progress never needs re-filtering
   * from the start. Doing that on every pointer sample is O(n²) over a
   * stroke, which is exactly where a long line starts lagging the nib.
   * `sm` must be the smoothed form of `raw` minus its last sample.
   */
  F.smoothStep = (raw, sm, amount = F.STREAMLINE) => {
    const i = raw.length - 3, n = sm.length;
    sm.push(
      sm[n - 3] + (raw[i] - sm[n - 3]) * (1 - amount),
      sm[n - 2] + (raw[i + 1] - sm[n - 2]) * (1 - amount),
      sm[n - 1] + (raw[i + 2] - sm[n - 1]) * 0.5);
    return sm;
  };

  /**
   * How hard the live filter pulls, for the Smoothing setting `s` (0–1)
   * and how fast the pen is going (screen px between samples). A slow
   * pen is where a shaky hand shows, so that is where it smooths most; a
   * quick stroke keeps up with the nib.
   */
  F.liveAmount = (s, speed) => {
    if (!s) return F.STREAMLINE;
    const slow = U.clamp(1 - speed / 10, 0.15, 1);
    return F.STREAMLINE + (0.9 - F.STREAMLINE) * s * slow;
  };

  /**
   * The finished stroke, steadied: each point becomes a gaussian average
   * of the points within `radius` of it along the line (world units).
   * The window shrinks towards the ends, so the stroke starts and stops
   * where the pen did, and it never reaches past a sharp corner, so a 4
   * or a 7 keeps its points while the wobble between them goes.
   * Pressure is left as it was. pts: [x, y, p, …]
   */
  F.relax = (pts, radius) => {
    const n = pts.length / 3;
    if (n < 5 || !(radius > 0)) return pts.slice();
    // distance along the line to each point
    const along = new Float64Array(n);
    for (let i = 1; i < n; i++) along[i] = along[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
    const total = along[n - 1];
    // corners: where the line turns hard over about a radius either side
    const corner = new Uint8Array(n);
    // judged over the whole radius: over less, the wobble's own peaks look like corners
    const span = Math.max(radius * 1.5, 1e-9);
    for (let i = 1, a = 0, b = 0; i < n - 1; i++) {
      while (a < i && along[i] - along[a] > span) a++;
      while (b < n - 1 && along[b] - along[i] < span) b++;
      const ax = pts[i * 3] - pts[a * 3], ay = pts[i * 3 + 1] - pts[a * 3 + 1];
      const bx = pts[b * 3] - pts[i * 3], by = pts[b * 3 + 1] - pts[i * 3 + 1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > span * 0.5 && lb > span * 0.5 && (ax * bx + ay * by) / (la * lb) < 0.35) corner[i] = 1;   // turned more than ~70°
    }
    // cut off at 2.5 sigma: any shorter and the window lets the wobble through
    const out = pts.slice(), sig = radius / 2.5;
    for (let i = 1; i < n - 1; i++) {
      if (corner[i]) continue;
      // no further than the nearer end, so the ends stay put
      const r = Math.min(radius, along[i], total - along[i]);
      if (r <= 0) continue;
      let sx = 0, sy = 0, sw = 0;
      for (let j = i; j >= 0 && along[i] - along[j] <= r; j--) {
        if (j !== i && corner[j]) break;
        const d = (along[i] - along[j]) / sig, w = Math.exp(-0.5 * d * d);
        sx += pts[j * 3] * w; sy += pts[j * 3 + 1] * w; sw += w;
      }
      for (let j = i + 1; j < n && along[j] - along[i] <= r; j++) {
        if (corner[j]) break;
        const d = (along[j] - along[i]) / sig, w = Math.exp(-0.5 * d * d);
        sx += pts[j * 3] * w; sy += pts[j * 3 + 1] * w; sw += w;
      }
      out[i * 3] = sx / sw; out[i * 3 + 1] = sy / sw;
    }
    return out;
  };
  /** the radius the Smoothing setting asks for, in screen px */
  F.RELAX_PX = 24;

  /** Per-point radius from pressure. */
  function radius(size, pressure, thinning) {
    if (!thinning) return size / 2;
    const p = U.clamp(pressure, 0, 1);
    // ease the pressure curve so light touches still leave a visible line
    const e = p * p * (3 - 2 * p);
    return (size / 2) * (1 - thinning + thinning * e);
  }

  /**
   * Drop samples that sit closer together than the nib can resolve.
   *
   * The digitiser reports in screen pixels, so zooming in packs samples ever
   * closer together in world space while the nib stays the same size. Once
   * the spacing is small next to the radius, neighbouring offset points
   * overtake each other, the outline folds back on itself, and the fill
   * turns into a string of beads. A fat nib genuinely cannot record detail
   * finer than itself, so thinning the samples costs nothing.
   */
  function decimate(pts, minDist) {
    const n = pts.length;
    if (n <= 9) return pts;
    const d2 = minDist * minDist;
    const out = [pts[0], pts[1], pts[2]];
    let lx = pts[0], ly = pts[1];
    for (let i = 3; i < n - 3; i += 3) {
      if (U.dist2(lx, ly, pts[i], pts[i + 1]) < d2) continue;
      out.push(pts[i], pts[i + 1], pts[i + 2]);
      lx = pts[i]; ly = pts[i + 1];
    }
    out.push(pts[n - 3], pts[n - 2], pts[n - 1]);      // never lose the nib's last position
    return out;
  }
  F.decimate = decimate;

  /* How fast a stroke's width may change along it (radius per unit of
     length) before a join needs its disc to fill the bulge; see F.shapes.
     At this slope the disc stands proud of the quads' slanted edge by
     about 1% of the radius. */
  const WIDTH_SLOPE = 0.15;

  /** Minimum useful sample spacing for a nib of this size, in world units. */
  F.spacing = size => Math.max(0.3, size * 0.13);

  /**
   * Build the geometry for a stroke: a list of closed polygons that are all
   * wound the same way, so a single non-zero fill unions them.
   *
   * A stroke is the region swept by a moving disc. Tracing one outline around
   * that region only works while the nib is narrow next to the curve it is
   * travelling; on a tight turn the inner side of the outline runs past the
   * centreline, the polygon folds over itself, and non-zero fill cancels the
   * overlap into a hole. Emitting a quad per segment plus a disc at every
   * corner describes the same swept region with no folds at all — and because
   * it is still one path, a translucent highlighter composites in one go
   * instead of darkening everywhere it overlaps itself.
   *
   * @param rawPts flat [x,y,pressure,…]
   * @param {object} o  size, thinning, taper, cap
   * @returns      array of flat [x,y,…] closed polygons
   */
  F.shapes = (rawPts, o) => {
    const size = o.size, thinning = o.thinning ?? 0.5, cap = o.cap !== false;
    const pts = decimate(rawPts, F.spacing(size));
    const n = pts.length / 3;
    if (n === 0) return [];
    if (n === 1) return [disc(pts[0], pts[1], radius(size, pts[2], thinning))];

    // running length lets us taper the very ends of a stroke like a real nib
    const taper = o.taper ?? 0;
    let total = 0;
    const seg = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      total += U.dist(pts[(i - 1) * 3], pts[(i - 1) * 3 + 1], pts[i * 3], pts[i * 3 + 1]);
      seg[i] = total;
    }

    const rad = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let r = radius(size, pts[i * 3 + 2], thinning);
      if (taper > 0) {
        const t1 = U.clamp(seg[i] / taper, 0, 1);
        const t2 = U.clamp((total - seg[i]) / taper, 0, 1);
        r *= Math.min(1, Math.sqrt(t1) * 0.4 + 0.6) * Math.min(1, Math.sqrt(t2) * 0.4 + 0.6);
      }
      rad[i] = Math.max(r, 0.15);
    }
    if (total < 0.6) return [disc(pts[0], pts[1], rad[0])];

    const out = [];
    const nrm = new Float32Array((n - 1) * 2);
    const len = new Float32Array(n - 1);
    let lnx = 0, lny = 1;
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i * 3], ay = pts[i * 3 + 1];
      const bx = pts[(i + 1) * 3], by = pts[(i + 1) * 3 + 1];
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
      let nx, ny;
      if (l < 1e-9) { nx = lnx; ny = lny; } else { nx = lnx = -dy / l; ny = lny = dx / l; }
      nrm[i * 2] = nx; nrm[i * 2 + 1] = ny;
      len[i] = l;
      const ra = rad[i], rb = rad[i + 1];

      /* Grow each quad a hair past its ends so neighbours overlap instead of
         merely touching: two shapes that share an edge each get partial
         anti-aliased coverage there, which shows up as a ribbed seam along
         the stroke. The overlap is a fraction of the nib, so it never
         changes the silhouette. */
      const ux = l < 1e-9 ? 0 : dx / l, uy = l < 1e-9 ? 0 : dy / l;
      const ea = i > 0 ? Math.min(l * 0.45, ra * 0.3) : 0;
      const eb = i < n - 2 ? Math.min(l * 0.45, rb * 0.3) : 0;
      const px = ax - ux * ea, py = ay - uy * ea;
      const qx = bx + ux * eb, qy = by + uy * eb;
      out.push([px + nx * ra, py + ny * ra, qx + nx * rb, qy + ny * rb, qx - nx * rb, qy - ny * rb, px - nx * ra, py - ny * ra]);
    }

    /* Round off the joins — only where the quads would actually leave a
       notch. Two quads meeting at an angle θ leave a wedge open on the
       outside of the turn, and the overlap each grows past the joint (e,
       above) fills it as long as r·sin(θ/2) ≤ e. Handwriting turns a few
       degrees per sample, so nearly every join is filled already, and its
       disc was most of the stroke's geometry — geometry the GPU process
       tessellated on every repaint, for nothing that reached a pixel.
       The cos(θ/2) bound keeps the corner left in its place (a mitre, not
       an arc) within a fraction of a pixel even at full zoom.
       The disc also does a second job: where the width changes quickly
       (a sudden press), the quads' edges are slanted and the disc fills
       the bulge beside them. So it stays wherever either neighbour's
       width changes faster than a gentle slope. */
    for (let i = 1; i < n - 1; i++) {
      const ax = nrm[(i - 1) * 2], ay = nrm[(i - 1) * 2 + 1];
      const bx = nrm[i * 2], by = nrm[i * 2 + 1];
      const dot = ax * bx + ay * by;
      if (dot > 0.9995) continue;
      const r = rad[i];
      const steady = Math.abs(r - rad[i - 1]) <= len[i - 1] * WIDTH_SLOPE && Math.abs(r - rad[i + 1]) <= len[i] * WIDTH_SLOPE;
      const e = Math.min(len[i - 1] * 0.45, len[i] * 0.45, r * 0.3);
      const sinHalf = Math.sqrt(Math.max(0, (1 - dot) / 2)), cosHalf = Math.sqrt((1 + dot) / 2);
      if (steady && cosHalf > 0.99 && r * sinHalf <= e * 0.9) continue;
      out.push(disc(pts[i * 3], pts[i * 3 + 1], r));
    }
    if (cap) {
      out.push(disc(pts[0], pts[1], rad[0]));
      out.push(disc(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], rad[n - 1]));
    }
    return out;
  };

  /** clockwise disc, matching the winding of the segment quads */
  function disc(cx, cy, r) {
    const steps = U.clamp(Math.ceil(r * 1.6), 7, 18);
    const out = [];
    for (let i = 0; i < steps; i++) {
      const a = -(i / steps) * Math.PI * 2;
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return out;
  }

  /** polygons → one Path2D, filled with the default non-zero rule */
  F.path = shapes => {
    const p = new Path2D();
    for (const poly of shapes) {
      if (poly.length < 6) continue;
      p.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) p.lineTo(poly[i], poly[i + 1]);
      p.closePath();
    }
    return p;
  };

  /** polygons → SVG path data (non-zero fill rule is the SVG default too) */
  F.svgPath = shapes => {
    let d = '';
    for (const poly of shapes) {
      if (poly.length < 6) continue;
      d += `M${U.round(poly[0], 1)},${U.round(poly[1], 1)}`;
      for (let i = 2; i < poly.length; i += 2) d += `L${U.round(poly[i], 1)},${U.round(poly[i + 1], 1)}`;
      d += 'Z';
    }
    return d;
  };

})(window.DPO);

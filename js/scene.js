/* ── scene.js ── the document: items, geometry, hit-testing, history ─ */
(function (D) {
  'use strict';
  const U = D.util, FH = D.freehand;

  const FONT_STACK = '"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif';
  const HAND_STACK = '"Segoe Print","Bradley Hand","Comic Sans MS",cursive';

  /* offscreen context used purely for text measurement */
  const mctx = document.createElement('canvas').getContext('2d');


  /* ── spatial index ────────────────────────────────────────────────
     A uniform grid over item bounding boxes, so a redraw or a hit test
     touches the handful of items near the query instead of every item on
     the board.

     It is rebuilt wholesale whenever `scene.version` moves rather than
     being patched on each mutation. That sounds wasteful and is not: the
     rebuild is one pass over already-cached bboxes, and it makes the index
     incapable of disagreeing with the scene — an index that silently drops
     an item makes that item vanish from the screen, which is a far worse
     bug than a linear scan. The cases that matter (panning, zooming,
     hovering, hit-testing) change nothing, so they never pay for a rebuild
     at all; a drag pays one cheap O(n) pass per frame, which is what the
     old code paid anyway.

     Items larger than a few cells go in `big` and are always considered:
     scattering a page-sized PDF across four hundred cells costs more than
     testing it directly. */
  const CELL = 512;                  // world units
  const BIG_SPAN = 16;               // cells across before an item counts as big

  class Grid {
    constructor() { this.version = -1; this.cells = new Map(); this.big = []; }

    sync(scene) {
      if (this.version === scene.version) return this;
      this.version = scene.version;
      this.cells.clear();
      this.big.length = 0;
      const items = scene.items;
      for (let z = 0; z < items.length; z++) {
        const it = items[z];
        it._z = z;
        const b = scene.bbox(it);
        if (!isFinite(b.x) || !isFinite(b.y2)) { this.big.push(it); continue; }
        const cx0 = Math.floor(b.x / CELL), cy0 = Math.floor(b.y / CELL);
        const cx1 = Math.floor(b.x2 / CELL), cy1 = Math.floor(b.y2 / CELL);
        if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > BIG_SPAN * BIG_SPAN) { this.big.push(it); continue; }
        for (let cy = cy0; cy <= cy1; cy++)
          for (let cx = cx0; cx <= cx1; cx++) {
            const k = cx + ',' + cy;
            const bucket = this.cells.get(k);
            if (bucket) bucket.push(it); else this.cells.set(k, [it]);
          }
      }
      return this;
    }

    /** items whose bbox may overlap `box`, back → front */
    query(scene, box) {
      this.sync(scene);
      const seen = new Set(this.big);
      const cx0 = Math.floor(box.x / CELL), cy0 = Math.floor(box.y / CELL);
      const cx1 = Math.floor(box.x2 / CELL), cy1 = Math.floor(box.y2 / CELL);
      /* A query wider than the whole index is no cheaper to walk cell by
         cell than to take everything — and much slower if the view is
         zoomed far out over a sparse board. */
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > this.cells.size * 4 + 64) {
        return scene.items.filter(it => U.boxesOverlap(box, scene.bbox(it)));
      }
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const bucket = this.cells.get(cx + ',' + cy);
          if (bucket) for (const it of bucket) seen.add(it);
        }
      const out = [];
      for (const it of seen) if (U.boxesOverlap(box, scene.bbox(it))) out.push(it);
      out.sort((a, b) => a._z - b._z);
      return out;
    }
  }

  class Scene {
    constructor(doc) {
      this.items = [];                 // back → front
      this.byId = new Map();
      this.undoStack = [];
      this.redoStack = [];
      this.tx = null;
      this.version = 0;
      this.onchange = null;
      this._grid = new Grid();
      if (doc) this.load(doc);
    }

    /* ── basic access ─────────────────────────────────────────────── */
    get(id) { return this.byId.get(id); }
    indexOf(item) { return this.items.indexOf(item); }

    dirty(item) {
      if (item) { item._b = null; item._path = null; item._lod = null; item._lines = null; }
      this.version++;
      if (this.onchange) this.onchange();
    }

    /* ── transactions ─────────────────────────────────────────────── */
    begin(label) {
      if (this.tx) return this.tx;
      this.tx = { label, adds: [], removes: [], before: new Map() };
      return this.tx;
    }

    /** snapshot an item before it is mutated */
    touch(item) {
      if (this.tx && !this.tx.before.has(item.id)) this.tx.before.set(item.id, clone(item));
      item._b = null; item._path = null; item._lod = null; item._lines = null;
      return item;
    }

    commit() {
      const t = this.tx; this.tx = null;
      if (!t) return;
      const updates = [];
      for (const [id, before] of t.before) {
        const now = this.byId.get(id);
        /* A click that selects but does not move still runs through touch().
           Recording that as an undo step means the first Ctrl+Z after it
           appears to do nothing, so drop the ones that changed nothing. */
        if (now && !sameItem(before, now)) updates.push({ id, before, after: clone(now) });
      }
      if (!t.adds.length && !t.removes.length && !updates.length) return;
      this.undoStack.push({ label: t.label, adds: t.adds.map(clone), removes: t.removes.map(r => ({ item: clone(r.item), index: r.index })), updates });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack.length = 0;
      this.version++;
      if (this.onchange) this.onchange();
    }

    cancel() { this.tx = null; }

    undo() {
      const op = this.undoStack.pop(); if (!op) return null;
      for (const it of op.adds) this._remove(it.id);
      for (const r of [...op.removes].reverse()) this._insert(clone(r.item), r.index);
      for (const u of op.updates) this._replace(u.id, clone(u.before));
      this.redoStack.push(op);
      this.version++; if (this.onchange) this.onchange();
      return op;
    }

    redo() {
      const op = this.redoStack.pop(); if (!op) return null;
      for (const u of op.updates) this._replace(u.id, clone(u.after));
      for (const r of op.removes) this._remove(r.item.id);
      for (const it of op.adds) this._insert(clone(it), this.items.length);
      this.undoStack.push(op);
      this.version++; if (this.onchange) this.onchange();
      return op;
    }

    /* ── mutation ─────────────────────────────────────────────────── */
    add(item, index) {
      this._insert(item, index ?? this.items.length);
      if (this.tx) this.tx.adds.push(item);
      this.version++; if (this.onchange) this.onchange();
      return item;
    }

    remove(item) {
      const index = this.items.indexOf(item);
      if (index < 0) return;
      if (this.tx) this.tx.removes.push({ item, index });
      this._remove(item.id);
      // detach edges that pointed at it
      for (const e of this.items.filter(i => i.type === 'edge' && (i.from.id === item.id || i.to.id === item.id))) {
        if (this.tx) this.tx.removes.push({ item: e, index: this.items.indexOf(e) });
        this._remove(e.id);
      }
      this.version++; if (this.onchange) this.onchange();
    }

    _insert(item, index) {
      item._b = null; item._path = null; item._lod = null; item._lines = null;
      this.items.splice(Math.min(index, this.items.length), 0, item);
      this.byId.set(item.id, item);
    }
    _remove(id) {
      const it = this.byId.get(id); if (!it) return;
      this.items.splice(this.items.indexOf(it), 1);
      this.byId.delete(id);
    }
    _replace(id, item) {
      const old = this.byId.get(id);
      if (old) { this.items[this.items.indexOf(old)] = item; this.byId.set(id, item); }
      else this._insert(item, this.items.length);
    }

    reorder(items, mode) {
      const set = new Set(items);
      const rest = this.items.filter(i => !set.has(i));
      const sel = this.items.filter(i => set.has(i));
      if (mode === 'front') this.items = [...rest, ...sel];
      else if (mode === 'back') this.items = [...sel, ...rest];
      else if (mode === 'up') {
        for (let i = this.items.length - 2; i >= 0; i--)
          if (set.has(this.items[i]) && !set.has(this.items[i + 1])) swap(this.items, i, i + 1);
      } else {
        for (let i = 1; i < this.items.length; i++)
          if (set.has(this.items[i]) && !set.has(this.items[i - 1])) swap(this.items, i, i - 1);
      }
      this.version++; if (this.onchange) this.onchange();
    }

    /* ── geometry ─────────────────────────────────────────────────── */
    bbox(item) {
      if (item._b && (item.type !== 'edge' || this._edgeBoxFresh(item))) return item._b;
      let b;
      switch (item.type) {
        case 'stroke':
          b = U.boxFromPoints(item.pts, 3, item.size / 2 + 1); break;
        case 'shape': {
          const pad = (item.kind === 'line' || item.kind === 'arrow') ? item.size + 6 : item.size / 2;
          b = U.box(item.x, item.y, item.x + item.w, item.y + item.h);
          b = U.growBox(b, pad); break;
        }
        case 'text': {
          const L = this.layout(item);
          b = U.box(item.x, item.y, item.x + Math.max(item.w, L.width), item.y + L.height); break;
        }
        case 'edge': {
          const pts = this.edgePath(item);
          b = U.boxFromPoints(pts, 2, item.size + 8);
          item._ends = this._edgeEnds(item);
          break;
        }
        default:
          b = U.box(item.x, item.y, item.x + item.w, item.y + item.h);
      }
      item._b = b;
      return b;
    }

    /* A connector's box depends on the boxes of the things it is attached
       to, and moving one of those clears only that item's cache — the
       edge never hears about it. A connector whose node had moved kept
       its old box, so the spatial index filed it where the line used to
       be: it vanished once that spot scrolled off, and could not be
       clicked where it was actually drawn. So the edge remembers which
       endpoint boxes it was measured against. A moved, resized, undone or
       re-typed item always gets a new box object, which makes identity a
       complete and nearly free check. */
    _edgeEnds(edge) {
      const f = edge.from.id && this.byId.get(edge.from.id);
      const t = edge.to.id && this.byId.get(edge.to.id);
      return [f ? this.bbox(f) : null, t ? this.bbox(t) : null];
    }
    _edgeBoxFresh(edge) {
      const was = edge._ends, now = this._edgeEnds(edge);
      return !!was && was[0] === now[0] && was[1] === now[1];
    }

    /** text layout with word wrap; cached on the item */
    layout(item) {
      if (item._lines) return item._lines;
      const size = item.size || 18;
      const font = `${item.italic ? 'italic ' : ''}${item.bold ? '600 ' : ''}${size}px ${item.font === 'hand' ? HAND_STACK : FONT_STACK}`;
      mctx.font = font;
      const maxW = item.w || 240;
      const lines = [];
      let width = 0;
      for (const para of String(item.text ?? '').split('\n')) {
        if (!para) { lines.push(''); continue; }
        if (item.autoWidth) { lines.push(para); width = Math.max(width, mctx.measureText(para).width); continue; }
        let line = '';
        for (const word of para.split(' ')) {
          const test = line ? line + ' ' + word : word;
          if (mctx.measureText(test).width > maxW && line) { lines.push(line); width = Math.max(width, mctx.measureText(line).width); line = word; }
          else line = test;
        }
        lines.push(line); width = Math.max(width, mctx.measureText(line).width);
      }
      const lh = size * 1.35;
      /* Where the baseline sits in a line of height lh, worked out the way
         CSS does it — the font's ascent+descent box centred in the line —
         rather than by canvas's 'top', which hangs the em square from the
         top. Text is edited in a textarea laid out by CSS and painted on
         the canvas afterwards, so the two models used to disagree by a few
         pixels: the text jumped when you finished typing, and doubled up
         while you typed. Every painter, the SVG export and the editor now
         put line i's baseline at lineTop + i * lh + base. */
      const m = mctx.measureText('Hg');
      const A = m.fontBoundingBoxAscent, De = m.fontBoundingBoxDescent;
      const base = isFinite(A) && isFinite(De) ? (lh - (A + De)) / 2 + A : (lh - size) / 2 + size * 0.8;
      item._lines = { lines, font, lh, base, width: Math.ceil(width) + 2, height: Math.max(lh, lines.length * lh) };
      return item._lines;
    }

    /* ── node/edge routing ────────────────────────────────────────── */
    anchorPoint(item, tx, ty) {
      const b = this.bbox(item);
      const cx = (b.x + b.x2) / 2, cy = (b.y + b.y2) / 2;
      const dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return { x: cx, y: cy };
      const hw = b.w / 2 || 1, hh = b.h / 2 || 1;
      // ray/box intersection, pulled in slightly for diamonds
      const sx = Math.abs(dx) / hw, sy = Math.abs(dy) / hh;
      const s = Math.max(sx, sy);
      let px = cx + dx / s, py = cy + dy / s;
      if (item.type === 'node' && item.kind === 'decision') {
        const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
        px = cx + dx * t; py = cy + dy * t;
      }
      return { x: px, y: py };
    }

    endpoint(end, other) {
      if (end.id) {
        const it = this.byId.get(end.id);
        if (it) return this.anchorPoint(it, other.x, other.y);
      }
      return { x: end.x || 0, y: end.y || 0 };
    }

    /** flat [x,y,…] polyline for an edge */
    edgePath(edge) {
      const fromIt = edge.from.id && this.byId.get(edge.from.id);
      const toIt = edge.to.id && this.byId.get(edge.to.id);
      const fc = fromIt ? U.boxCenter(this.bbox(fromIt)) : { x: edge.from.x, y: edge.from.y };
      const tc = toIt ? U.boxCenter(this.bbox(toIt)) : { x: edge.to.x, y: edge.to.y };
      const a = this.endpoint(edge.from, tc);
      const b = this.endpoint(edge.to, fc);

      if (edge.style === 'elbow') {
        const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
        if (dy > dx) { const my = (a.y + b.y) / 2; return [a.x, a.y, a.x, my, b.x, my, b.x, b.y]; }
        const mx = (a.x + b.x) / 2; return [a.x, a.y, mx, a.y, mx, b.y, b.x, b.y];
      }
      if (edge.style === 'curve') {
        const out = []; const dx = (b.x - a.x) * 0.5;
        for (let i = 0; i <= 16; i++) {
          const t = i / 16, mt = 1 - t;
          const c1x = a.x + dx, c1y = a.y, c2x = b.x - dx, c2y = b.y;
          out.push(
            mt * mt * mt * a.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * b.x,
            mt * mt * mt * a.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * b.y);
        }
        return out;
      }
      return [a.x, a.y, b.x, b.y];
    }

    /* ── hit testing ──────────────────────────────────────────────── */
    outlinePoints(item) {
      switch (item.type) {
        case 'stroke': return D.recognize.xy(item.pts);
        case 'edge': return this.edgePath(item);
        case 'shape': {
          const { x, y, w, h, kind } = item;
          if (kind === 'line' || kind === 'arrow') return [x, y, x + w, y + h];
          if (kind === 'ellipse') {
            const o = [], cx = x + w / 2, cy = y + h / 2;
            for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; o.push(cx + Math.cos(a) * w / 2, cy + Math.sin(a) * h / 2); }
            return o;
          }
          if (kind === 'diamond') return [x + w / 2, y, x + w, y + h / 2, x + w / 2, y + h, x, y + h / 2, x + w / 2, y];
          if (kind === 'triangle') return [x + w / 2, y, x + w, y + h, x, y + h, x + w / 2, y];
          return [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
        }
        default: {
          const b = this.bbox(item);
          return [b.x, b.y, b.x2, b.y, b.x2, b.y2, b.x, b.y2, b.x, b.y];
        }
      }
    }

    hitItem(item, x, y, tol) {
      const b = this.bbox(item);
      if (!U.pointInBox(x, y, U.growBox(b, tol))) return false;
      if (item.type === 'text' || item.type === 'note' || item.type === 'node' || item.type === 'image' || item.type === 'pdfpage') return true;
      if (item.type === 'shape' && item.fill && item.fill !== 'none' && item.kind !== 'line' && item.kind !== 'arrow')
        return U.pointInPolygon(x, y, this.outlinePoints(item));
      const w = (item.size || 2) / 2 + tol;
      return U.pointNearPolyline(x, y, this.outlinePoints(item), w);
    }

    /** candidate items overlapping `box`, back → front */
    near(box) { return this._grid.query(this, box); }

    hitTest(x, y, tol = 6) {
      const cand = this.near(U.box(x - tol, y - tol, x + tol, y + tol));
      for (let i = cand.length - 1; i >= 0; i--) if (this.hitItem(cand[i], x, y, tol)) return cand[i];
      return null;
    }

    /** topmost node/note/shape that can host a connector */
    hitNode(x, y) {
      const cand = this.near(U.box(x, y, x, y));
      for (let i = cand.length - 1; i >= 0; i--) {
        const it = cand[i];
        if (it.type === 'node' || it.type === 'note' || it.type === 'text' ||
          (it.type === 'shape' && it.kind !== 'line' && it.kind !== 'arrow')) {
          if (U.pointInBox(x, y, this.bbox(it))) return it;
        }
      }
      return null;
    }

    itemsInBox(box, contain) {
      const cand = this.near(box);
      return contain ? cand.filter(it => U.boxContains(box, this.bbox(it))) : cand;
    }

    itemsInLasso(poly) {
      return this.near(U.boxFromPoints(poly, 2, 1)).filter(it => {
        const b = this.bbox(it);
        const c = U.boxCenter(b);
        if (U.pointInPolygon(c.x, c.y, poly)) return true;
        return U.polylineNear(poly, this.outlinePoints(it), 1);
      });
    }

    /** items crossed by an eraser / scribble path */
    itemsCrossing(path, radius, filter) {
      const box = U.boxFromPoints(path, 2, radius);
      const out = [];
      for (const it of this.near(box)) {
        if (filter && !filter(it)) continue;
        const b = this.bbox(it);
        if (it.type === 'note' || it.type === 'node' || it.type === 'image' || it.type === 'text' || it.type === 'pdfpage') {
          for (let i = 0; i < path.length; i += 2) if (U.pointInBox(path[i], path[i + 1], b)) { out.push(it); break; }
          continue;
        }
        const w = radius + (it.size || 2) / 2;
        if (U.polylineNear(path, this.outlinePoints(it), w)) out.push(it);
      }
      return out;
    }

    /* ── transforms ───────────────────────────────────────────────── */
    translate(item, dx, dy) {
      this.touch(item);
      if (item.type === 'stroke') {
        for (let i = 0; i < item.pts.length; i += 3) { item.pts[i] += dx; item.pts[i + 1] += dy; }
      } else if (item.type === 'edge') {
        if (!item.from.id) { item.from.x += dx; item.from.y += dy; }
        if (!item.to.id) { item.to.x += dx; item.to.y += dy; }
      } else { item.x += dx; item.y += dy; }
    }

    scaleItem(item, origin, sx, sy) {
      this.touch(item);
      const fx = v => origin.x + (v - origin.x) * sx;
      const fy = v => origin.y + (v - origin.y) * sy;
      if (item.type === 'stroke') {
        for (let i = 0; i < item.pts.length; i += 3) { item.pts[i] = fx(item.pts[i]); item.pts[i + 1] = fy(item.pts[i + 1]); }
        item.size *= (Math.abs(sx) + Math.abs(sy)) / 2;
      } else if (item.type === 'edge') {
        if (!item.from.id) { item.from.x = fx(item.from.x); item.from.y = fy(item.from.y); }
        if (!item.to.id) { item.to.x = fx(item.to.x); item.to.y = fy(item.to.y); }
      } else {
        const x2 = fx(item.x + (item.w || 0)), y2 = fy(item.y + (item.h || 0));
        item.x = fx(item.x); item.y = fy(item.y);
        item.w = x2 - item.x; item.h = y2 - item.y;
        if (item.type === 'text') item.size *= (Math.abs(sx) + Math.abs(sy)) / 2;
      }
    }

    contentBounds() {
      let b = null;
      for (const it of this.items) b = U.unionBox(b, this.bbox(it));
      return b;
    }

    /* ── serialisation ────────────────────────────────────────────── */
    toJSON() {
      return { v: 1, items: this.items.map(strip) };
    }
    load(doc) {
      this.items = []; this.byId.clear();
      for (const it of (doc.items || [])) this._insert(it, this.items.length);
      this.undoStack.length = this.redoStack.length = 0;
      this.version++;
    }
  }

  /**
   * Deep-copy an item, dropping the `_`-prefixed render caches.
   *
   * This used to be `JSON.parse(JSON.stringify(strip(item)))`, which is
   * concise and far more expensive than it looks: every undo snapshot
   * serialised the item to a string, parsed it back, and rounded every
   * coordinate on the way through. A drag clones each selected item twice,
   * and a stroke carries thousands of numbers, so it landed as a stutter at
   * each end of the gesture. Measured on one stroke: 22x faster at 30
   * points, 100x at 400, 292x at 3000.
   *
   * The rounding moved to `strip`, where it belongs. It is there to keep
   * the saved file small; undo wants fidelity, not compactness, so history
   * now holds exactly what was on the board.
   *
   * `undefined` values are dropped, as JSON did. Unlike JSON, a non-finite
   * number survives rather than becoming null — a NaN coordinate is a bug
   * worth seeing rather than one worth hiding.
   */
  function clone(it) {
    const o = {};
    for (const k in it) {
      if (k.charCodeAt(0) === 95) continue;            // '_' — a render cache
      const v = it[k];
      if (v === undefined) continue;
      if (v === null || typeof v !== 'object') { o[k] = v; continue; }
      if (ArrayBuffer.isView(v)) o[k] = Array.prototype.slice.call(v);
      else if (Array.isArray(v)) o[k] = v.map(x => (x && typeof x === 'object') ? clone(x) : x);
      else o[k] = clone(v);
    }
    return o;
  }

  /** clone(), plus the coordinate rounding the stored format uses */
  function strip(it) {
    const o = clone(it);
    if (o.pts) { for (let i = 0; i < o.pts.length; i++) o.pts[i] = Math.round(o.pts[i] * 100) / 100; }
    return o;
  }

  /** Deep equality on the same terms `clone` copies: caches ignored. */
  function sameItem(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
    let ka = 0;
    for (const k in a) {
      if (k.charCodeAt(0) === 95 || a[k] === undefined) continue;
      ka++;
      const x = a[k], y = b[k];
      if (x === y) continue;
      if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
      if (x.length !== undefined && y.length !== undefined) {
        if (x.length !== y.length) return false;
        for (let i = 0; i < x.length; i++) {
          const xi = x[i], yi = y[i];
          if (xi === yi) continue;
          if (!sameItem(xi, yi)) return false;
        }
        continue;
      }
      if (!sameItem(x, y)) return false;
    }
    let kb = 0;
    for (const k in b) if (k.charCodeAt(0) !== 95 && b[k] !== undefined) kb++;
    return ka === kb;
  }

  function swap(a, i, j) { const t = a[i]; a[i] = a[j]; a[j] = t; }

  /**
   * Clone a set of items with fresh identities.
   *
   * Copies need their own group: keeping the source group id would quietly
   * fold the copies in with the originals, so selecting any one of them
   * afterwards grabs both sets. Connectors are rewired to the copies too, so
   * a duplicated diagram is a diagram rather than a picture of one.
   */
  D.cloneSet = items => {
    const ids = new Map(), groups = new Map();
    const copies = items.map(it => {
      const c = clone(it);
      c.id = U.uid();
      ids.set(it.id, c.id);
      if (c.group) {
        if (!groups.has(c.group)) groups.set(c.group, U.uid());
        c.group = groups.get(c.group);
      }
      return c;
    });
    for (const c of copies) {
      if (c.type !== 'edge') continue;
      if (c.from.id && ids.has(c.from.id)) c.from = { id: ids.get(c.from.id) };
      if (c.to.id && ids.has(c.to.id)) c.to = { id: ids.get(c.to.id) };
    }
    return { copies, ids };
  };

  /**
   * What the eraser is allowed to remove: things you drew, not things you
   * placed. A PDF page, an image, a sticky or a node is hit-tested by its
   * whole area, so any stroke of the eraser *over* one would otherwise wipe
   * out the entire thing — annotating a PDF would delete the PDF. Those are
   * removed deliberately, with the select tool and Delete.
   */
  D.erasable = it => it.type === 'stroke' || it.type === 'shape' || it.type === 'edge';

  D.Scene = Scene;
  D.FONT_STACK = FONT_STACK;
  D.HAND_STACK = HAND_STACK;
  D.clone = clone;

  /* ── item factories ─────────────────────────────────────────────── */
  D.make = {
    stroke: (o) => Object.assign({ id: U.uid(), type: 'stroke', pts: [], color: '#111', size: 3, alpha: 1, thinning: 0.55, blend: 'source-over' }, o),
    shape: (o) => Object.assign({ id: U.uid(), type: 'shape', kind: 'rect', x: 0, y: 0, w: 0, h: 0, color: '#111', fill: 'none', size: 3, alpha: 1, dash: 0, radius: 10 }, o),
    text: (o) => Object.assign({ id: U.uid(), type: 'text', x: 0, y: 0, w: 260, text: '', color: '#111', size: 20, font: 'sans', align: 'left', alpha: 1 }, o),
    note: (o) => Object.assign({ id: U.uid(), type: 'note', x: 0, y: 0, w: 190, h: 190, text: '', color: '#ffe58a', size: 16, align: 'left', alpha: 1 }, o),
    node: (o) => Object.assign({ id: U.uid(), type: 'node', kind: 'process', x: 0, y: 0, w: 170, h: 68, text: '', color: '#111', fill: '#ffffff', size: 2, align: 'center', textSize: 15, alpha: 1 }, o),
    edge: (o) => Object.assign({ id: U.uid(), type: 'edge', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, color: '#111', size: 2, dash: 0, style: 'elbow', arrowEnd: true, arrowStart: false, label: '', alpha: 1 }, o),
    image: (o) => Object.assign({ id: U.uid(), type: 'image', x: 0, y: 0, w: 0, h: 0, src: '', alpha: 1 }, o),
    pdfpage: (o) => Object.assign({ id: U.uid(), type: 'pdfpage', asset: '', page: 1, pages: 1, label: '', x: 0, y: 0, w: 0, h: 0, alpha: 1 }, o)
  };

})(window.DPO);

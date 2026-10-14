/* ── scene.js ── the document: items, geometry, hit-testing, history ─ */
(function (D) {
  'use strict';
  const U = D.util, FH = D.freehand;
  /* Item types registered by feature files (see ext.js). Looked up only
     where a built-in type would have fallen through. */
  const XT = D.ext.items;

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

  /* Cells are keyed by a number, not a string: the index is rebuilt on
     every frame of a drag, and building a "cx,cy" string for every cell
     of every item made the rebuild mostly string allocation. Far-flung
     cells can share a key; that only adds candidates, which the box test
     in query() throws out. */
  const cellKey = (cx, cy) => (cx + 1048576) * 2097152 + (cy + 1048576);

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
            const k = cellKey(cx, cy);
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
          const bucket = this.cells.get(cellKey(cx, cy));
          if (bucket) for (const it of bucket) seen.add(it);
        }
      const out = [];
      for (const it of seen) if (U.boxesOverlap(box, scene.bbox(it))) out.push(it);
      out.sort((a, b) => a._z - b._z);
      return out;
    }
  }

  const BATCH = 32;                  // items before undo/redo switch to one-pass edits
  const UNDO_STEPS = 200;
  /* Roughly how many numbers history may hold: coordinates, plus a
     nominal amount per item. Eight million is about 64MB of them. */
  const UNDO_BUDGET = 8e6;

  /** how much one history step holds, in the units of UNDO_BUDGET */
  function weigh(op) {
    let n = 0;
    const w = it => { n += 24 + (it.pts ? it.pts.length : 0) + (typeof it.src === 'string' ? it.src.length / 8 : 0); };
    for (const it of op.adds) w(it);
    for (const r of op.removes) w(r.item);
    for (const u of op.updates) { w(u.before); w(u.after); }
    return n;
  }

  /* ── lines, arrows and what they hang from ─────────────────────────
     A line or arrow is a shape whose x,y is its start and x+w,y+h its
     end. Engineering drawing added to that, all optional, so a board
     from before reads the same:
       head1, head2   the arrowhead at each end: none, open, filled,
                      tick, dot, half (headsOf gives the old defaults)
       headScale      a multiplier on the head's size, which otherwise
                      follows the stroke width
       curve [u, v]   bent: where the curve's midpoint sits, as fractions
                      of the chord along it and across it — so a bend
                      survives the line being moved, stretched or turned
       via [x,y,…]    a polyline: the corners between the ends, absolute
       bind1, bind2   an end attached to something (see Scene.anchor)
     The moment arrow is kind 'moment': an arc in the ellipse box x,y,w,h
     from angle a0 sweeping `sweep` degrees, anticlockwise positive.   */
  const isLine = it => it.type === 'shape' && (it.kind === 'line' || it.kind === 'arrow');
  /** shapes that are a stroke rather than an area: no fill, nothing to host a connector */
  const isOpen = it => it.type === 'shape' && (it.kind === 'line' || it.kind === 'arrow' || it.kind === 'moment');

  const headsOf = it => [
    it.head1 || (it.kind === 'line' && it.arrowStart ? 'filled' : 'none'),
    it.head2 || (it.kind === 'arrow' || it.kind === 'moment' ? 'filled' : 'none')
  ];

  /** the control point of a bent line, or null if it is straight */
  function curveCtrl(a, b, curve) {
    if (!curve || (!curve[1] && curve[0] === 0.5)) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    // the on-curve midpoint, then the control point that puts it there
    const mx = a.x + curve[0] * dx - curve[1] * dy, my = a.y + curve[0] * dy + curve[1] * dx;
    return { x: 2 * mx - (a.x + b.x) / 2, y: 2 * my - (a.y + b.y) / 2 };
  }
  const CURVE_STEPS = 24;

  /** a moment arrow's arc: centre, radii, start and sweep in radians (anticlockwise on screen) */
  function arcOf(it) {
    const w = Math.abs(it.w), h = Math.abs(it.h);
    return {
      cx: Math.min(it.x, it.x + it.w) + w / 2, cy: Math.min(it.y, it.y + it.h) + h / 2, rx: w / 2, ry: h / 2,
      a0: (it.a0 || 0) * Math.PI / 180, sweep: (it.sweep ?? 270) * Math.PI / 180
    };
  }
  const arcPoint = (A, t) => ({ x: A.cx + A.rx * Math.cos(t), y: A.cy - A.ry * Math.sin(t) });

  /* The rectangle a thing really occupies, as opposed to its bbox, which
     is padded for the stroke and the shadow. Snap points and box-relative
     attachments are measured against this. */
  /** points [x,y,…] turned by `ang` radians about (cx, cy) */
  function turnPoints(pts, cx, cy, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), out = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - cx, dy = pts[i + 1] - cy;
      out[i] = cx + dx * c - dy * s; out[i + 1] = cy + dx * s + dy * c;
    }
    return out;
  }
  /** an angle in (−π, π], with a whisker either side of a right angle let go */
  function normAngle(a) {
    a = Math.atan2(Math.sin(a), Math.cos(a));
    const q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    return Math.abs(a - q) < 1e-9 ? Math.atan2(Math.sin(q), Math.cos(q)) : a;
  }
  /** turned by an angle about its own centre, rather than by its points */
  const BOX_TYPES = new Set(['text', 'note', 'node', 'image', 'pdfpage']);
  function rotatesAsBox(it) {
    if (it.type === 'shape') return !isLine(it);
    if (BOX_TYPES.has(it.type)) return true;
    const xt = XT[it.type];
    return !!xt && xt.rotate === 'box';
  }

  function geomBox(scene, it) {
    if (it.type === 'shape' || it.type === 'node' || it.type === 'note' || it.type === 'image' || it.type === 'pdfpage')
      return U.box(it.x, it.y, it.x + (it.w || 0), it.y + (it.h || 0));
    return scene.bbox(it);
  }

  /** the point a fraction `t` of the way along a flat polyline */
  function pointAlong(pts, t) {
    const total = U.pathLength(pts);
    let want = U.clamp(t, 0, 1) * total, d = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const l = U.dist(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      if (d + l >= want && l > 0) {
        const f = (want - d) / l;
        return { x: pts[i] + (pts[i + 2] - pts[i]) * f, y: pts[i + 1] + (pts[i + 3] - pts[i + 1]) * f };
      }
      d += l;
    }
    return { x: pts[pts.length - 2], y: pts[pts.length - 1] };
  }

  /** how far along a flat polyline (0–1) the point nearest (x, y) lies, and that point */
  function nearestAlong(pts, x, y) {
    const total = U.pathLength(pts) || 1;
    let best = Infinity, at = 0, d = 0, px = pts[0], py = pts[1];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
      const l2 = U.dist2(ax, ay, bx, by), l = Math.sqrt(l2);
      let f = l2 ? ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2 : 0;
      f = U.clamp(f, 0, 1);
      const qx = ax + (bx - ax) * f, qy = ay + (by - ay) * f, e = U.dist2(x, y, qx, qy);
      if (e < best) { best = e; at = (d + l * f) / total; px = qx; py = qy; }
      d += l;
    }
    return { t: at, x: px, y: py, d: Math.sqrt(best) };
  }

  /** an item's references to other items: what it is attached to (not connectors, which have their own rules) */
  const NO_REFS = [];
  function refsOf(it) {
    if (it.type === 'shape') return it.bind1 || it.bind2 ? [it.bind1, it.bind2].filter(Boolean) : NO_REFS;
    const x = XT[it.type];
    return x && x.refs ? x.refs(it) : NO_REFS;
  }
  /** let go of whatever `it` holds of item `id`, keeping where it is now */
  function detach(it, id) {
    if (it.type === 'shape') {
      if (it.bind1 && it.bind1.id === id) delete it.bind1;
      if (it.bind2 && it.bind2.id === id) delete it.bind2;
      return;
    }
    const x = XT[it.type];
    if (x && x.detach) x.detach(it, id);
  }

  class Scene {
    constructor(doc) {
      this.items = [];                 // back → front
      this.byId = new Map();
      /* Board-wide settings that belong to the drawing rather than to the
         app — the drawing scale and its units (cad.js). Saved with the
         board and undone like an edit to an item. */
      this.meta = {};
      this.metaRev = 0;                // moves whenever meta does, for what formats with it
      this.undoStack = [];
      this.redoStack = [];
      this.tx = null;
      this.version = 0;
      /* Moves on every change except adding an item on top. While it
         stands still, everything already on the board is exactly as it
         was, so the painter may draw just the new items over its last
         picture instead of repainting the board (Renderer.drawScene). */
      this.edits = 0;
      /* Where the picture changed since the painter last asked (see
         takeDamage): the area of each stroke added, removed or touched. */
      this._damage = null;
      this._damageFrom = 0;          // `edits` when the painter last asked
      this._hurtCount = 0;           // how many of the edits since then are accounted for
      this._later = new Set();       // strokes touched: their new area is known only once they are done
      this.onchange = null;
      this._grid = new Grid();
      if (doc) this.load(doc);
    }

    /* ── basic access ─────────────────────────────────────────────── */
    get(id) { return this.byId.get(id); }
    indexOf(item) { return this.items.indexOf(item); }

    /* ── damage ───────────────────────────────────────────────────────
       The painter used to repaint the whole view for any change that was
       not a stroke added on top — so each nibble of the eraser, on a dense
       page, re-rasterised every stroke on screen. Each change made to a
       stroke records the area it covers (before, and for a stroke that is
       being changed, after), and takeDamage hands the painter the union,
       to repaint that rectangle alone.

       Only strokes: a connector bends when the node it hangs from moves,
       a note casts a shadow, a text box reflows — their areas are not
       worth chasing, so a change to anything else means "everything". And
       it fails safe: takeDamage compares the number of edits accounted
       for with the number made, so a change that does not come through
       here (undo, reorder, a load) also means "everything". */
    _hurt(item, counted) {
      if (counted) this._hurtCount++;
      if (this._damage === true) return;
      if (!item || item.type !== 'stroke') { this._damage = true; return; }
      this._damage = U.unionBox(this._damage, this.bbox(item));
    }

    /** the area changed since the last call, in world units; true for "everything", null for nothing */
    takeDamage() {
      let all = this._damage === true || this.edits - this._damageFrom !== this._hurtCount;
      let box = all ? null : this._damage;
      if (!all) for (const it of this._later) if (this.byId.get(it.id) === it) box = U.unionBox(box, this.bbox(it));
      this._damage = null; this._hurtCount = 0; this._damageFrom = this.edits; this._later.clear();
      return all ? true : box;
    }

    dirty(item) {
      if (item) {
        this._hurt(item, true);
        if (item.type === 'stroke') this._later.add(item);
        item._b = null; item._path = null; item._lod = null; item._lines = null; item._json = null;
      }
      this.edits++;
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
      this._hurt(item, true);
      if (item.type === 'stroke') this._later.add(item);
      item._b = null; item._path = null; item._lod = null; item._lines = null; item._json = null;
      this.edits++;
      return item;
    }

    /**
     * touch(), for an item about to be moved and nothing else.
     *
     * A drag re-positions every selected item on every frame, and touch()
     * threw away each stroke's outline as it went, so a thousand selected
     * strokes were re-outlined from scratch sixty times a second — about
     * 34ms a frame, well past what a frame has. An outline does not change
     * shape when it moves, so here only the box goes; the painters notice
     * that a stroke's first point is not where its outline was built and
     * draw the outline offset (see Renderer.drawStroke).
     */
    touchMoved(item) {
      if (this.tx && !this.tx.before.has(item.id)) this.tx.before.set(item.id, clone(item));
      this._hurt(item, true);
      if (item.type === 'stroke') this._later.add(item);
      item._b = null; item._json = null;
      this.edits++;
      return item;
    }

    /** change a board-wide setting (see `meta`); recorded in the open step, if there is one */
    setMeta(key, value) {
      if (this.tx && !this.tx.meta) this.tx.meta = clone(this.meta);
      if (value == null) delete this.meta[key];
      else this.meta[key] = value && typeof value === 'object' ? clone(value) : value;
      this.metaRev++;
      this._hurt(null, true);           // anything may be formatted with it: repaint the lot
      this.edits++;
      this.version++;
      if (this.onchange) this.onchange();
    }

    commit() {
      const t = this.tx;
      if (!t) return;
      this._settle(t);
      this.tx = null;
      const updates = [];
      for (const [id, before] of t.before) {
        const now = this.byId.get(id);
        /* A click that selects but does not move still runs through touch().
           Recording that as an undo step means the first Ctrl+Z after it
           appears to do nothing, so drop the ones that changed nothing. */
        if (now && !sameItem(before, now)) updates.push({ id, before, after: clone(now) });
      }
      /* Something both made and removed within the step — a piece of a
         stroke the pixel eraser cut, then cut again before lifting — was
         never on the board before or after it. Undo used to put it back
         anyway, as a stray duplicate over the restored stroke. */
      let adds = t.adds, removes = t.removes;
      if (adds.length && removes.length) {
        const made = new Set(adds);
        const passing = new Set(removes.filter(r => made.has(r.item)).map(r => r.item));
        if (passing.size) {
          adds = adds.filter(it => !passing.has(it));
          removes = removes.filter(r => !passing.has(r.item));
        }
      }
      const meta = t.meta && !sameItem(t.meta, this.meta) ? { before: t.meta, after: clone(this.meta) } : null;
      if (!adds.length && !removes.length && !updates.length && !meta) return;
      const op = { label: t.label, adds: adds.map(clone), removes: removes.map(r => ({ item: clone(r.item), index: r.index })), updates };
      if (meta) op.meta = meta;
      op.weight = weigh(op);
      this.undoStack.push(op);
      this.redoStack.length = 0;
      this.trimHistory();
      this.version++;
      if (this.onchange) this.onchange();
    }

    /* History is capped by what it holds as well as by how many steps it
       has. Two hundred steps is nothing for a pen stroke and a great deal
       for "select all, nudge": each of those holds a before and an after
       copy of every stroke on the board, and a few dozen of them on a
       big board ran to gigabytes - the tab died, taking the unsaved work
       with it. The oldest steps go first; the newest is always kept. */
    trimHistory() {
      let held = 0;
      for (const op of this.undoStack) held += op.weight || 0;
      while (this.undoStack.length > 1 && (this.undoStack.length > UNDO_STEPS || held > UNDO_BUDGET))
        held -= this.undoStack.shift().weight || 0;
    }

    /* Things attached to other things — an arrow's bound end, a dimension
       on a corner — are drawn wherever their targets are now, but they
       also keep the coordinates they last resolved to. Those are brought
       up to date here, as part of the step that moved the target, so
       undo puts both back together; and an attachment whose target went
       is let go, leaving the thing exactly where it was. Keeping the
       stored coordinates current is what lets everything that only reads
       them — a copy, a paste into another board, an old copy of the app
       — see the drawing as it is.

       Ink can be neither, so a step that only touched strokes (every pen
       stroke, every eraser rub) skips the walk entirely. */
    _settle(t) {
      let need = false;
      for (const it of t.adds) if (it.type !== 'stroke') { need = true; break; }
      if (!need) for (const r of t.removes) if (r.item.type !== 'stroke') { need = true; break; }
      if (!need) for (const id of t.before.keys()) { const it = this.byId.get(id); if (it && it.type !== 'stroke') { need = true; break; } }
      if (!need) return;
      for (const it of this.items) {
        const refs = refsOf(it);
        if (!refs.length) continue;
        let gone = null;
        for (const r of refs) if (!this.byId.has(r.id)) (gone || (gone = [])).push(r.id);
        if (gone) { this.touch(it); for (const id of gone) detach(it, id); }
        if (it.type === 'shape') {
          const [a, b] = this.lineEnds(it);
          if (Math.abs(a.x - it.x) + Math.abs(a.y - it.y) + Math.abs(b.x - it.x - it.w) + Math.abs(b.y - it.y - it.h) > 1e-6) {
            this.touch(it);
            it.x = a.x; it.y = a.y; it.w = b.x - a.x; it.h = b.y - a.y;
          }
        } else {
          const x = XT[it.type];
          if (x && x.settle) x.settle(it, this);
        }
      }
    }

    cancel() { this.tx = null; }

    undo() {
      const op = this.undoStack.pop(); if (!op) return null;
      this._removeIds(op.adds.map(it => it.id));
      this._restore(op.removes);
      this._replaceAll(op.updates.map(u => clone(u.before)));
      if (op.meta) { this.meta = clone(op.meta.before); this.metaRev++; }
      this.redoStack.push(op);
      this.edits++;
      this.version++; if (this.onchange) this.onchange();
      return op;
    }

    redo() {
      const op = this.redoStack.pop(); if (!op) return null;
      this._replaceAll(op.updates.map(u => clone(u.after)));
      if (op.meta) { this.meta = clone(op.meta.after); this.metaRev++; }
      this._removeIds(op.removes.map(r => r.item.id));
      for (const it of op.adds) this._insert(clone(it), this.items.length);
      this.undoStack.push(op);
      this.edits++;
      this.version++; if (this.onchange) this.onchange();
      return op;
    }

    /* ── mutation ─────────────────────────────────────────────────── */
    add(item, index) {
      const e0 = this.edits;
      this._insert(item, index ?? this.items.length);
      this._hurt(item, this.edits !== e0);          // under something counts as an edit; on top does not
      if (this.tx) this.tx.adds.push(item);
      this.version++; if (this.onchange) this.onchange();
      return item;
    }

    remove(item) {
      const index = this.items.indexOf(item);
      if (index < 0) return;
      if (this.tx) this.tx.removes.push({ item, index });
      this._hurt(item, true);
      this._remove(item.id);
      // detach edges that pointed at it (nothing can be attached to ink)
      if (item.type !== 'stroke' && item.type !== 'edge') {
        for (const e of this.items.filter(i => i.type === 'edge' && (i.from.id === item.id || i.to.id === item.id))) {
          if (this.tx) this.tx.removes.push({ item: e, index: this.items.indexOf(e) });
          this._remove(e.id);
        }
      }
      this.edits++;
      this.version++; if (this.onchange) this.onchange();
    }

    /**
     * Remove a set of items, and any connector left pointing at one, in
     * one pass over the board.
     *
     * remove() is a search, a splice and an edge scan per item, which is
     * fine for an eraser taking a stroke at a time and quadratic for
     * select-all-and-delete: twenty thousand strokes took over a second
     * and a half, with the window frozen. Recorded exactly as the same
     * removes made one by one in board order would be, so undo needs no
     * special case.
     */
    removeMany(items) {
      const gone = new Set();
      for (const it of items) if (it && this.byId.get(it.id) === it) gone.add(it);
      if (!gone.size) return;
      const ids = new Set();
      for (const it of gone) if (it.type !== 'stroke' && it.type !== 'edge') ids.add(it.id);
      if (ids.size) for (const e of this.items)
        if (e.type === 'edge' && ((e.from.id && ids.has(e.from.id)) || (e.to.id && ids.has(e.to.id)))) gone.add(e);
      for (const it of gone) this._hurt(it, false);
      this._hurtCount++;                              // the one edit below
      const keep = [];
      let removed = 0;
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        if (!gone.has(it)) { keep.push(it); continue; }
        if (this.tx) this.tx.removes.push({ item: it, index: i - removed });
        removed++;
        this.byId.delete(it.id);
      }
      this.items = keep;
      this.edits++;
      this.version++; if (this.onchange) this.onchange();
    }

    _insert(item, index) {
      item._b = null; item._path = null; item._lod = null; item._lines = null; item._json = null;
      if (index < this.items.length) this.edits++;      // under something: not an add on top
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

    /* The batch forms of the three above, for undo and redo. Each of those
       is a search through the board per item; a step that touched
       thousands of items (a big delete, select-all-and-move) paid that
       thousands of times over. Below a few dozen the simple form wins. */

    _removeIds(ids) {
      if (ids.length < BATCH) { for (const id of ids) this._remove(id); return; }
      const set = new Set(ids);
      this.items = this.items.filter(it => !set.has(it.id));
      for (const id of set) this.byId.delete(id);
    }

    /* Removals are recorded with the index each item had at the moment it
       went, and put back in reverse. Where those indices never decrease -
       always, for removeMany, and for removes made in board order - item
       j ends up at index + j, so the lot can be merged back in one pass.
       Anything else takes the splices. */
    _restore(removes) {
      const n = removes.length;
      let ordered = n >= BATCH;
      for (let j = 1; ordered && j < n; j++) if (removes[j].index < removes[j - 1].index) ordered = false;
      if (!ordered) { for (let j = n - 1; j >= 0; j--) this._insert(clone(removes[j].item), removes[j].index); return; }
      const cur = this.items, out = [];
      let j = 0, k = 0;
      while (j < n || k < cur.length) {
        if (j < n && (removes[j].index + j <= out.length || k >= cur.length)) {
          const it = clone(removes[j++].item);
          this.byId.set(it.id, it);
          out.push(it);
        } else out.push(cur[k++]);
      }
      this.items = out;
    }

    _replaceAll(items) {
      if (items.length < BATCH) { for (const it of items) this._replace(it.id, it); return; }
      const want = new Map(items.map(it => [it.id, it]));
      for (let i = 0; i < this.items.length; i++) {
        const next = want.get(this.items[i].id);
        if (!next) continue;
        this.items[i] = next;
        this.byId.set(next.id, next);
        want.delete(next.id);
      }
      for (const it of want.values()) this._insert(it, this.items.length);
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
      this.edits++;
      this.version++; if (this.onchange) this.onchange();
    }

    /* ── geometry ─────────────────────────────────────────────────── */
    bbox(item) {
      if (item._b && (!item._ends || this._edgeBoxFresh(item))) return item._b;
      /* A cycle of attachments (A's end on B's, B's on A's) would recurse
         here for ever; past a few levels the old box, or nothing, will do. */
      if (this._depth > 6) return item._b || U.emptyBox();
      this._depth = (this._depth || 0) + 1;
      try { return this._bbox(item); } finally { this._depth--; }
    }

    _bbox(item) {
      let b;
      switch (item.type) {
        case 'stroke':
          b = U.boxFromPoints(item.pts, 3, item.size / 2 + 1); break;
        case 'shape': {
          if (isLine(item)) {
            const hs = headSpan(item);
            b = U.boxFromPoints(this.linePath(item), 2, Math.max(item.size + 6, hs + item.size));
          } else if (item.kind === 'moment') {
            b = U.growBox(U.box(item.x, item.y, item.x + item.w, item.y + item.h), item.size / 2 + headSpan(item));
          } else {
            b = U.box(item.x, item.y, item.x + item.w, item.y + item.h);
            b = U.growBox(b, item.size / 2);
          }
          break;
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
        default: {
          const x = XT[item.type];
          // the scene comes second, for a type whose box depends on what it is attached to
          if (x) { const r = x.bbox(item, this); b = U.box(r.x, r.y, r.x + r.w, r.y + r.h); }
          else b = U.box(item.x, item.y, item.x + item.w, item.y + item.h);
          /* A type with no position of its own — one from a feature this
             copy does not have — boxes to nothing rather than to NaN,
             which would poison every union it joined (zoom to fit, the
             export's bounds). It is kept, never drawn, never hit. */
          if (!(b.w >= 0 && b.h >= 0)) b = U.emptyBox();
        }
      }
      /* A turned box is boxed by its turned corners; the box it was
         turned from stays on the result as `local`, about whose centre
         everything — painting, hit tests, outlines, snaps — turns it. */
      if (item.rot && rotatesAsBox(item)) {
        const c = U.boxCenter(b), L = b;
        b = U.boxFromPoints(turnPoints([b.x, b.y, b.x2, b.y, b.x2, b.y2, b.x, b.y2], c.x, c.y, item.rot), 2, 0);
        b.local = L;
      }
      if (item.type !== 'edge') item._ends = refsOf(item).length ? this._edgeEnds(item) : undefined;
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
       complete and nearly free check.

       The same goes for anything else attached to something — an arrow
       with a bound end, a dimension on a corner (refsOf) — which keeps
       its targets' boxes in `_ends` the same way. Only items that have
       attachments carry `_ends`, so for everything else the check is one
       property read. */
    _edgeEnds(item) {
      if (item.type !== 'edge') return refsOf(item).map(r => { const t = this.byId.get(r.id); return t ? this.bbox(t) : null; });
      const f = item.from.id && this.byId.get(item.from.id);
      const t = item.to.id && this.byId.get(item.to.id);
      return [f ? this.bbox(f) : null, t ? this.bbox(t) : null];
    }
    _edgeBoxFresh(item) {
      const was = item._ends, now = this._edgeEnds(item);
      if (!was || was.length !== now.length) return false;
      for (let i = 0; i < now.length; i++) if (was[i] !== now[i]) return false;
      return true;
    }

    /* ── lines and attachments ────────────────────────────────────── */

    /** where an attachment points now: {x, y}, or null if its target has gone */
    anchor(ref, depth = 0) {
      const t = ref && this.byId.get(ref.id);
      if (!t || depth > 4) return null;
      if (ref.k === 't') return pointAlong(this.outlineOf(t, depth + 1), ref.t || 0);
      if (ref.k === '@') {
        if (t.type === 'shape' && (t.kind === 'ellipse' || t.kind === 'moment')) return arcPoint(arcOf(t), ref.a || 0);
        const g = geomBox(this, t);
        return { x: g.x + g.w / 2 + Math.cos(ref.a || 0) * g.w / 2, y: g.y + g.h / 2 - Math.sin(ref.a || 0) * g.h / 2 };
      }
      if (ref.k) { const p = this.snapPoints(t, depth + 1).find(s => s.k === ref.k); return p ? { x: p.x, y: p.y } : null; }
      if (ref.u != null) { const g = geomBox(this, t); return { x: g.x + ref.u * g.w, y: g.y + ref.v * g.h }; }
      return null;
    }

    /** a line's two ends, wherever its attachments put them now */
    lineEnds(it, depth = 0) {
      let a = null, b = null;
      if (it.bind1) a = this.anchor(it.bind1, depth);
      if (it.bind2) b = this.anchor(it.bind2, depth);
      return [a || { x: it.x, y: it.y }, b || { x: it.x + it.w, y: it.y + it.h }];
    }

    /** a line's centreline as a flat [x,y,…] polyline: corners for a polyline, samples for a curve */
    linePath(it, depth = 0) {
      const [a, b] = this.lineEnds(it, depth);
      if (it.via && it.via.length >= 2) return [a.x, a.y, ...it.via, b.x, b.y];
      const c = curveCtrl(a, b, it.curve);
      if (!c) return [a.x, a.y, b.x, b.y];
      const out = [];
      for (let i = 0; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS, mt = 1 - t;
        out.push(mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x, mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y);
      }
      return out;
    }

    /** what a thing looks like as a polyline, for measuring along it: a line's centreline, an outline otherwise */
    outlineOf(it, depth = 0) {
      if (isLine(it)) return this.linePath(it, depth);
      return this.outlinePoints(it);
    }

    /**
     * The points worth snapping to on an item: ends, corners, midpoints,
     * centres and quadrant points, each with a key that names it for an
     * attachment ({id, k}) and a `t` that says what sort it is (end, mid,
     * centre, quad) for the marker. Ink offers its two ends only, and
     * says it cannot be attached to.
     */
    snapPoints(it, depth = 0) {
      const out = this._snapPoints(it, depth), b = it.rot ? this.bbox(it) : null;
      if (b && b.local) {
        const c = U.boxCenter(b.local);
        for (const p of out) { const q = turnPoints([p.x, p.y], c.x, c.y, it.rot); p.x = q[0]; p.y = q[1]; }
      }
      return out;
    }

    _snapPoints(it, depth) {
      const out = [];
      const P = (k, x, y, t) => out.push({ k, x, y, t });
      const rect = g => {
        const { x, y, x2, y2 } = g, mx = (x + x2) / 2, my = (y + y2) / 2;
        P('nw', x, y, 'end'); P('ne', x2, y, 'end'); P('se', x2, y2, 'end'); P('sw', x, y2, 'end');
        P('n', mx, y, 'mid'); P('e', x2, my, 'mid'); P('s', mx, y2, 'mid'); P('w', x, my, 'mid');
        P('c', mx, my, 'centre');
      };
      switch (it.type) {
        case 'stroke': {
          const n = it.pts.length;
          if (n >= 3) { P('p0', it.pts[0], it.pts[1], 'end'); P('p1', it.pts[n - 3], it.pts[n - 2], 'end'); }
          out.ink = true;
          break;
        }
        case 'shape': {
          if (isLine(it)) {
            const pts = this.linePath(it, depth), n = pts.length;
            P('p0', pts[0], pts[1], 'end'); P('p1', pts[n - 2], pts[n - 1], 'end');
            if (it.via) for (let i = 0; i < it.via.length; i += 2) P('v' + i / 2, it.via[i], it.via[i + 1], 'end');
            const m = pointAlong(pts, 0.5); P('m', m.x, m.y, 'mid');
            break;
          }
          const g = geomBox(this, it), mx = (g.x + g.x2) / 2, my = (g.y + g.y2) / 2;
          if (it.kind === 'ellipse') {
            P('c', mx, my, 'centre');
            P('n', mx, g.y, 'quad'); P('e', g.x2, my, 'quad'); P('s', mx, g.y2, 'quad'); P('w', g.x, my, 'quad');
          } else if (it.kind === 'moment') {
            const A = arcOf(it), e0 = arcPoint(A, A.a0), e1 = arcPoint(A, A.a0 + A.sweep);
            P('c', A.cx, A.cy, 'centre'); P('p0', e0.x, e0.y, 'end'); P('p1', e1.x, e1.y, 'end');
          } else if (it.kind === 'diamond') {
            P('n', mx, g.y, 'end'); P('e', g.x2, my, 'end'); P('s', mx, g.y2, 'end'); P('w', g.x, my, 'end');
            P('c', mx, my, 'centre');
          } else if (it.kind === 'triangle') {
            P('n', mx, g.y, 'end'); P('se', g.x2, g.y2, 'end'); P('sw', g.x, g.y2, 'end');
            P('s', mx, g.y2, 'mid'); P('e', (mx + g.x2) / 2, my, 'mid'); P('w', (g.x + mx) / 2, my, 'mid');
            P('c', mx, g.y + g.h * 2 / 3, 'centre');
          } else rect(g);
          break;
        }
        case 'edge': {
          const pts = this.edgePath(it), n = pts.length;
          P('p0', pts[0], pts[1], 'end'); P('p1', pts[n - 2], pts[n - 1], 'end');
          const m = pointAlong(pts, 0.5); P('m', m.x, m.y, 'mid');
          break;
        }
        default: {
          const x = XT[it.type];
          if (x && x.snaps === false) break;
          if (x && x.snapPoints) { for (const p of x.snapPoints(it, this)) P(p.k, p.x, p.y, p.t || 'end'); break; }
          rect(geomBox(this, it));
        }
      }
      return out;
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
    /** the item's outline in board space; `local`: before a turned box is turned */
    outlinePoints(item, local) {
      const pts = this._outline(item);
      const b = !local && item.rot ? this.bbox(item) : null;
      if (!b || !b.local) return pts;
      const c = U.boxCenter(b.local);
      return turnPoints(pts, c.x, c.y, item.rot);
    }

    _outline(item) {
      switch (item.type) {
        case 'stroke': return D.recognize.xy(item.pts);
        case 'edge': return this.edgePath(item);
        case 'shape': {
          const { x, y, w, h, kind } = item;
          if (kind === 'line' || kind === 'arrow') return this.linePath(item);
          if (kind === 'moment') {
            const A = arcOf(item), o = [], n = Math.max(6, Math.ceil(Math.abs(A.sweep) / 0.2));
            for (let i = 0; i <= n; i++) { const p = arcPoint(A, A.a0 + A.sweep * i / n); o.push(p.x, p.y); }
            return o;
          }
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
          const x = XT[item.type];
          if (x && x.outline) return x.outline(item);
          const b = this.bbox(item);
          return [b.x, b.y, b.x2, b.y, b.x2, b.y2, b.x, b.y2, b.x, b.y];
        }
      }
    }

    hitItem(item, x, y, tol) {
      let b = this.bbox(item);
      if (!U.pointInBox(x, y, U.growBox(b, tol))) return false;
      // a turned box: the point is turned back, and tested against the box as it was
      const turned = !!b.local;
      if (turned) {
        b = b.local;
        const c = U.boxCenter(b), p = turnPoints([x, y], c.x, c.y, -item.rot);
        x = p[0]; y = p[1];
        if (!U.pointInBox(x, y, U.growBox(b, tol))) return false;
      }
      if (item.type === 'text' || item.type === 'note' || item.type === 'node' || item.type === 'image' || item.type === 'pdfpage') return true;
      if (item.type === 'shape' && item.fill && item.fill !== 'none' && !isOpen(item))
        return U.pointInPolygon(x, y, this.outlinePoints(item, turned));
      const xt = XT[item.type];
      if (xt) {
        // the scene comes last, for a type that is drawn where its attachments put it
        if (xt.hit) return !!xt.hit(item, x, y, tol, this);
        if (xt.solid === false && xt.outline) return U.pointNearPolyline(x, y, xt.outline(item, this), (item.size || 2) / 2 + tol);
        return true;                                   // inside the box, which is all it asked
      }
      const w = (item.size || 2) / 2 + tol;
      return U.pointNearPolyline(x, y, this.outlinePoints(item, turned), w);
    }

    /** candidate items overlapping `box`, back → front */
    near(box) { return this._grid.query(this, box); }

    hitTest(x, y, tol = 6, filter) {
      const cand = this.near(U.box(x - tol, y - tol, x + tol, y + tol));
      for (let i = cand.length - 1; i >= 0; i--) {
        const it = cand[i];
        if (filter && !filter(it)) continue;
        if (this.hitItem(it, x, y, tol)) return it;
      }
      return null;
    }

    /** topmost node/note/shape that can host a connector */
    hitNode(x, y) {
      const cand = this.near(U.box(x, y, x, y));
      for (let i = cand.length - 1; i >= 0; i--) {
        const it = cand[i];
        if (it.type === 'node' || it.type === 'note' || it.type === 'text' ||
          (it.type === 'shape' && !isOpen(it))) {
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
        // a type that asks to be gone all the way round (a page): every corner of its outline inside
        const xt = XT[it.type];
        if (xt && xt.enclose) {
          const o = this.outlinePoints(it);
          for (let i = 0; i < o.length; i += 2) if (!U.pointInPolygon(o[i], o[i + 1], poly)) return false;
          return true;
        }
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
        const xt = XT[it.type];
        if (xt && xt.solid !== false) {
          for (let i = 0; i < path.length; i += 2) if (U.pointInBox(path[i], path[i + 1], b)) { out.push(it); break; }
          continue;
        }
        /* a registered thin thing with no outline of its own: ask it, at
           each point of the path */
        if (xt && !xt.outline && xt.hit) {
          for (let i = 0; i < path.length; i += 2) if (xt.hit(it, path[i], path[i + 1], radius)) { out.push(it); break; }
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
      } else {
        const x = XT[item.type];
        if (x && x.translate) x.translate(item, dx, dy);
        else {
          item.x += dx; item.y += dy;
          if (item.via) item.via = item.via.map((v, i) => v + (i & 1 ? dy : dx));
        }
      }
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
      } else if (XT[item.type] && XT[item.type].scale) {
        XT[item.type].scale(item, origin, sx, sy);
      } else {
        const x2 = fx(item.x + (item.w || 0)), y2 = fy(item.y + (item.h || 0));
        item.x = fx(item.x); item.y = fy(item.y);
        item.w = x2 - item.x; item.h = y2 - item.y;
        if (item.type === 'text') item.size *= (Math.abs(sx) + Math.abs(sy)) / 2;
        if (item.via) item.via = item.via.map((v, i) => i & 1 ? fy(v) : fx(v));
        /* A mirror turns a bend, and a moment, the other way. The curve's
           across-fraction is measured to the left of the chord, which a
           flip puts on the right. */
        if (sx * sy < 0 && item.curve) item.curve = [item.curve[0], -item.curve[1]];
        if (item.type === 'shape' && item.kind === 'moment') {
          if (sx < 0) item.a0 = 180 - (item.a0 || 0);
          if (sy < 0) item.a0 = -(item.a0 || 0);
          if (sx * sy < 0) item.sweep = -(item.sweep ?? 270);
        }
      }
    }

    /**
     * Turn an item by `ang` radians (clockwise on screen, as y runs down)
     * about `origin`. Ink, lines and a connector's loose ends have their
     * points turned; a box — a shape, text, note, node, picture or page —
     * is carried round by its centre and keeps the angle in `rot`, about
     * that centre. A feature's type turns itself (`rotate`), turns as a
     * box (`rotate: 'box'`), or is only carried round.
     */
    rotateItem(item, origin, ang) {
      this.touch(item);
      const ox = origin.x, oy = origin.y;
      if (item.type === 'stroke') {
        const p = item.pts, c = Math.cos(ang), s = Math.sin(ang);
        for (let i = 0; i < p.length; i += 3) {
          const dx = p[i] - ox, dy = p[i + 1] - oy;
          p[i] = ox + dx * c - dy * s; p[i + 1] = oy + dx * s + dy * c;
        }
        return;
      }
      if (item.type === 'edge') {
        for (const e of [item.from, item.to]) if (!e.id) { const q = turnPoints([e.x, e.y], ox, oy, ang); e.x = q[0]; e.y = q[1]; }
        return;
      }
      if (isLine(item)) {
        const q = turnPoints([item.x, item.y, item.x + item.w, item.y + item.h], ox, oy, ang);
        item.x = q[0]; item.y = q[1]; item.w = q[2] - q[0]; item.h = q[3] - q[1];
        if (item.via) item.via = turnPoints(item.via, ox, oy, ang);
        return;
      }
      const xt = XT[item.type];
      if (xt && typeof xt.rotate === 'function') { xt.rotate(item, origin, ang, this); return; }
      const b = this.bbox(item), c = U.boxCenter(b.local || b);
      const q = turnPoints([c.x, c.y], ox, oy, ang);
      this.translate(item, q[0] - c.x, q[1] - c.y);
      if (!rotatesAsBox(item)) return;
      const r = normAngle((item.rot || 0) + ang);
      if (Math.abs(r) < 1e-9) delete item.rot; else item.rot = r;
    }

    contentBounds() {
      let b = null;
      // an item that boxes to nothing (see bbox) has no say in where the board is
      for (const it of this.items) { const x = this.bbox(it); if (isFinite(x.x)) b = U.unionBox(b, x); }
      return b;
    }

    /* ── serialisation ────────────────────────────────────────────── */
    toJSON() {
      return this.hasMeta() ? { v: 1, meta: clone(this.meta), items: this.items.map(strip) } : { v: 1, items: this.items.map(strip) };
    }

    hasMeta() { for (const _ in this.meta) return true; return false; }

    /**
     * The board as the bytes that get saved: the UTF-8 of what
     * JSON.stringify(toJSON()) would give, assembled from a copy of each
     * item's own kept beside it.
     *
     * Saving used to copy, round and serialise every item on the board on
     * every autosave, and the autosave lands whenever the pen rests for
     * half a second — at eight thousand strokes, half a second of frozen
     * window that the next stroke started into. An item's saved form only
     * changes when the item does, and every change goes through touch(),
     * touchMoved() or dirty(), which drop it with the other caches; so a
     * save now serialises the strokes drawn since the last one and copies
     * the rest. Bytes rather than text, because encoding ten megabytes of
     * text on the way out cost more than everything else left.
     */
    docBytes() {
      const items = this.items, n = items.length;
      const parts = new Array(n);
      // a board with settings of its own says so ahead of its items, as toJSON does
      const head = this.hasMeta() ? ENCODER.encode('{"v":1,"meta":' + JSON.stringify(this.meta) + ',"items":[') : DOC_HEAD;
      let size = head.length + DOC_TAIL.length + Math.max(0, n - 1);
      for (let i = 0; i < n; i++) size += (parts[i] = itemBytes(items[i])).length;
      const out = new Uint8Array(size);
      out.set(head, 0);
      let o = head.length;
      for (let i = 0; i < n; i++) {
        if (i) out[o++] = 44;                          // ','
        out.set(parts[i], o); o += parts[i].length;
      }
      out.set(DOC_TAIL, o);
      return out;
    }

    /** docBytes() as text, for the few places that want a string */
    docText() { return DECODER.decode(this.docBytes()); }

    /**
     * Serialise items ahead of the first save, a slice at a time, while
     * nothing else is happening. A board just opened has no saved text
     * yet, and its first autosave would otherwise pay for all of it at
     * once. Returns true once every item is done.
     */
    warmText(deadline) {
      const items = this.items;
      for (let i = this._warm || 0; i < items.length; i++) {
        if (!items[i]._json) itemBytes(items[i]);
        if ((i & 63) === 63 && deadline.timeRemaining() < 2) { this._warm = i + 1; return false; }
      }
      this._warm = 0;
      return true;
    }
    load(doc) {
      this.items = []; this.byId.clear();
      this.meta = doc.meta && typeof doc.meta === 'object' ? clone(doc.meta) : {};
      this.metaRev++;
      for (const it of (doc.items || [])) this._insert(it, this.items.length);
      this.undoStack.length = this.redoStack.length = 0;
      this.edits++;
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

  /* An item's saved form, as UTF-8 JSON, kept on it until it changes
     (see Scene.docBytes). */
  const ENCODER = new TextEncoder(), DECODER = new TextDecoder();
  const DOC_HEAD = ENCODER.encode('{"v":1,"items":['), DOC_TAIL = ENCODER.encode(']}');
  function itemBytes(it) {
    return it._json || (it._json = ENCODER.encode(JSON.stringify(strip(it))));
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
      if (c.type === 'edge') {
        if (c.from.id && ids.has(c.from.id)) c.from = { id: ids.get(c.from.id) };
        if (c.to.id && ids.has(c.to.id)) c.to = { id: ids.get(c.to.id) };
        continue;
      }
      /* An attachment comes along when what it is attached to does, and
         is let go when that stays behind: a copied arrow should not reach
         back to the original box. Its coordinates are already where the
         attachment put it (Scene._settle). */
      for (const r of refsOf(c).slice()) {
        if (ids.has(r.id)) r.id = ids.get(r.id);
        else detach(c, r.id);
      }
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
  D.erasable = it => it.type === 'stroke' || it.type === 'shape' || it.type === 'edge' ||
    !!(XT[it.type] && XT[it.type].erasable);

  /**
   * The things you work on top of: a PDF page or a picture. They are hit
   * by their whole area, so a press anywhere in the gaps between the
   * notes written over one lands on it — which made the page, not the
   * notes, the thing that moved. The select tool therefore lets them be
   * picked up only deliberately (see SelectTool.down).
   */
  D.backdrop = it => !!it && (it.type === 'pdfpage' || it.type === 'image' ||
    !!(XT[it.type] && XT[it.type].backdrop));

  /** how long an arrowhead is, in world units, for a stroke this wide */
  const headLen = (size, scale) => Math.max(9, (size || 2) * 3.4) * (scale || 1);
  /** how far an item's arrowheads can reach past its centreline */
  function headSpan(it) {
    const [h1, h2] = headsOf(it);
    if (h1 === 'none' && h2 === 'none') return 0;
    return headLen(it.size, it.headScale) * 0.75;
  }

  D.Scene = Scene;
  D.isLine = isLine;
  D.isOpenShape = isOpen;
  D.headsOf = headsOf;
  D.headLen = headLen;
  D.curveCtrl = curveCtrl;
  D.arcOf = arcOf;
  D.arcPoint = arcPoint;
  D.pointAlong = pointAlong;
  D.nearestAlong = nearestAlong;
  D.refsOf = refsOf;
  D.geomBox = geomBox;
  D.turnPoints = turnPoints;
  D.rotatesAsBox = rotatesAsBox;
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
    /* `asset` names the stored file (with its `mime`); `src`, a data URL,
       is how pictures were carried before they were assets */
    image: (o) => Object.assign({ id: U.uid(), type: 'image', x: 0, y: 0, w: 0, h: 0, alpha: 1 }, o),
    pdfpage: (o) => Object.assign({ id: U.uid(), type: 'pdfpage', asset: '', page: 1, pages: 1, label: '', x: 0, y: 0, w: 0, h: 0, alpha: 1 }, o)
  };

})(window.DPO);

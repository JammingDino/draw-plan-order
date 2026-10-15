/* ── merge.js ── two copies of one board, changed in two places ───────────
   A board kept in a synced folder (OneDrive, Dropbox, an Obsidian vault)
   can be changed on two machines between syncs. Writing over the other
   copy loses its work, so before a save the desktop app checks that the
   file is still the one it last read; when it is not, the two are merged
   here, item by item, against the copy both started from (`base`):

     changed on one side only      that side's version
     changed the same way on both  that version
     changed differently on both   ours — and theirs is handed back in
                                   `lost`, for the app to keep as a copy
     removed on one side, left     removed
       alone on the other
     removed on one side, changed  the changed one, kept
       on the other
     new on either side            kept

   The same goes for each key of the board's settings (`meta`) and for the
   other keys at the top of the doc. Order follows ours, with what only
   theirs has slotted in after the item it followed there. A connector
   whose end was removed goes too, as removing that end does on the board.

   D.merge.three(base, ours, theirs) → { doc, lost, changed }
     base, ours, theirs   saved docs ({ v, meta?, items, … }); base may be
                          null, when there is no common copy (every item
                          then counts as changed on both sides)
     doc      the merged doc
     lost     theirs' versions of items both sides changed, and theirs' own
              settings where they clashed: { items, meta }
     changed  how many items differ from ours                            */
(function (D) {
  'use strict';

  /* JSON with its keys sorted, so two copies of an item that differ only
     in the order their keys were written compare equal */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    // render caches (`_`-prefixed) are not part of an item
    const keys = Object.keys(v).filter(k => v[k] !== undefined && k.charCodeAt(0) !== 95).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  const same = (a, b) => (a === undefined || b === undefined) ? a === b : canon(a) === canon(b);

  /* one value, three ways: { v, clash } — v undefined means "not there" */
  function pick(b, o, t) {
    if (same(o, t)) return { v: o };
    if (same(o, b)) return { v: t };
    if (same(t, b)) return { v: o };
    // both changed it, differently: ours stands, unless ours removed it
    return o === undefined ? { v: t } : { v: o, clash: true };
  }

  function byId(doc) {
    const m = new Map();
    for (const it of (doc && doc.items) || []) if (it && it.id != null) m.set(it.id, it);
    return m;
  }

  function three(base, ours, theirs) {
    const B = byId(base), O = byId(ours), T = byId(theirs);
    const lost = { items: [], meta: {} };
    const keep = new Map();
    let changed = 0;

    for (const id of new Set([...O.keys(), ...T.keys(), ...B.keys()])) {
      const r = pick(B.get(id), O.get(id), T.get(id));
      if (r.clash) lost.items.push(T.get(id));
      if (r.v !== undefined) keep.set(id, r.v);
      if (!same(r.v, O.get(id))) changed++;
    }

    /* the order: ours, then each item only theirs has, after the one it
       followed in theirs (or at the front, if it led) */
    const order = (ours.items || []).filter(it => keep.has(it.id)).map(it => it.id);
    const placed = new Set(order);
    const tItems = (theirs.items || []);
    for (let i = 0; i < tItems.length; i++) {
      const id = tItems[i].id;
      if (placed.has(id) || !keep.has(id)) continue;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const k = order.indexOf(tItems[j].id);
        if (k >= 0) { at = k + 1; break; }
      }
      order.splice(at, 0, id);
      placed.add(id);
    }

    let items = order.map(id => keep.get(id));
    // a connector can no longer join what is gone
    const there = new Set(order);
    const ends = e => [e.from, e.to].every(p => !p || p.id == null || there.has(p.id));
    const before = items.length;
    items = items.filter(it => it.type !== 'edge' || ends(it));
    changed += before - items.length;

    /* the rest of the doc: each top-level key, and each key of meta */
    const doc = {};
    const keysOf = (...ds) => new Set(ds.flatMap(d => d ? Object.keys(d) : []));
    for (const k of keysOf(ours, theirs, base)) {
      if (k === 'items' || k === 'meta') continue;
      const r = pick(base && base[k], ours[k], theirs[k]);
      if (r.v !== undefined) doc[k] = r.v;
    }
    const bm = (base && base.meta) || {}, om = ours.meta || {}, tm = theirs.meta || {};
    const meta = {};
    for (const k of keysOf(om, tm, bm)) {
      const r = pick(bm[k], om[k], tm[k]);
      if (r.clash) lost.meta[k] = tm[k];
      if (r.v !== undefined) meta[k] = r.v;
    }
    if (Object.keys(meta).length) doc.meta = meta;
    // newer of the two versions, so neither copy of the app upgrades it twice
    doc.v = Math.max(ours.v || 1, theirs.v || 1);
    doc.items = items;
    // v first, then meta, as the scene writes it
    const out = { v: doc.v };
    if (doc.meta) out.meta = doc.meta;
    for (const k in doc) if (!(k in out) && k !== 'items') out[k] = doc[k];
    out.items = items;
    return { doc: out, lost, changed };
  }

  D.merge = { three, canon };

})(window.DPO);

/* ── history.js ── the board as it was ──────────────────────────────────
   "This board as it was yesterday." As a board is saved, a copy of its
   contents is kept now and then — at most every ten minutes of work — and
   thinned out as it ages: every copy from the last hour, one every three
   hours for the last day, one a day for a fortnight, then one a week for
   eight weeks. Board history (the long-press menu on the board, or
   Ctrl+Shift+H) lists them with a picture of each, and either restores
   one over the board — as one step that undo takes back — or opens it as
   a new board beside this one.

   Each copy is the board's contents compressed (gzip, where the browser
   has CompressionStream), kept as an asset of its own, so it lives
   wherever pictures do: IndexedDB in the browser, the boards folder in
   the desktop app. The board keeps the list as `history`:
   [{ at, asset, n }] — when, which asset, and how many items it held.

   D.history.take(app) → Promise   keep a copy now
   D.history.open(app)             the list                              */
(function (D) {
  'use strict';
  const U = D.util;
  const el = (tag, attrs, ...kids) => U.el(tag, attrs, ...kids);

  const EVERY = 10 * 60e3;          // at most one copy per ten minutes of work
  const H = 3600e3, DAY = 24 * H;
  const WEEKS = 8;
  const ICON = 'M4 12a8 8 0 1 0 2.4-5.7|M4 4v4.5h4.5|M12 8v4.5l3 2';

  /* ── keeping copies ───────────────────────────────────────────────── */
  async function pack(bytes) {
    if (typeof CompressionStream !== 'function') return { bytes, type: 'application/json' };
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')));
    return { bytes: new Uint8Array(await out.arrayBuffer()), type: 'application/gzip' };
  }
  async function unpack(bytes, type) {
    if (type !== 'application/gzip') return bytes;
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** which copies to keep: the newest in each stretch of time, finer the nearer it is to now */
  function thin(list, now = Date.now()) {
    const keep = new Map();
    for (const h of list.slice().sort((a, b) => b.at - a.at)) {
      const age = now - h.at;
      const key = age < H ? 'm' + h.at : age < DAY ? 'h' + Math.floor(h.at / (3 * H)) : age < 14 * DAY ? 'd' + Math.floor(h.at / DAY) : 'w' + Math.floor(h.at / (7 * DAY));
      if (!keep.has(key)) keep.set(key, h);
    }
    let weekly = 0;
    return [...keep.entries()].filter(([k]) => k[0] !== 'w' || ++weekly <= WEEKS).map(([, h]) => h).sort((a, b) => a.at - b.at);
  }

  let busy = false;
  async function take(app, force) {
    const board = app.board;
    if (!board || busy || !app.scene.items.length) return;
    const list = Array.isArray(board.history) ? board.history : [];
    const last = list[list.length - 1];
    if (!force && last && Date.now() - last.at < EVERY) return;
    busy = true;
    try {
      const doc = app.scene.docBytes();
      const p = await pack(doc);
      const id = U.uid();
      await D.store.putAsset(id, p.bytes, { name: 'history', type: p.type });
      if (app.board !== board) return;
      const all = [...list, { at: Date.now(), asset: id, n: app.scene.items.length }];
      const kept = thin(all), gone = all.filter(h => !kept.includes(h));
      board.history = kept;
      for (const h of gone) D.store.removeAsset(h.asset).catch(() => { });
      app.markDirty();                     // the list itself is saved with the board
    } catch (err) {
      console.warn('[dpo] history', err);
    } finally { busy = false; }
  }
  D.ext.on('saved', app => { take(app); });

  async function read(app, h) {
    const bytes = await D.store.getAsset(h.asset);
    if (!bytes) throw new Error('that copy is missing');
    const meta = await D.store.assetMeta(h.asset).catch(() => null);
    const raw = await unpack(bytes, (meta && meta.type) || 'application/gzip');
    return JSON.parse(new TextDecoder().decode(raw));
  }

  /** put a copy's contents on the board in place of what is there, as one undo step */
  function restore(app, doc) {
    const was = new D.Scene(doc);           // brought up to this version's format as it loads
    const scene = app.scene;
    scene.begin('restore');
    scene.removeMany(scene.items.slice());
    for (const it of was.items) scene.add(D.clone(it));
    for (const k of new Set([...Object.keys(scene.meta), ...Object.keys(was.meta)])) scene.setMeta(k, was.meta[k] ?? null);
    scene.commit();
    app.select([]);
    app.afterEdit();
  }

  async function openCopy(app, doc, h) {
    const src = app.board;
    const b = D.store.newBoard((src.name || 'Untitled board') + ' (as it was ' + when(h.at) + ')');
    b.doc = doc;
    if (src.assets) b.assets = src.assets.slice();
    await D.store.save(b, true);
    return b;
  }

  /* ── the list ─────────────────────────────────────────────────────── */
  function when(t, now = Date.now()) {
    const d = new Date(t), n = new Date(now);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day(n) - day(d)) / DAY);
    if (now - t < 60e3) return 'just now';
    if (now - t < H) return Math.round((now - t) / 60e3) + ' min ago';
    if (days === 0) return 'today ' + time;
    if (days === 1) return 'yesterday ' + time;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + (days < 7 ? ' ' + time : '');
  }

  let dlg = null;
  function close() { if (dlg) { dlg.preview.clear(); dlg.el.remove(); dlg = null; } }

  async function open(app) {
    close();
    // the board as it stands is a copy too, so the newest change can be compared with it
    await take(app, false);
    const list = (app.board.history || []).slice().reverse();
    const canvas = el('canvas', {}), host = el('div', { class: 'hist-preview' }, canvas);
    const status = el('p', { class: 'hist-status' });
    const restoreB = el('button', { class: 'btn primary', type: 'button', disabled: true }, 'Restore this');
    const copyB = el('button', { class: 'btn', type: 'button', disabled: true }, 'Open as a new board');
    const rows = list.map((h, i) => el('button', { class: 'hist-row', type: 'button', 'data-i': String(i) },
      el('b', {}, when(h.at)), el('span', {}, h.n + (h.n === 1 ? ' item' : ' items'))));
    const box = el('div', { class: 'hist', role: 'dialog', 'aria-label': 'Board history' },
      el('div', { class: 'hist-head' }, el('h3', {}, 'Board history'), el('button', { class: 'icon', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: close }, '✕')),
      el('div', { class: 'hist-body' },
        el('div', { class: 'hist-list' }, rows.length ? rows : el('p', { class: 'hist-status' }, 'No copies yet: one is kept as you work, at most every ten minutes.')),
        el('div', { class: 'hist-side' }, host, status, el('div', { class: 'hist-acts' }, restoreB, copyB))));
    document.body.append(box);
    const preview = new D.BoardPreview(host, canvas, () => restoreB.click());
    dlg = { el: box, preview };
    let picked = null;
    const pick = async i => {
      rows.forEach((r, j) => r.classList.toggle('on', j === i));
      const h = list[i];
      status.textContent = 'Reading…';
      restoreB.disabled = copyB.disabled = true;
      try {
        const doc = await read(app, h);
        if (!dlg) return;
        picked = { h, doc };
        preview.show(new D.Scene(doc), null, id => app.getAsset(id));
        status.textContent = `${when(h.at)} · ${h.n} item${h.n === 1 ? '' : 's'}`;
        restoreB.disabled = copyB.disabled = false;
      } catch (err) { status.textContent = 'Could not read that copy: ' + (err && err.message || err); }
    };
    rows.forEach((r, i) => { r.onclick = () => pick(i); });
    restoreB.onclick = () => {
      if (!picked) return;
      restore(app, picked.doc); close();
      app.toast('Restored the board as it was ' + when(picked.h.at), 'Undo', () => app.undo());
    };
    copyB.onclick = async () => {
      if (!picked) return;
      const b = await openCopy(app, picked.doc, picked.h);
      close();
      app.toast('Made ' + b.name, 'Open it', () => app.openBoard(b.id));
    };
    if (list.length) pick(list.length > 1 ? 1 : 0);     // the copy before the board as it is now
  }

  D.ext.on('key', (app, e) => {
    if (dlg && e.key === 'Escape') { close(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'H' || e.key === 'h')) { e.preventDefault(); open(app); return true; }
    return false;
  });
  D.ext.on('board', () => close());
  D.ext.pressActions.push({ id: 'history', label: 'Board history…', icon: ICON, order: 92,
    when: ctx => ctx.source === 'menu' && !ctx.selection.length, run: ctx => open(ctx.app) });

  D.history = { take, open, close, thin, restore, when };
})(window.DPO);

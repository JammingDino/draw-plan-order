/* ── links.js ── from a thing to a page, or to another board ────────────
   Anything on the board can link to a page on this board or to another
   board: "Link to…" on its long-press menu. A linked thing wears a small
   chain badge at its corner; tap the badge (with the pen, a finger or the
   mouse) to follow it, and the toast that follows has "Back". Links stay
   inside the app: a contents page of a course, a "see the derivation"
   from one board to the next.

   The item keeps `link`: { page: id } or { board: id, name } (the name as
   it was, to show if the board has gone).

   D.links.follow(app, item)                                           */
(function (D) {
  'use strict';
  const U = D.util;
  const el = (tag, attrs, ...kids) => U.el(tag, attrs, ...kids);
  const ICON = 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1|M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1';
  const R = 11;                    // the badge's radius, screen px

  /** where an item's badge sits on screen, or null if the item is too small there to wear one */
  function badgeAt(app, it) {
    const b = app.scene.bbox(it), c = app.camera;
    const a = c.toScreen(b.x, b.y), e = c.toScreen(b.x2, b.y2);
    if (e.x - a.x < 18 && e.y - a.y < 18) return null;
    return { x: e.x + 4, y: a.y - 4 };
  }
  function linkedInView(app) {
    const v = app.camera.viewport(innerWidth, innerHeight, 40);
    return app.scene.near(v).filter(it => it.link);
  }

  /* ── following ────────────────────────────────────────────────────── */
  async function follow(app, it) {
    const L = it.link;
    if (!L) return;
    if (L.page) {
      const f = app.scene.get(L.page);
      if (!f) { app.toast('That page is not on this board any more'); return; }
      const back = { x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom };
      D.frames.go(app, f);
      app.toast('Went to ' + D.frames.nameOf(app.scene, f), 'Back', () => {
        app.camera.x = back.x; app.camera.y = back.y; app.camera.zoom = back.zoom;
        app.requestDraw(); app.requestDrawLive(); if (app.saveView) app.saveView();
      });
      return;
    }
    if (L.board) {
      const list = await D.store.list();
      if (!list.some(b => b.id === L.board)) { app.toast(`The board "${L.name || 'that board'}" is not here any more`); return; }
      const from = app.board.id, fromName = app.board.name;
      await app.openBoard(L.board);
      app.toast('Opened ' + (app.board.name || L.name), 'Back to ' + (fromName || 'the last board'), () => app.openBoard(from));
    }
  }

  /* the badge takes a tap before the tool does */
  D.ext.routes.push((app, e) => {
    if (e.button > 0) return null;
    for (const it of linkedInView(app)) {
      const p = badgeAt(app, it);
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= R + 5) {
        return { down() { }, move() { }, cancel() { }, up() { follow(app, it); } };
      }
    }
    return null;
  });

  D.ext.on('frame', (app, ctx) => {
    const items = linkedInView(app);
    if (!items.length) return;
    ctx.save();
    for (const it of items) {
      const p = badgeAt(app, it);
      if (!p) continue;
      ctx.fillStyle = '#4f6bff';
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
      // a chain link, drawn small and white
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-Math.PI / 4);
      ctx.beginPath(); ctx.roundRect(-6.5, -2.6, 7.5, 5.2, 2.6); ctx.roundRect(-1, -2.6, 7.5, 5.2, 2.6); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  });

  /* ── making one ───────────────────────────────────────────────────── */
  let pop = null;
  function closePop() { if (pop) { pop.el.remove(); removeEventListener('pointerdown', pop.away, true); pop = null; } }

  async function choose(app, it, at) {
    closePop();
    const set = link => {
      app.scene.begin('link'); app.scene.touch(it);
      if (link) it.link = link; else delete it.link;
      app.scene.commit(); app.afterEdit(); closePop();
      app.requestDrawLive();
    };
    const pages = D.frames ? D.frames.sheets(app.scene).filter(f => f !== it) : [];
    const boards = (await D.store.list()).filter(b => b.id !== app.board.id);
    const row = (label, sub, onclick) => el('button', { class: 'links-row', type: 'button', onclick }, el('span', {}, label), sub ? el('small', {}, sub) : null);
    const box = el('div', { class: 'links-pop', role: 'dialog', 'aria-label': 'Link to' },
      el('h4', {}, 'Link to'),
      pages.length ? el('div', { class: 'links-sect' }, el('p', {}, 'A page on this board'),
        ...pages.map((f, i) => row(D.frames.nameOf(app.scene, f), 'page ' + (i + 1), () => set({ page: f.id })))) : null,
      boards.length ? el('div', { class: 'links-sect' }, el('p', {}, 'Another board'),
        ...boards.slice(0, 30).map(b => row(b.name || 'Untitled board', null, () => set({ board: b.id, name: b.name })))) : null,
      !pages.length && !boards.length ? el('p', { class: 'links-none' }, 'There is nothing to link to yet: add a page (F), or make another board.') : null,
      it.link ? el('button', { class: 'btn danger links-rm', type: 'button', onclick: () => set(null) }, 'Remove the link') : null);
    document.body.append(box);
    box.style.left = U.clamp(at.sx - 140, 8, Math.max(8, innerWidth - 300)) + 'px';
    box.style.top = U.clamp(at.sy + 12, 60, Math.max(60, innerHeight - box.offsetHeight - 12)) + 'px';
    pop = { el: box, away: e => { if (!box.contains(e.target)) closePop(); } };
    setTimeout(() => { if (pop && pop.el === box) addEventListener('pointerdown', pop.away, true); }, 0);
  }

  D.ext.pressActions.push(
    { id: 'link-to', label: 'Link to…', icon: ICON, order: 35,
      when: ctx => ctx.source === 'menu' && ctx.selection.length === 1,
      run: ctx => choose(ctx.app, ctx.selection[0], ctx) },
    { id: 'link-follow', label: 'Follow the link', icon: ICON, order: 34,
      when: ctx => ctx.selection.length === 1 && !!ctx.selection[0].link,
      run: ctx => follow(ctx.app, ctx.selection[0]) }
  );
  D.ext.on('key', (app, e) => { if (pop && e.key === 'Escape') { closePop(); return true; } return false; });

  D.links = { follow, choose, badgeAt };
})(window.DPO);

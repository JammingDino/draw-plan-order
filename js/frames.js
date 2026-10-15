/* ── frames.js ── pages on the endless board ──────────────────────────
   A page (a "frame") is a sheet laid on the board: A4, A3, A5, Letter, a
   16:9 slide, or any size dragged out. It is drawn as paper, with a ruling
   of its own if asked for (dots, grid, ruled, or an engineering pad's 5 mm
   squares), and a name above its corner. Pages are what Export → PDF
   prints, one sheet each, in their order on the board; the Pages button in
   the zoom bar lists them, jumps between them and adds more, and Page Up /
   Page Down step through them.

   A page is only picked by its edge or its name, so writing on it, and
   dragging a box or a lasso over it, deal with what is on it, not with
   the page. "Select with contents" picks up the page and everything
   written on it, to move them together.

   ── The item ─────────────────────────────────────────────────────────

   { type: 'frame', x, y, w, h, size, orient, paper, name }
   size    'A4' | 'A3' | 'A5' | 'Letter' | 'Slide' | 'custom'
   orient  'portrait' | 'landscape'   (ignored for custom)
   paper   'plain' | 'dots' | 'grid' | 'ruled' | 'eng'
   name    '' for "Page n", n its place among the pages

   Board units are CSS px at 100%, so an A4 page is 794 × 1123: 96 to the
   inch, as the browser prints.

   ── For other features ───────────────────────────────────────────────

   D.frames.list(scene) → the page tool's pages, in board order
   D.frames.sheets(scene) → every page: those and the pages of imported
     PDFs, in reading order (down the board, left to right along a row)
   D.frames.nameOf(scene, it) → what it is called
   D.frames.pointsOf(it) → its size in PDF points
   D.frames.contentsOf(scene, page) → what is written on it
   D.frames.reorder(app, from, to) → move page `from` to place `to`, the
     pages changing places on the board with what is on them
   D.frames.mm → board units in a millimetre                              */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;

  const MM = 96 / 25.4;
  const SIZES = {
    A5: [148, 210], A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4], Slide: [338.7, 190.5]
  };
  const SIZE_NAMES = [['A4', 'A4'], ['A3', 'A3'], ['A5', 'A5'], ['Letter', 'Letter'], ['Slide', '16:9']];
  const PAPERS = [['plain', 'Plain'], ['dots', 'Dots'], ['grid', 'Grid'], ['ruled', 'Ruled'], ['eng', 'Eng']];
  const GAP = 48;               // between pages laid one after another

  /** a page's size in board units, the right way round */
  function dims(size, orient) {
    const s = SIZES[size] || SIZES.A4;
    let w = Math.round(s[0] * MM), h = Math.round(s[1] * MM);
    // a slide is on its side by nature, whatever the paper sizes are set to
    const land = size === 'Slide' || orient === 'landscape';
    if (land !== w > h) [w, h] = [h, w];
    return { w, h };
  }

  const list = scene => scene.items.filter(it => it.type === 'frame');

  /* The pages of a board: the sheets laid with the page tool and the
     pages of PDFs brought in, one set, in reading order — down the board,
     and left to right along a row — kept until the board next changes. */
  const isSheet = it => it.type === 'frame' || it.type === 'pdfpage';
  let memo = { scene: null, ver: -1, list: [] };
  function sheets(scene) {
    if (memo.scene === scene && memo.ver === scene.version) return memo.list;
    const all = scene.items.filter(isSheet).slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const out = [];
    for (let i = 0; i < all.length;) {
      // a row: everything that starts before the first of it is half way down
      const top = all[i], row = [top];
      let j = i + 1;
      while (j < all.length && all[j].y < top.y + Math.min(top.h, all[j].h) * 0.5) row.push(all[j++]);
      row.sort((a, b) => a.x - b.x);
      out.push(...row);
      i = j;
    }
    memo = { scene, ver: scene.version, list: out };
    return out;
  }
  const numberOf = (scene, it) => sheets(scene).indexOf(it) + 1;
  const nameOf = (scene, it) => it.name || (it.type === 'pdfpage'
    ? `${String(it.label || 'PDF').replace(/\.pdf$/i, '')} · p. ${it.page}`
    : 'Page ' + numberOf(scene, it));
  /** a sheet's size in PDF points: a PDF page's own, else its board size at 96 to the inch */
  function pointsOf(it) {
    if (it.type === 'pdfpage') {
      // brought in before pages were 96 to the inch: one unit was a point
      if (!it.pw) return { w: it.w, h: it.h };
      // as it came in (perhaps shrunk to fit): its own size; resized since, in proportion
      const k = it.w / Math.min(it.pw * 96 / 72, 2000);
      return { w: it.pw * k, h: it.ph * k };
    }
    return { w: it.w * 0.75, h: it.h * 0.75 };
  }
  /** how tall the name over a page is, in board units: in proportion to the page */
  const labelSize = it => U.clamp(Math.min(Math.abs(it.w), Math.abs(it.h)) * 0.022, 10, 60);

  /* ── painting ──────────────────────────────────────────────────── */
  function rulings(ctx, it, ink, zoom) {
    const { x, y, w, h } = it, p = it.paper || 'plain';
    if (p === 'plain') return;
    const hair = 1 / Math.max(zoom, 0.05);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = ctx.fillStyle = ink;
    if (p === 'dots') {
      const s = 5 * MM, r = Math.max(0.9, hair * 0.9);
      ctx.globalAlpha *= 0.35;
      ctx.beginPath();
      for (let yy = y + s; yy < y + h; yy += s) for (let xx = x + s; xx < x + w; xx += s) { ctx.moveTo(xx + r, yy); ctx.arc(xx, yy, r, 0, 6.2832); }
      ctx.fill();
    } else if (p === 'grid' || p === 'eng') {
      const s = 5 * MM, a0 = ctx.globalAlpha;
      // the fine lines fade out as they crowd together, zoomed out, rather than going grey
      const fade = U.clamp((s * zoom - 4) / 8, 0, 1);
      ctx.lineWidth = Math.max(0.5, hair);
      ctx.globalAlpha = a0 * (p === 'eng' ? 0.13 : 0.2) * fade;
      ctx.beginPath();
      if (fade > 0) {
        for (let xx = x + s; xx < x + w - 0.5; xx += s) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
        for (let yy = y + s; yy < y + h - 0.5; yy += s) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
      }
      ctx.stroke();
      if (p === 'eng') {
        // an engineering pad: every fifth line heavier
        ctx.globalAlpha = a0 * 0.22;
        ctx.beginPath();
        for (let xx = x + s * 5; xx < x + w - 0.5; xx += s * 5) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
        for (let yy = y + s * 5; yy < y + h - 0.5; yy += s * 5) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
        ctx.stroke();
      }
    } else if (p === 'ruled') {
      const s = 8 * MM;
      ctx.lineWidth = Math.max(0.6, hair);
      ctx.globalAlpha *= 0.25;
      ctx.beginPath();
      for (let yy = y + s * 2; yy < y + h - s * 0.5; yy += s) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
      ctx.stroke();
      // the margin
      ctx.strokeStyle = '#e25a5a'; ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 2);
      ctx.beginPath(); ctx.moveTo(x + 25 * MM, y); ctx.lineTo(x + 25 * MM, y + h); ctx.stroke();
    }
    ctx.restore();
  }

  function draw(ctx, it, r) {
    const { x, y, w, h } = it;
    const zoom = r.paintZoom || (r.app && r.app.camera ? r.app.camera.zoom : 1);
    const ink = U.color('ink'), paper = U.color('paper');
    const hair = 1 / Math.max(zoom, 0.05);
    const printing = !!r.printing;
    ctx.save();
    // the sheet, with a soft shadow on screen to lift it off the board
    if (!printing) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 14 * Math.min(1, zoom); ctx.shadowOffsetY = 2 * hair;
      ctx.fillStyle = paper; ctx.fillRect(x, y, w, h);
      ctx.restore();
    } else { ctx.fillStyle = paper; ctx.fillRect(x, y, w, h); }
    rulings(ctx, it, ink, zoom);
    if (!printing) {
      ctx.lineWidth = hair;
      ctx.strokeStyle = ink; ctx.globalAlpha *= 0.28;
      ctx.strokeRect(x, y, w, h);
      ctx.globalAlpha /= 0.28;
      // the name, above the top-left corner
      const fs = labelSize(it);
      const scene = r.app && r.app.scene;
      ctx.font = `600 ${fs}px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif`;
      ctx.fillStyle = ink; ctx.globalAlpha *= 0.6;
      ctx.textBaseline = 'alphabetic';
      const label = (scene ? nameOf(scene, it) : it.name || 'Page') + (it.size && it.size !== 'custom' ? '  ·  ' + (it.size === 'Slide' ? '16:9' : it.size) : '');
      ctx.fillText(label, x, y - fs * 0.45);
    }
    ctx.restore();
  }

  function svg(it) {
    const paper = U.color('paper');
    return `<rect x="${U.round(it.x, 2)}" y="${U.round(it.y, 2)}" width="${U.round(it.w, 2)}" height="${U.round(it.h, 2)}" fill="${paper}"/>`;
  }

  /* ── the item ──────────────────────────────────────────────────── */
  D.ext.items.frame = {
    label: 'Page',
    bbox(it) {
      const fs = labelSize(it);
      return { x: it.x, y: it.y - fs * 1.5, w: it.w, h: it.h + fs * 1.5 };
    },
    draw,
    svg,
    // only by its edge, or its name: inside, the pen and the box are for what is written there
    hit(it, x, y, tol) {
      const fs = labelSize(it), band = Math.max(tol * 1.5, 2);
      if (y < it.y && y > it.y - fs * 1.5 && x >= it.x - tol && x <= it.x + Math.max(it.w * 0.5, fs * 8)) return true;
      const inX = x >= it.x - band && x <= it.x + it.w + band, inY = y >= it.y - band && y <= it.y + it.h + band;
      if (!inX || !inY) return false;
      return Math.abs(x - it.x) < band || Math.abs(x - it.x - it.w) < band || Math.abs(y - it.y) < band || Math.abs(y - it.y - it.h) < band;
    },
    outline: it => [it.x, it.y, it.x + it.w, it.y, it.x + it.w, it.y + it.h, it.x, it.y + it.h, it.x, it.y],
    solid: false,
    // a lasso takes a page only when it goes all the way round it
    enclose: true,
    scale(it, o, sx, sy) {
      const x2 = o.x + (it.x + it.w - o.x) * sx, y2 = o.y + (it.y + it.h - o.y) * sy;
      it.x = o.x + (it.x - o.x) * sx; it.y = o.y + (it.y - o.y) * sy;
      it.w = x2 - it.x; it.h = y2 - it.y;
      if (it.w < 0) { it.x += it.w; it.w = -it.w; }
      if (it.h < 0) { it.y += it.h; it.h = -it.h; }
      const d = dims(it.size, it.orient);
      if (it.size !== 'custom' && (Math.abs(d.w - it.w) > 0.5 || Math.abs(d.h - it.h) > 0.5)) it.size = 'custom';
    },
    edit(app, it) { selectWithContents(app, it); },
    panel(ui, items) {
      const app = ui.app, it = items[0], one = items.length === 1;
      const setSize = (size, orient) => ui.apply(items, f => {
        f.size = size; f.orient = orient;
        if (size !== 'custom') { const d = dims(size, orient); f.w = d.w; f.h = d.h; }
      });
      ui.add(
        one ? ui.group('Name', nameField(ui, it)) : ui.group(items.length + ' pages'),
        ui.group('Size', ui.seg(SIZE_NAMES.concat([['custom', 'Own']]), it.size || 'custom', v => setSize(v, it.orient || 'portrait'))),
        it.size !== 'custom' && it.size !== 'Slide' ? ui.group('Turned', ui.seg([['portrait', 'Upright'], ['landscape', 'On its side']], it.orient || 'portrait', v => setSize(it.size, v))) : null,
        ui.group('Paper', ui.seg(PAPERS, it.paper || 'plain', v => ui.apply(items, f => { f.paper = v; }))),
        one ? ui.group('', el('div', { class: 'frames-acts' },
          el('button', { class: 'btn', type: 'button', onclick: () => selectWithContents(app, it) }, 'Select with what is on it'),
          el('button', { class: 'btn', type: 'button', onclick: () => addAfter(app, it) }, 'Add a page after'),
          D.exportPdf ? el('button', { class: 'btn', type: 'button', onclick: () => D.exportPdf(app, { frames: [it] }) }, 'This page as PDF') : null)) : null
      );
    }
  };

  function nameField(ui, it) {
    const app = ui.app;
    const f = el('input', { class: 'frames-name', type: 'text', spellcheck: 'false', placeholder: nameOf(app.scene, it), 'aria-label': 'Page name' });
    f.value = it.name || '';
    if (D.inkmath) U.penField(f, () => D.inkmath.writePad(app, { title: 'Name the page', start: f.value, near: f, use: t => ui.apply([it], x => { x.name = t.trim(); }) }));
    f.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') f.blur(); });
    f.addEventListener('change', () => ui.apply([it], x => { x.name = f.value.trim(); }));
    return f;
  }

  /* ── making pages ──────────────────────────────────────────────── */
  function make(app, at, o = {}) {
    const opt = app.opts.frame;
    const size = o.size || opt.size, orient = o.orient || opt.orient;
    const d = o.w ? { w: o.w, h: o.h } : dims(size, orient);
    return {
      id: U.uid(), type: 'frame', x: at.x, y: at.y, w: d.w, h: d.h,
      size: o.w ? 'custom' : size, orient, paper: o.paper || opt.paper, name: '', alpha: 1
    };
  }
  /** put pages behind everything, after the pages already there, so the reading order follows */
  function place(app, f) {
    const scene = app.scene, pages = list(scene);
    const last = pages.length ? scene.items.indexOf(pages[pages.length - 1]) + 1 : 0;
    scene.add(f, last);
  }
  function addNew(app, f, opts = {}) {
    app.scene.begin('page');
    place(app, f);
    app.scene.commit();
    if (opts.select !== false) { app.setTool('select'); app.select([f]); }
    app.afterEdit();
    return f;
  }
  /** a page like `after`, below it (beside it, for one on its side) */
  function addAfter(app, after) {
    const pages = sheets(app.scene);
    after = after || pages[pages.length - 1];
    // after a PDF page: a blank page the same size, to carry on the working on
    const like = !after ? null : after.type === 'pdfpage' ? { w: after.w, h: after.h, paper: 'plain' }
      : after.size === 'custom' ? { w: after.w, h: after.h, orient: after.orient, paper: after.paper } : { size: after.size, orient: after.orient, paper: after.paper };
    const f = make(app, { x: 0, y: 0 }, like || {});
    if (after) {
      const side = after.w > after.h;
      f.x = side ? after.x + after.w + GAP : after.x;
      f.y = side ? after.y : after.y + after.h + GAP + (after.type === 'frame' ? labelSize(after) * 1.5 : 0);
    } else {
      const c = app.camera.toWorld(innerWidth / 2, innerHeight / 2);
      f.x = c.x - f.w / 2; f.y = c.y - f.h / 2;
    }
    addNew(app, f, { select: false });
    go(app, f);
    return f;
  }

  /** the page and everything whose middle is on it, selected to move as one */
  /** what is written on a page: everything whose middle is on it, other pages aside */
  function contentsOf(scene, f) {
    const box = U.box(f.x, f.y, f.x + f.w, f.y + f.h);
    return scene.near(box).filter(it => {
      if (it === f || isSheet(it)) return false;
      const c = U.boxCenter(scene.bbox(it));
      return U.pointInBox(c.x, c.y, box);
    });
  }

  function selectWithContents(app, f) {
    const on = contentsOf(app.scene, f);
    app.setTool('select');
    app.select([f, ...on]);
  }

  /* ── putting pages in another order ─────────────────────────────────
     The order of the pages is where they are on the board (sheets()), so
     to move page `from` to place `to` the pages change places, each
     taking what is written on it along. Pages all of one size swap into
     each other's spots, so a layout of rows stays rows; pages of mixed
     sizes are stacked down a column from where the first one was, so
     none lands on another. One undo step. */
  function reorder(app, from, to) {
    const scene = app.scene, pages = sheets(scene);
    if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return false;
    const order = pages.slice();
    order.splice(to, 0, order.splice(from, 1)[0]);
    const same = pages.every(p => Math.abs(p.w - pages[0].w) < 0.5 && Math.abs(p.h - pages[0].h) < 0.5);
    const spots = [];
    if (same) for (const p of pages) spots.push({ x: p.x, y: p.y });
    else {
      let y = pages[0].y;
      for (const p of order) { spots.push({ x: pages[0].x, y }); y += p.h + GAP; }
    }
    // what is on each page, worked out before anything moves
    const on = new Map(order.map(p => [p, contentsOf(scene, p)]));
    scene.begin('reorder pages');
    order.forEach((p, i) => {
      const dx = spots[i].x - p.x, dy = spots[i].y - p.y;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
      scene.translate(p, dx, dy);
      for (const it of on.get(p)) if (it.type !== 'edge' || !it.from.id || !it.to.id) scene.translate(it, dx, dy);
    });
    scene.commit();
    app.afterEdit();
    return true;
  }

  /* A page as a picture for the list: the page and what is on it, drawn
     small by the board's own painter (PDF pages as far as they are already
     rendered). */
  function thumb(app, f, W = 46) {
    const c = el('canvas', { class: 'frames-thumb', 'aria-hidden': 'true' });
    const k = W / Math.max(f.w, f.h), w = Math.max(1, Math.round(f.w * k)), h = Math.max(1, Math.round(f.h * k));
    const dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = w * dpr; c.height = h * dpr;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    const ctx = c.getContext && c.getContext('2d');
    if (!ctx || !app.renderer || !app.renderer.drawItems) return c;
    try {
      ctx.setTransform(k * dpr, 0, 0, k * dpr, -f.x * k * dpr, -f.y * k * dpr);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      app.renderer.drawItems(ctx, [f, ...contentsOf(app.scene, f)], k);
    } catch (err) { console.warn('[dpo] page picture', err); }
    return c;
  }

  /* ── moving between pages ──────────────────────────────────────── */
  function go(app, f) {
    const pad = labelSize(f) * 2;
    app.camera.fit(U.box(f.x - pad, f.y - pad * 1.5, f.x + f.w + pad, f.y + f.h + pad), innerWidth, innerHeight);
    app.requestDraw(); if (app.ui) app.ui.refresh(); if (app.saveView) app.saveView();
  }
  /** the page the view is on: the one nearest the middle of the window */
  function current(app) {
    const c = app.camera.toWorld(innerWidth / 2, innerHeight / 2);
    let best = null, bd = Infinity;
    for (const f of sheets(app.scene)) {
      const dx = Math.max(f.x - c.x, 0, c.x - f.x - f.w), dy = Math.max(f.y - c.y, 0, c.y - f.y - f.h);
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  function step(app, by) {
    const pages = sheets(app.scene);
    if (!pages.length) { app.toast('No pages on this board yet: the page tool (F) lays one down, or add a PDF'); return; }
    const now = current(app);
    const c = app.camera.toWorld(innerWidth / 2, innerHeight / 2);
    const inside = now && c.x >= now.x && c.x <= now.x + now.w && c.y >= now.y && c.y <= now.y + now.h;
    let i = pages.indexOf(now);
    // off every page: the nearest is the first step, whichever way
    i = inside ? U.clamp(i + by, 0, pages.length - 1) : i;
    go(app, pages[i]);
  }

  /* the Pages list, from the zoom bar */
  let pop = null;
  function closePages() {
    if (!pop) return;
    pop.el.remove();
    removeEventListener('pointerdown', pop.away, true);
    pop = null;
  }
  function openPages(app) {
    if (pop) { closePages(); return; }
    const pages = sheets(app.scene), now = current(app);
    const kindOf = f => f.type === 'pdfpage' ? 'PDF' : f.size === 'custom' ? 'own size' : f.size === 'Slide' ? '16:9' : f.size + (f.orient === 'landscape' ? ' ⟷' : '');
    const grip = '<svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
    const rows = pages.map((f, i) => el('div', { class: 'frames-row' + (f === now ? ' on' : ''), role: 'button', tabindex: '0', 'data-i': String(i), onclick: () => { closePages(); go(app, f); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closePages(); go(app, f); } } },
      el('b', {}, String(i + 1)), thumb(app, f), el('span', {}, nameOf(app.scene, f)), el('i', {}, kindOf(f)),
      pages.length > 1 ? el('span', { class: 'frames-grip', title: 'Drag to move this page', 'aria-label': 'Move page ' + (i + 1), html: grip }) : null));
    const listEl = pages.length ? el('div', { class: 'frames-list' }, rows) : null;
    if (listEl && pages.length > 1) dragToReorder(app, listEl, rows);
    const box = el('div', { class: 'frames-pop', role: 'dialog', 'aria-label': 'Pages' },
      el('div', { class: 'frames-head' }, el('span', {}, pages.length ? `${pages.length} page${pages.length > 1 ? 's' : ''}` : 'No pages yet'),
        pages.length > 1 ? el('small', {}, 'drag ⋮⋮ to reorder') : null),
      listEl || el('p', { class: 'frames-note' }, 'A page is a sheet on the board: what you print and export to PDF. The page tool (F) lays them down.'),
      el('div', { class: 'frames-acts' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => { closePages(); addAfter(app, null); } }, pages.length ? 'Add a page' : 'Add the first page'),
        D.exportPdf ? el('button', { class: 'btn', type: 'button', onclick: () => { closePages(); D.exportPdf(app); } }, 'Export PDF') : null));
    document.body.appendChild(box);
    const btn = document.getElementById('btn-pages');
    const r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 16, top: innerHeight - 60 };
    box.style.left = Math.max(8, r.left) + 'px';
    box.style.bottom = Math.max(8, innerHeight - r.top + 8) + 'px';
    pop = { el: box, away: e => { if (!box.contains(e.target) && !(btn && btn.contains(e.target))) closePages(); } };
    setTimeout(() => { if (pop && pop.el === box) addEventListener('pointerdown', pop.away, true); }, 0);
  }

  /* Rows dragged by their grip, with a pen, a finger or a mouse: a line
     shows where the page will go, and letting go puts it there. */
  function dragToReorder(app, list, rows) {
    let drag = null;
    const where = y => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) return i;
      }
      return rows.length;
    };
    const mark = el('div', { class: 'frames-drop', hidden: true });
    list.appendChild(mark);
    list.addEventListener('pointerdown', e => {
      const g = e.target.closest && e.target.closest('.frames-grip');
      if (!g) return;
      e.preventDefault(); e.stopPropagation();
      const row = g.closest('.frames-row');
      drag = { id: e.pointerId, from: +row.dataset.i, row, to: null };
      row.classList.add('dragging');
      list.setPointerCapture && list.setPointerCapture(e.pointerId);
    });
    list.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const at = where(e.clientY);
      drag.to = at;
      const lr = list.getBoundingClientRect();
      const ref = at < rows.length ? rows[at].getBoundingClientRect().top : rows[rows.length - 1].getBoundingClientRect().bottom;
      mark.hidden = false;
      mark.style.top = (ref - lr.top + list.scrollTop - 1) + 'px';
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      d.row.classList.remove('dragging'); mark.hidden = true;
      if (e.type === 'pointercancel' || d.to == null) return;
      // a drop below itself lands one higher, once it has left its own place
      const to = d.to > d.from ? d.to - 1 : d.to;
      if (to === d.from) return;
      closePages();
      if (reorder(app, d.from, to)) { openPages(app); app.toast(`Page ${d.from + 1} is now page ${to + 1}`, 'Undo', () => app.undo()); }
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
    // a drag must not also open the page it started on
    list.addEventListener('click', e => { if (e.target.closest && e.target.closest('.frames-grip')) e.stopPropagation(); }, true);
  }

  /* ── the tool ──────────────────────────────────────────────────── */
  /* A tap lays a page of the chosen size with its middle where you
     tapped; a drag draws a page of your own size. */
  class FrameTool {
    constructor(app) { this.app = app; this.a = null; this.b = null; }
    down(ev) { this.a = { x: ev.x, y: ev.y }; this.b = null; }
    move(ev) { if (this.a) { this.b = { x: ev.x, y: ev.y }; this.app.requestDrawLive(); } }
    up() {
      const app = this.app, a = this.a, b = this.b;
      this.a = this.b = null;
      if (!a) return;
      const dragged = b && Math.hypot(b.x - a.x, b.y - a.y) * app.camera.zoom > 12;
      let f;
      if (dragged) f = make(app, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, { w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
      else { f = make(app, a); f.x -= f.w / 2; f.y -= f.h / 2; }
      addNew(app, f);
      app.requestDrawLive();
    }
    cancel() { this.a = this.b = null; }
    paint(r) {
      if (!this.a || !this.b) return;
      const ctx = r.liveWorld(), z = this.app.camera.zoom;
      ctx.save();
      ctx.strokeStyle = r.tokens().accent; ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 4 / z]);
      ctx.strokeRect(Math.min(this.a.x, this.b.x), Math.min(this.a.y, this.b.y), Math.abs(this.b.x - this.a.x), Math.abs(this.b.y - this.a.y));
      ctx.restore();
    }
  }

  const ICON = {
    page: 'M6 3h9l4 4v14H6z|M15 3v4h4|M9 12h7|M9 16h5',
    pages: 'M8 3h8l3 3v12H8z|M5 7v14h11'
  };

  D.ext.opts.frame = { size: 'A4', orient: 'portrait', paper: 'plain' };

  D.ext.tools.push({
    name: 'frame',
    create: app => new FrameTool(app),
    rail: { icon: ICON.page, key: 'f', title: 'Page · F', after: 'calc' },
    panel: ui => {
      const o = ui.app.opts.frame;
      ui.add(
        ui.group('Size', ui.seg(SIZE_NAMES, o.size, v => { o.size = v; ui.app.savePrefs(); })),
        ui.group('Turned', ui.seg([['portrait', 'Upright'], ['landscape', 'On its side']], o.orient, v => { o.orient = v; ui.app.savePrefs(); })),
        ui.group('Paper', ui.seg(PAPERS, o.paper, v => { o.paper = v; ui.app.savePrefs(); })),
        ui.group('', el('div', { class: 'rowlbl' }, el('span', { style: 'line-height:1.5' },
          'Tap for a page, or drag one of your own size. Pages are what Export PDF prints; Page Up and Page Down step through them.'))),
        ui.group('', el('button', { class: 'btn', type: 'button', onclick: () => addAfter(ui.app, null) }, 'Add a page after the last'))
      );
    }
  });

  D.ext.buttons.push({ id: 'btn-pages', icon: ICON.pages, title: 'Pages', where: 'view', onClick: app => openPages(app) });

  D.ext.pressActions.push(
    { id: 'frame-contents', label: 'Select with what is on it', icon: ICON.page, order: 40,
      when: ctx => ctx.selection.length === 1 && ctx.selection[0].type === 'frame', run: ctx => selectWithContents(ctx.app, ctx.selection[0]) },
    { id: 'frame-add', label: 'New page here', icon: ICON.page, order: 64,
      when: ctx => ctx.source === 'menu' && !ctx.selection.length,
      run: ctx => { const f = make(ctx.app, { x: ctx.x, y: ctx.y }); f.x -= f.w / 2; f.y -= f.h / 2; addNew(ctx.app, f); } }
  );

  D.ext.on('key', (app, e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); step(app, e.key === 'PageDown' ? 1 : -1); return true; }
  });
  D.ext.on('board', () => closePages());

  D.frames = { list, sheets, nameOf, numberOf, pointsOf, dims, mm: MM, go, step, current, addAfter, selectWithContents, contentsOf, reorder, make, labelSize };
})(window.DPO);

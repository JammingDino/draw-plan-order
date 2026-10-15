/* ── search.js ── find words on the board ──────────────────────────────
   Ctrl+F, the magnifier in the zoom bar, or "Search the board" on the
   long-press menu opens a bar at the top: type, and every place the words
   appear is found — in text boxes, notes, nodes, connector labels, calc
   blocks and their answers, handwritten answers, part labels, page names,
   graphs' functions, dimensions, and the text of imported PDFs. Enter (or
   ↓) goes to the next, Shift+Enter (or ↑) to the one before, Esc closes.
   The view moves to each in turn, and outlines it; the others in view are
   shaded faintly.

   A PDF's words are read from its text layer (pdf.js getTextContent) the
   first time a search needs them, a page at a time, and kept until the
   board changes. A scanned PDF has no text layer, so it finds nothing.

   D.search.open(app) / close(app)
   D.search.find(app, query) → Promise<[{ item, box, text, at }]>
       box   where the hit is, on the board;  text  what it was found in
       at    where in that text it starts, for a snippet
   D.search.textOf(it) → string   what an item says, for searching
   D.search.pdfWords(app, it) → Promise<[{ str, x, y, w, h }]>
       a PDF page's words, x/y/w/h as fractions of the page; replaceable
       (the tests stand it in)                                            */
(function (D) {
  'use strict';
  const U = D.util, XT = D.ext.items;
  const el = (tag, attrs, ...kids) => U.el(tag, attrs, ...kids);

  /* ── what each item says ─────────────────────────────────────────── */
  function textOf(it) {
    const x = XT[it.type];
    if (x && x.searchText) return x.searchText(it) || '';
    switch (it.type) {
      case 'text': case 'note': case 'node': return it.text || '';
      case 'edge': return it.label || '';
      case 'calc': return [it.text || '', ...(it.res || []).map(r => r && r.t ? r.t : '')].join('\n');
      case 'inkresult': return [it.text || '', it.expr || ''].join('\n');
      case 'symbol': return it.label || '';
      case 'frame': return it.name || '';
      case 'pdfpage': return it.label || '';
      case 'graph': return (it.fns || []).join('\n');
      case 'dim': return it.text || '';
      default: return [it.text, it.label, it.name].filter(s => typeof s === 'string').join('\n');
    }
  }

  /* ── a PDF page's words ──────────────────────────────────────────── */
  const words = new Map();            // asset#page → Promise<[{ str, x, y, w, h }]>
  let wordsFor = null;                // the scene they were read for
  async function pdfWords(app, it) {
    if (!D.pdf || !D.pdf.open || !it.asset) return [];
    const bytes = await app.getAsset(it.asset);
    if (!bytes) return [];
    const doc = await D.pdf.open(it.asset, bytes);
    const page = await doc.getPage(it.page);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const out = [];
    for (const t of tc.items) {
      if (!t.str || !t.str.trim()) continue;
      const [vx, vy] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
      const h = Math.hypot(t.transform[2], t.transform[3]) || t.height || 10;
      out.push({ str: t.str, x: vx / vp.width, y: (vy - h) / vp.height, w: (t.width || 0) / vp.width, h: (h * 1.2) / vp.height });
    }
    return out;
  }
  function wordsOf(app, it) {
    if (wordsFor !== app.scene) { words.clear(); wordsFor = app.scene; }
    const key = it.asset + '#' + it.page;
    if (!words.has(key)) words.set(key, S.pdfWords(app, it).catch(err => { console.warn('[dpo] search: no words for', key, err); return []; }));
    return words.get(key);
  }

  /* ── finding ─────────────────────────────────────────────────────── */
  const fold = s => String(s).toLocaleLowerCase();

  async function find(app, query) {
    const q = fold(query).trim();
    if (!q) return [];
    const scene = app.scene, hits = [];
    for (const it of scene.items) {
      const text = textOf(it);
      const t = fold(text);
      let at = t.indexOf(q);
      if (at >= 0) hits.push({ item: it, box: scene.bbox(it), text, at });
      if (it.type !== 'pdfpage' || it.rot) continue;
      // a PDF page's own words, each hit narrowed to where in its line it falls
      for (const w of await wordsOf(app, it)) {
        const s = fold(w.str);
        for (let k = s.indexOf(q); k >= 0; k = s.indexOf(q, k + q.length)) {
          const a = w.str.length ? k / w.str.length : 0, b = w.str.length ? (k + q.length) / w.str.length : 1;
          const x = it.x + (w.x + w.w * a) * it.w, x2 = it.x + (w.x + w.w * b) * it.w;
          const y = it.y + w.y * it.h, y2 = y + w.h * it.h;
          hits.push({ item: it, box: U.box(x, y, Math.max(x2, x + 2), y2), text: w.str, at: k, pdf: true });
        }
      }
    }
    // reading order: down the board, then across
    hits.sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
    return hits;
  }

  /* ── the bar ─────────────────────────────────────────────────────── */
  const S = { bar: null, field: null, count: null, hits: [], at: -1, seq: 0, app: null, pdfWords, find, textOf };

  function open(app) {
    S.app = app;
    if (!S.bar) build(app);
    S.bar.hidden = false;
    S.field.focus();
    S.field.select();
    if (S.field.value) run(app);
    D.ext.on('frame', paint);
    app.requestDrawLive();
  }

  function close(app) {
    if (!S.bar || S.bar.hidden) return;
    S.bar.hidden = true;
    S.hits = []; S.at = -1;
    D.ext.off('frame', paint);
    if (document.activeElement === S.field) S.field.blur();
    (app || S.app).requestDrawLive();
  }

  function build(app) {
    const field = S.field = el('input', { type: 'search', class: 'search-field', placeholder: 'Search the board', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search the board' });
    const count = S.count = el('span', { class: 'search-count', 'aria-live': 'polite' });
    const btn = (title, d, fn) => el('button', { class: 'icon sm', type: 'button', title, 'aria-label': title, onclick: fn, html: `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>` });
    S.bar = el('div', { id: 'search-bar', class: 'glass', role: 'search' },
      el('span', { class: 'search-glass', html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' }),
      field, count,
      btn('Previous (Shift+Enter)', 'M6 15l6-6 6 6', () => step(app, -1)),
      btn('Next (Enter)', 'M6 9l6 6 6-6', () => step(app, 1)),
      btn('Close (Esc)', 'M6 6l12 12M18 6L6 18', () => close(app)));
    let t = null;
    field.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => run(app), 140); });
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); step(app, e.shiftKey ? -1 : 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(app, 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(app, -1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(app); }
    });
    document.body.append(S.bar);
  }

  async function run(app) {
    const q = S.field.value, seq = ++S.seq;
    if (!q.trim()) { S.hits = []; S.at = -1; S.count.textContent = ''; app.requestDrawLive(); return; }
    const pdfs = app.scene.items.some(it => it.type === 'pdfpage');
    if (pdfs) S.count.textContent = 'Searching…';
    const hits = await find(app, q);
    if (seq !== S.seq) return;                // typed on since: that search will say
    S.hits = hits;
    S.at = -1;
    if (!hits.length) { S.count.textContent = 'Not found'; app.requestDrawLive(); return; }
    // the first at or after the middle of the view, so a search starts where you are
    const mid = app.camera.toWorld(innerWidth / 2, innerHeight / 2);
    const from = hits.findIndex(h => h.box.y + h.box.h / 2 >= mid.y - 1);
    go(app, from >= 0 ? from : 0);
  }

  function step(app, d) {
    if (!S.hits.length) { run(app); return; }
    go(app, (S.at + d + S.hits.length) % S.hits.length);
  }

  /* to a hit: kept at this zoom if it reads there, else zoomed until it does */
  function go(app, i) {
    S.at = i;
    const h = S.hits[i], cam = app.camera, b = h.box;
    S.count.textContent = `${i + 1} of ${S.hits.length}`;
    const onScreen = Math.max(b.w, b.h) * cam.zoom;
    const tooSmall = Math.min(b.h, b.w) * cam.zoom < 8, tooBig = onScreen > Math.min(innerWidth, innerHeight) * 0.8;
    if (tooSmall || tooBig) cam.fit(U.growBox(b, Math.max(b.w, b.h) * 1.5), innerWidth, innerHeight);
    cam.centerOn(b.x + b.w / 2, b.y + b.h / 2, innerWidth, innerHeight);
    app.requestDraw();
    if (app.ui) app.ui.refresh();
    if (app.saveView) app.saveView();
  }

  /* the hits in view: the current one outlined, the rest shaded */
  function paint(app, ctx) {
    if (!S.bar || S.bar.hidden || !S.hits.length) return;
    const cam = app.camera, view = cam.viewport(innerWidth, innerHeight, 40);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f6bed';
    S.hits.forEach((h, i) => {
      if (!U.boxesOverlap(h.box, view)) return;
      const a = cam.toScreen(h.box.x, h.box.y), w = h.box.w * cam.zoom, hh = h.box.h * cam.zoom;
      const pad = 3;
      ctx.save();
      if (i === S.at) {
        ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
        ctx.fillStyle = accent + '22';
        ctx.beginPath(); ctx.roundRect(a.x - pad, a.y - pad, w + pad * 2, hh + pad * 2, 5); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = accent + '1f';
        ctx.beginPath(); ctx.roundRect(a.x - pad, a.y - pad, w + pad * 2, hh + pad * 2, 4); ctx.fill();
      }
      ctx.restore();
    });
  }

  /* ── where it plugs in ───────────────────────────────────────────── */
  D.ext.on('key', (app, e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); open(app); return true; }
    if (e.key === 'F3') { e.preventDefault(); if (!S.bar || S.bar.hidden) open(app); else step(app, e.shiftKey ? -1 : 1); return true; }
    return false;
  });
  D.ext.on('board', app => close(app));
  D.ext.buttons.push({ id: 'btn-search', icon: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z|M16 16l4.5 4.5', title: 'Search the board (Ctrl+F)', where: 'view', onClick: app => open(app) });
  D.ext.pressActions.push({
    id: 'search', label: 'Search the board', icon: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z|M16 16l4.5 4.5', order: 85,
    when: ctx => ctx.source === 'menu' && !ctx.selection.length,
    run: ctx => open(ctx.app)
  });

  S.open = open; S.close = close;
  // wordsOf asks D.search.pdfWords, so a test (or a feature) can stand in for pdf.js
  D.search = S;
})(window.DPO);

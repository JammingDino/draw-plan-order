/* ── exportdlg.js ── export, with a look at it first ────────────────────
   The download button used to make the file and drop it in Downloads in
   one go, so the first look at an export was in another program, and
   finding it meant going to Downloads. Now it opens this: the board as
   it will come out — each sheet of a PDF, or the whole picture for a PNG
   or an SVG, transparent where it will be — with the options that change
   it beside the preview, the file's name, and Save, which asks where it
   should go (App.saveFile).

   What goes in (the area), for any of the three formats:
     Pages        each page on the board a sheet (a PDF's usual way)
     Whole board  everything, with a margin round it
     Selection    what is selected, with the same margin
     On screen    what the window shows now
     Region       a box dragged out on the board: the dialog steps aside
                  while it is drawn (the wheel and a middle-drag still
                  move the board), and remembers it for next time
   and then, by format: a PNG's scale (and so its size in pixels), a
   PDF's paper — the area at its actual size, or fitted to A4, A3 or
   Letter — and how finely its painted parts are painted; the theme and
   background of a PNG or SVG. The choices are kept (Settings → Export),
   all but the area, which starts on pages when there are any.

   The preview is painted the way the export paints (Renderer.paintExport),
   at the preview's size: what changes it changes this. A PDF's pages are
   always light, as they print; its ink and pages are vector in the file,
   where the preview is a picture of them.

   D.exportDialog(app, { format?: 'pdf'|'png'|'svg', frames?, area? })  open it
   D.exportDialog.close()                                                close it
   D.exportDialog.areaBox(app, area, opts) → box | null   (world units)  */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;

  const FORMATS = [['pdf', 'PDF'], ['png', 'PNG'], ['svg', 'SVG']];
  const EXT = { pdf: '.pdf', png: '.png', svg: '.svg' };
  const PAGES_SHOWN = 24;           // a long document previews its first pages, and says how many more
  const AREAS = [['pages', 'Pages'], ['all', 'Whole board'], ['selection', 'Selection'], ['view', 'On screen'], ['region', 'Region']];
  const MARGINS = [[0, 'None'], [24, 'S'], [48, 'M'], [96, 'L']];
  const SCALES = [[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']];
  const PAPERS = [['actual', 'Actual size'], ['a4', 'A4'], ['a3', 'A3'], ['letter', 'Letter']];
  const DPIS = [[150, '150'], [200, '200'], [300, '300']];
  const BIG_PX = 60e6;              // past this many pixels a PNG says it will take a while
  const MM = 25.4 / 96;             // mm in a board unit (a CSS px)

  let open = null;

  function close() {
    if (!open) return;
    const o = open;
    open = null;
    o.token++;
    if (o.unpick) o.unpick();
    o.el.remove(); o.scrim.remove();
    removeEventListener('keydown', o.key, true);
    // the renders of PDF pages made for the preview
    for (const kept of o.kept.values()) for (const bmp of kept.values()) if (bmp && bmp.width) { bmp.width = 0; bmp.height = 0; }
  }

  /**
   * The part of the board an area stands for, in world units, or null if
   * there is none (nothing selected, no region drawn yet). 'pages' has no
   * one box: its sheets are the pages.
   */
  function areaBox(app, area, { margin = 48, region = null } = {}) {
    const scene = app.scene;
    if (area === 'all') { const b = scene.contentBounds(); return b && U.growBox(b, margin); }
    if (area === 'selection') { const b = app.selection.length ? app.selectionBounds() : null; return b && U.growBox(b, margin); }
    if (area === 'view') {
      const st = document.getElementById('stage'), r = st && st.getBoundingClientRect ? st.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      const a = app.camera.toWorld(r.left, r.top), c = app.camera.toWorld(r.left + r.width, r.top + r.height);
      return U.box(a.x, a.y, c.x, c.y);
    }
    if (area === 'region') return region && region.w > 0 && region.h > 0 ? region : null;
    return null;
  }

  /**
   * Drag out a region of the board. The board is under a veil that takes
   * the drag; the wheel, a middle-drag and a right-drag still move it, so
   * a region bigger than the window can be framed first. Resolves with the
   * box in world units, or null if it was let go of.
   */
  function pickRegion(app, st) {
    return new Promise(done => {
      const rect = el('div', { class: 'xd-pick-rect', hidden: true });
      const veil = el('div', { class: 'xd-pick' }, rect);
      const hint = el('div', { class: 'xd-pick-hint glass' },
        el('span', {}, 'Drag over the part of the board to export'),
        el('span', { class: 'xd-pick-sub' }, 'Wheel or middle-drag to move the board · Esc to go back'),
        el('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'Back'));
      document.body.append(veil, hint);
      let from = null, pan = null;
      const finish = box => {
        st.unpick = null;
        st.pickKey = null;
        veil.remove(); hint.remove();
        done(box);
      };
      st.unpick = () => finish(null);
      st.pickKey = e => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
      veil.addEventListener('pointerdown', e => {
        e.preventDefault();
        try { veil.setPointerCapture(e.pointerId); } catch (_) { }
        if (e.button === 1 || e.button === 2) { pan = { x: e.clientX, y: e.clientY }; veil.classList.add('panning'); return; }
        from = { x: e.clientX, y: e.clientY };
        Object.assign(rect.style, { left: from.x + 'px', top: from.y + 'px', width: '0px', height: '0px' });
        rect.hidden = false;
      });
      veil.addEventListener('pointermove', e => {
        if (pan) { app.panScreen(e.clientX - pan.x, e.clientY - pan.y); pan = { x: e.clientX, y: e.clientY }; return; }
        if (!from) return;
        Object.assign(rect.style, {
          left: Math.min(from.x, e.clientX) + 'px', top: Math.min(from.y, e.clientY) + 'px',
          width: Math.abs(e.clientX - from.x) + 'px', height: Math.abs(e.clientY - from.y) + 'px'
        });
      });
      const up = e => {
        if (pan) { pan = null; veil.classList.remove('panning'); if (app.saveViewDebounced) app.saveViewDebounced(); return; }
        if (!from) return;
        const a = from;
        from = null;
        if (Math.abs(e.clientX - a.x) < 8 || Math.abs(e.clientY - a.y) < 8) { rect.hidden = true; return; }   // a tap: try again
        const p = app.camera.toWorld(Math.min(a.x, e.clientX), Math.min(a.y, e.clientY));
        const q = app.camera.toWorld(Math.max(a.x, e.clientX), Math.max(a.y, e.clientY));
        finish(U.box(p.x, p.y, q.x, q.y));
      };
      veil.addEventListener('pointerup', up);
      veil.addEventListener('pointercancel', () => { from = pan = null; rect.hidden = true; });
      veil.addEventListener('contextmenu', e => e.preventDefault());
      veil.addEventListener('wheel', e => app.onWheel(e), { passive: false });
    });
  }

  function exportDialog(app, opts = {}) {
    close();
    if (!app.scene.contentBounds()) { app.toast('Nothing to export'); return null; }
    const o = app.opts.export, save = () => app.savePrefs();
    const hasPages = () => !!(D.exportPdf && D.frames && D.frames.sheets(app.scene).length);
    const st = {
      format: FORMATS.some(f => f[0] === opts.format) ? opts.format : 'pdf',
      frames: opts.frames || null, token: 0, kept: new Map(), el: null, scrim: null, key: null, named: false,
      area: opts.area || (opts.frames ? 'pages' : 'auto'), region: app._exportRegion || null, unpick: null, pickKey: null
    };
    /* the area as it stands for this format: pages are a PDF's alone, and
       'auto' is pages when there are some, else the whole board */
    const area = () => {
      let a = st.area;
      if (a === 'auto') a = st.format === 'pdf' && hasPages() ? 'pages' : 'all';
      if (a === 'pages' && (st.format !== 'pdf' || !(st.frames || hasPages()))) a = 'all';
      if (a === 'selection' && !app.selection.length) a = 'all';
      return a;
    };
    const margin = () => o.margin ?? 48;
    const boxNow = () => areaBox(app, area(), { margin: margin(), region: st.region });
    const scale = () => o.scale || 2;

    const fmtSeg = el('div', { class: 'seg xd-formats', role: 'tablist', 'aria-label': 'Format' });
    const preview = el('div', { class: 'xd-preview' });
    const info = el('p', { class: 'xd-info', 'aria-live': 'polite' });
    const look = el('div', { class: 'xd-look' });
    const name = el('input', { class: 'xd-name', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'File name' });
    const where = typeof self.showSaveFilePicker === 'function' && o.ask !== false;
    const saveB = el('button', { class: 'btn primary', type: 'button' }, where ? 'Save…' : 'Download');
    const cancelB = el('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Cancel');
    const box = el('section', { class: 'xd', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export' },
      el('header', { class: 'xd-head' },
        el('h2', {}, 'Export'), fmtSeg,
        el('button', { class: 'icon', type: 'button', title: 'Close', 'aria-label': 'Close', onclick: () => close(),
          html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>' })),
      el('div', { class: 'xd-body' },
        preview,
        el('aside', { class: 'xd-side' },
          look, info,
          el('label', { class: 'xd-field' }, el('span', {}, 'File name'), name),
          el('p', { class: 'xd-where' }, where ? 'Save asks where to put it.' : 'It goes to your Downloads folder.' + (typeof self.showSaveFilePicker === 'function' ? ' (Settings → Export → Ask where to save)' : '')),
          el('div', { class: 'xd-acts' }, cancelB, saveB))));
    const scrim = el('div', { class: 'xd-scrim', onclick: () => close() });
    document.body.append(scrim, box);
    st.el = box; st.scrim = scrim;
    // the board's keys stay with the board: nothing typed here reaches it
    st.key = e => {
      if (st.pickKey) { st.pickKey(e); e.stopPropagation(); return; }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && e.target === name) { e.preventDefault(); saveB.click(); }
      e.stopPropagation();
    };
    addEventListener('keydown', st.key, true);
    open = st;

    const fileName = () => {
      if (st.format === 'pdf' && area() === 'pages' && D.exportPdf && D.exportPdf.fileName) return D.exportPdf.fileName(app, st.frames);
      return (D.safeName ? D.safeName(app.board.name) : app.board.name || 'board') + EXT[st.format];
    };
    /* the name follows the format until it is typed in, and then keeps
       what was typed with the right ending */
    const setName = () => {
      if (!st.named) { name.value = fileName(); return; }
      name.value = name.value.replace(/\.(pdf|png|svg)$/i, '') + EXT[st.format];
    };
    name.addEventListener('input', () => { st.named = true; });

    const changed = () => { setName(); drawLook(); render(); };
    const drawFormats = () => {
      fmtSeg.replaceChildren(...FORMATS.map(([k, label]) => el('button', {
        class: k === st.format ? 'on' : '', type: 'button', role: 'tab', 'aria-selected': String(k === st.format),
        onclick: () => { if (st.format === k) return; st.format = k; drawFormats(); changed(); }
      }, label)));
    };
    const seg = (options, current, pick, cls = '') => {
      const wrap = el('div', { class: 'seg ' + cls });
      for (const [v, label, title, off] of options) {
        const b = el('button', { class: current === v ? 'on' : '', type: 'button', title: title || '' }, label);
        b.disabled = !!off;
        b.onclick = () => { for (const x of wrap.children) x.classList.toggle('on', x === b); pick(v); };
        wrap.append(b);
      }
      return wrap;
    };
    const row = (label, ...control) => el('div', { class: 'xd-row' }, el('span', {}, label), ...control);

    /** drag out a region, with the dialog out of the way */
    const pick = async () => {
      box.hidden = scrim.hidden = true;
      const b = await pickRegion(app, st);
      if (open !== st) return;
      box.hidden = scrim.hidden = false;
      if (b) { st.region = app._exportRegion = b; st.area = 'region'; }
      else if (!st.region && st.area === 'region') st.area = 'all';
      changed();
    };

    const drawLook = () => {
      const a = area(), pdf = st.format === 'pdf';
      const areas = AREAS.filter(([k]) => k !== 'pages' || (pdf && (st.frames || hasPages())))
        .map(([k, label]) => k === 'selection' && !app.selection.length ? [k, label, 'Select something first', true] : [k, label]);
      const areaSeg = seg(areas, a, v => {
        if (v === 'region' && !st.region) { pick(); return; }
        st.area = v; changed();
      }, 'xd-areas');
      const parts = [row('What to export', areaSeg)];
      if (a === 'region') {
        const b = st.region;
        parts.push(el('div', { class: 'xd-region' },
          el('span', {}, `${Math.round(b.w * MM)} × ${Math.round(b.h * MM)} mm of the board`),
          el('button', { class: 'btn', type: 'button', onclick: () => pick() }, 'Draw again')));
      }
      if (a === 'all' || a === 'selection') parts.push(row('Margin', seg(MARGINS, margin(), v => { o.margin = v; save(); changed(); })));
      if (pdf) {
        if (a !== 'pages') parts.push(row('Paper', seg(PAPERS, PAPERS.some(p => p[0] === o.paper) ? o.paper : 'actual', v => { o.paper = v; save(); changed(); })));
        parts.push(row('Pictures and text boxes, painted at', seg(DPIS.map(([v, l]) => [v, l + ' dpi']), o.dpi || 200, v => { o.dpi = v; save(); render(); })));
        parts.push(el('p', { class: 'xd-note' }, 'Light pages, as they print. Imported PDF pages and ink stay vector: sharp at any zoom, and the words in a PDF stay searchable.'));
      } else {
        if (st.format === 'png') parts.push(row('Scale', seg(SCALES.map(([v, l]) => [v, l, `${+v * 96} dpi at the board’s size`]), scale(), v => { o.scale = v; save(); render(); })));
        parts.push(
          row('Theme', seg([['auto', 'Match the app'], ['light', 'Light'], ['dark', 'Dark']], o.theme, v => { o.theme = v; save(); render(); })),
          row('Background', seg([['transparent', 'Transparent'], ['paper', 'Paper colour']], o.background, v => { o.background = v; save(); render(); })));
      }
      look.replaceChildren(...parts);
    };

    /* ── the preview ───────────────────────────────────────────────── */
    const keptFor = dark => {
      const k = st.format + (dark ? ':dark' : ':light');
      if (!st.kept.has(k)) st.kept.set(k, new Map());
      return st.kept.get(k);
    };
    const room = () => {
      const r = preview.getBoundingClientRect ? preview.getBoundingClientRect() : null;
      return { w: Math.max(200, ((r && r.width) || 560) - 28), h: Math.max(160, ((r && r.height) || 400) - 28) };
    };
    const dpr = () => Math.min(self.devicePixelRatio || 1, 2);

    /** paint the box `b` of the board (world units) on a new canvas fitted to w × h css px; nothing past `clip`, if given */
    const paintBox = async (b, w, h, lk, items, token, clip) => {
      const s = Math.min(w / b.w, h / b.h, 2), k = s * dpr();
      const c = el('canvas', { class: 'xd-canvas' });
      c.width = Math.max(1, Math.round(b.w * k)); c.height = Math.max(1, Math.round(b.h * k));
      c.style.width = Math.max(1, Math.round(b.w * s)) + 'px'; c.style.height = Math.max(1, Math.round(b.h * s)) + 'px';
      const ctx = c.getContext('2d');
      if (!lk.transparent) { ctx.fillStyle = lk.paper || U.paintAs(lk.theme, () => U.color('paper')); ctx.fillRect(0, 0, c.width, c.height); }
      ctx.setTransform(k, 0, 0, k, -b.x * k, -b.y * k);
      if (clip) { ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip(); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      await app.renderer.paintExport(ctx, items, k, lk, keptFor(lk.dark));
      return token === st.token ? c : null;
    };
    const within = b => app.scene.items.filter(it => U.boxesOverlap(app.scene.bbox(it), b));
    const mm = v => Math.round(v * MM);

    const render = async () => {
      const token = ++st.token, scene = app.scene, a = area();
      preview.classList.toggle('pages', st.format === 'pdf');
      saveB.disabled = false;
      try {
        if (st.format === 'pdf') {
          const b = a === 'pages' ? null : boxNow();
          const sheets = !D.exportPdf ? [] : a === 'pages' ? D.exportPdf.plan(scene, st.frames) : b ? D.exportPdf.plan(scene, null, { box: b, paper: o.paper }) : [];
          if (!sheets.length) { preview.replaceChildren(el('p', { class: 'xd-empty' }, 'Nothing to put on a page')); info.textContent = ''; saveB.disabled = true; return; }
          if (a === 'pages') info.textContent = sheets.length === 1 ? 'One page' : `${sheets.length} pages`;
          else {
            const sh = sheets[0], paper = PAPERS.find(p => p[0] === o.paper && p[0] !== 'actual');
            info.textContent = paper
              ? `One page, ${paper[1]} ${sh.pt.w > sh.pt.h ? 'landscape' : 'portrait'} — the area scaled to fit`
              : `One page, ${mm(sh.w)} × ${mm(sh.h)} mm — the board at its actual size`;
          }
          const r = room(), H = Math.min(r.h - 24, a === 'pages' ? 340 : r.h - 24), lk = { theme: 'light', dark: false, transparent: false, paper: '#ffffff' };
          const list = el('div', { class: 'xd-pages' });
          preview.replaceChildren(list);
          for (let i = 0; i < sheets.length && i < PAGES_SHOWN; i++) {
            const sh = sheets[i], sb = U.box(sh.x, sh.y, sh.x + sh.w, sh.y + sh.h);
            app.renderer.printing = true;
            let c;
            try { c = await paintBox(sb, Math.min(r.w, H * 1.6), H, lk, within(sh.clip || sb), token, sh.clip); } finally { app.renderer.printing = false; }
            if (!c) return;
            list.append(el('figure', { class: 'xd-page' }, c, el('figcaption', {}, sheets.length > 1 ? `Page ${i + 1}` : '')));
          }
          if (sheets.length > PAGES_SHOWN) list.append(el('p', { class: 'xd-more' }, `and ${sheets.length - PAGES_SHOWN} more`));
          return;
        }
        const lk = app.exportLook(), b = boxNow();
        if (!b) { preview.replaceChildren(el('p', { class: 'xd-empty' }, 'Nothing to export here')); info.textContent = ''; saveB.disabled = true; return; }
        if (st.format === 'png') {
          const k = scale(), W = Math.round(b.w * k), H = Math.round(b.h * k);
          info.textContent = `${W.toLocaleString()} × ${H.toLocaleString()} px — ${k}×, ${k * 96} dpi at the board’s size` +
            (W * H > BIG_PX ? '. A big picture: it may take a while' : '');
        } else info.textContent = `${Math.round(b.w).toLocaleString()} × ${Math.round(b.h).toLocaleString()}, vector — any size without blurring`;
        const r = room();
        preview.replaceChildren(el('p', { class: 'xd-empty' }, 'Drawing the preview…'));
        const c = await paintBox(b, r.w, r.h, lk, within(b), token);
        if (!c) return;
        const frame = el('div', { class: 'xd-sheet' + (lk.transparent ? ' clear' : '') }, c);
        preview.replaceChildren(frame);
      } catch (err) {
        console.error('[dpo] export preview', err);
        if (token === st.token) preview.replaceChildren(el('p', { class: 'xd-empty' }, 'The preview could not be drawn — the export may still work'));
      }
    };

    saveB.onclick = async () => {
      let file = name.value.trim().replace(/[\\/:*?"<>|]+/g, '-') || fileName();
      if (!file.toLowerCase().endsWith(EXT[st.format])) file += EXT[st.format];
      const kind = st.format, a = area(), frames = a === 'pages' ? st.frames : null, b = a === 'pages' ? null : boxNow();
      if (a !== 'pages' && !b) return;
      const make = kind === 'png' ? () => app.pngBlob({ box: b, scale: scale() })
        : kind === 'svg' ? () => app.svgBlob(undefined, b)
          : async () => {
            const bytes = await D.exportPdf(app, { frames, box: b, paper: o.paper, dpi: o.dpi, download: false });
            return bytes ? new Blob([bytes], { type: 'application/pdf' }) : null;
          };
      saveB.disabled = true;
      const label = saveB.textContent;
      saveB.textContent = 'Saving…';
      // asks where first (inside this click), then makes the file
      const done = await app.saveFile(file, kind, make);
      if (!open || open !== st) return;
      if (done) close();
      else { saveB.disabled = false; saveB.textContent = label; }
    };

    drawFormats(); setName(); drawLook();
    requestAnimationFrame(() => { if (open === st) render(); });
    return { el: box, render, close, pick, get format() { return st.format; }, get area() { return area(); } };
  }

  exportDialog.close = close;
  exportDialog.areaBox = areaBox;
  D.exportDialog = exportDialog;
})(window.DPO);

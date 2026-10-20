/* ── exportdlg.js ── export, with a look at it first ────────────────────
   The download button used to make the file and drop it in Downloads in
   one go, so the first look at an export was in another program, and
   finding it meant going to Downloads. Now it opens this: the board as
   it will come out — each sheet of a PDF, or the whole picture for a PNG
   or an SVG, transparent where it will be — with the options that change
   it beside the preview (the same ones as Settings → Export), the file's
   name, and Save, which asks where it should go (App.saveFile).

   The preview is painted the way the export paints (Renderer.paintExport),
   at the preview's size: what changes it changes this. A PDF's pages are
   always light, as they print; its ink and pages are vector in the file,
   where the preview is a picture of them.

   D.exportDialog(app, { format?: 'pdf'|'png'|'svg', frames? })  open it
   D.exportDialog.close()                                          close it */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;

  const FORMATS = [['pdf', 'PDF'], ['png', 'PNG'], ['svg', 'SVG']];
  const EXT = { pdf: '.pdf', png: '.png', svg: '.svg' };
  const PAGES_SHOWN = 24;           // a long document previews its first pages, and says how many more
  const PNG_PAD = 48;               // as App.paintPNG pads the board
  const SVG_PAD = 40;               // and Renderer.toSVG

  let open = null;

  function close() {
    if (!open) return;
    const o = open;
    open = null;
    o.token++;
    o.el.remove(); o.scrim.remove();
    removeEventListener('keydown', o.key, true);
    // the renders of PDF pages made for the preview
    for (const kept of o.kept.values()) for (const bmp of kept.values()) if (bmp && bmp.width) { bmp.width = 0; bmp.height = 0; }
  }

  function exportDialog(app, opts = {}) {
    close();
    if (!app.scene.contentBounds()) { app.toast('Nothing to export'); return null; }
    const o = app.opts.export, save = () => app.savePrefs();
    const st = {
      format: FORMATS.some(f => f[0] === opts.format) ? opts.format : 'pdf',
      frames: opts.frames || null, token: 0, kept: new Map(), el: null, scrim: null, key: null, named: false
    };

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
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && e.target === name) { e.preventDefault(); saveB.click(); }
      e.stopPropagation();
    };
    addEventListener('keydown', st.key, true);
    open = st;

    const fileName = () => {
      if (st.format === 'pdf' && D.exportPdf && D.exportPdf.fileName) return D.exportPdf.fileName(app, st.frames);
      return (D.safeName ? D.safeName(app.board.name) : app.board.name || 'board') + EXT[st.format];
    };
    /* the name follows the format until it is typed in, and then keeps
       what was typed with the right ending */
    const setName = () => {
      if (!st.named) { name.value = fileName(); return; }
      name.value = name.value.replace(/\.(pdf|png|svg)$/i, '') + EXT[st.format];
    };
    name.addEventListener('input', () => { st.named = true; });

    const drawFormats = () => {
      fmtSeg.replaceChildren(...FORMATS.map(([k, label]) => el('button', {
        class: k === st.format ? 'on' : '', type: 'button', role: 'tab', 'aria-selected': String(k === st.format),
        onclick: () => { if (st.format === k) return; st.format = k; drawFormats(); setName(); drawLook(); render(); }
      }, label)));
    };
    const seg = (options, current, pick) => {
      const wrap = el('div', { class: 'seg' });
      for (const [v, label] of options) {
        const b = el('button', { class: current === v ? 'on' : '', type: 'button' }, label);
        b.onclick = () => { for (const x of wrap.children) x.classList.toggle('on', x === b); pick(v); };
        wrap.append(b);
      }
      return wrap;
    };
    const row = (label, control) => el('div', { class: 'xd-row' }, el('span', {}, label), control);
    const drawLook = () => {
      if (st.format === 'pdf') {
        look.replaceChildren(el('p', { class: 'xd-note' }, 'Light pages, as they print. Imported PDF pages and ink stay vector: sharp at any zoom, and the words in a PDF stay searchable.'));
        return;
      }
      look.replaceChildren(
        row('Theme', seg([['auto', 'Match the app'], ['light', 'Light'], ['dark', 'Dark']], o.theme, v => { o.theme = v; save(); render(); })),
        row('Background', seg([['transparent', 'Transparent'], ['paper', 'Paper colour']], o.background, v => { o.background = v; save(); render(); })));
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

    /** paint the box `b` of the board (world units) on a new canvas fitted to w × h css px */
    const paintBox = async (b, w, h, lk, items, token) => {
      const s = Math.min(w / b.w, h / b.h, 2), k = s * dpr();
      const c = el('canvas', { class: 'xd-canvas' });
      c.width = Math.max(1, Math.round(b.w * k)); c.height = Math.max(1, Math.round(b.h * k));
      c.style.width = Math.max(1, Math.round(b.w * s)) + 'px'; c.style.height = Math.max(1, Math.round(b.h * s)) + 'px';
      const ctx = c.getContext('2d');
      if (!lk.transparent) { ctx.fillStyle = lk.paper || U.paintAs(lk.theme, () => U.color('paper')); ctx.fillRect(0, 0, c.width, c.height); }
      ctx.setTransform(k, 0, 0, k, -b.x * k, -b.y * k);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      await app.renderer.paintExport(ctx, items, k, lk, keptFor(lk.dark));
      return token === st.token ? c : null;
    };

    const render = async () => {
      const token = ++st.token, scene = app.scene;
      preview.classList.toggle('pages', st.format === 'pdf');
      saveB.disabled = false;
      try {
        if (st.format === 'pdf') {
          const sheets = D.exportPdf ? D.exportPdf.plan(scene, st.frames) : [];
          if (!sheets.length) { preview.replaceChildren(el('p', { class: 'xd-empty' }, 'Nothing to put on a page')); info.textContent = ''; saveB.disabled = true; return; }
          info.textContent = sheets.length === 1 ? 'One page' : `${sheets.length} pages`;
          const r = room(), H = Math.min(r.h - 24, 340), lk = { theme: 'light', dark: false, transparent: false, paper: '#ffffff' };
          const list = el('div', { class: 'xd-pages' });
          preview.replaceChildren(list);
          for (let i = 0; i < sheets.length && i < PAGES_SHOWN; i++) {
            const sh = sheets[i], b = U.box(sh.x, sh.y, sh.x + sh.w, sh.y + sh.h);
            const items = scene.items.filter(it => U.boxesOverlap(scene.bbox(it), b));
            app.renderer.printing = true;
            let c;
            try { c = await paintBox(b, Math.min(r.w, H * 1.6), H, lk, items, token); } finally { app.renderer.printing = false; }
            if (!c) return;
            list.append(el('figure', { class: 'xd-page' }, c, el('figcaption', {}, sheets.length > 1 ? `Page ${i + 1}` : '')));
          }
          if (sheets.length > PAGES_SHOWN) list.append(el('p', { class: 'xd-more' }, `and ${sheets.length - PAGES_SHOWN} more`));
          return;
        }
        const lk = app.exportLook(), cb = scene.contentBounds();
        if (!cb) { preview.replaceChildren(); return; }
        const pad = st.format === 'png' ? PNG_PAD : SVG_PAD, b = U.growBox(cb, pad);
        info.textContent = st.format === 'png'
          ? `${Math.round(b.w * 2).toLocaleString()} × ${Math.round(b.h * 2).toLocaleString()} px, at twice the board’s size`
          : `${Math.round(b.w).toLocaleString()} × ${Math.round(b.h).toLocaleString()}, vector — any size without blurring`;
        const r = room();
        preview.replaceChildren(el('p', { class: 'xd-empty' }, 'Drawing the preview…'));
        const c = await paintBox(b, r.w, r.h, lk, scene.items, token);
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
      const kind = st.format, frames = st.frames;
      const make = kind === 'png' ? () => app.pngBlob()
        : kind === 'svg' ? () => app.svgBlob()
          : async () => {
            const bytes = await D.exportPdf(app, { frames, download: false });
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
    return { el: box, render, close, get format() { return st.format; } };
  }

  exportDialog.close = close;
  D.exportDialog = exportDialog;
})(window.DPO);

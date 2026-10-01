/* ── ui.js ── tool rail, contextual style panel, sheets, toasts ───── */
(function (D) {
  'use strict';
  const U = D.util, el = U.el, $ = U.$;

  const svg = d => `<svg viewBox="0 0 24 24">${d.split('|').map(p => `<path d="${p}"/>`).join('')}</svg>`;

  const ICON = {
    select: svg('M5.5 3.2l13 7.6-5.9 1.7-2.6 5.6z'),
    lasso: svg('M12 4.6c4.1 0 7.5 2 7.5 4.5s-3.4 4.5-7.5 4.5-7.5-2-7.5-4.5S7.9 4.6 12 4.6z|M9.4 13.4c-.7 2 0 3.4 1.4 4.1|M10.9 17.5a1.4 1.4 0 1 1-1.5 2.2 1.4 1.4 0 0 1 1.5-2.2z'),
    pen: svg('M4 20l4.5-1.2L20 7.3a2 2 0 0 0 0-2.8l-.5-.5a2 2 0 0 0-2.8 0L5.2 15.5z|M14.5 6.5l3 3'),
    highlighter: svg('M14.9 3.7l5.4 5.4-7.7 7.7H8.9l-2.3-2.3z|M12.6 6l5.4 5.4|M4 20.4h16'),
    eraser: svg('M8.6 20.4h11.8|M18.7 12.8l-7.6 7.6H7.4l-3.9-3.9a1.6 1.6 0 0 1 0-2.3l8.2-8.2a1.6 1.6 0 0 1 2.3 0l4.7 4.7a1.6 1.6 0 0 1 0 2.3z|M8.3 8.5l7 7'),
    shape: svg('M3.6 4.4h10.2v10.2H3.6z|M15.4 20.4a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'),
    rect: svg('M4 5h16v14H4z'),
    ellipse: svg('M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z'),
    line: svg('M5 19L19 5'),
    arrow: svg('M5 19L19 5|M13 5h6v6'),
    diamond: svg('M12 3l9 9-9 9-9-9z'),
    triangle: svg('M12 4l8 15H4z'),
    text: svg('M5 6V4h14v2|M12 4v16|M9 20h6'),
    note: svg('M5 4h14v10l-5 6H5z|M19 14h-5v6'),
    node: svg('M9 3.2h6v4.4H9z|M2.6 16h5v4.4h-5z|M16.4 16h5v4.4h-5z|M12 7.6v2.9|M5.1 16v-5.5h13.8V16'),
    connector: svg('M4.4 19a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z|M6 17.4h6.4a3.6 3.6 0 0 0 3.6-3.6V7.4|M13 10.4l3-3 3 3'),
    laser: svg('M12 13.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z|M8.6 15.4a4.8 4.8 0 0 1 0-6.8|M15.4 8.6a4.8 4.8 0 0 1 0 6.8|M5.6 18.4a9 9 0 0 1 0-12.8|M18.4 5.6a9 9 0 0 1 0 12.8'),
    hand: svg('M8 13V6a1.5 1.5 0 0 1 3 0v5|M11 11V4.8a1.5 1.5 0 0 1 3 0V11|M14 11V6.3a1.5 1.5 0 0 1 3 0V13c0 4-2.4 7-6 7s-6-2.6-6-6v-3a1.5 1.5 0 0 1 3 0'),
    image: svg('M4 5h16v14H4z|M4 16l4.5-4.5 4 4L16 12l4 4'),
    front: svg('M12 3.4v9.2|M8.2 7.2L12 3.4l3.8 3.8|M4.5 15.5h15v5h-15z'),
    back: svg('M12 20.6v-9.2|M8.2 16.8L12 20.6l3.8-3.8|M4.5 8.5h15v-5h-15z'),
    trash: svg('M5 7h14|M9 7V5h6v2|M7 7l1 13h8l1-13'),
    dup: svg('M9 9h11v11H9z|M15 5.5V4H4v11h1.5'),
    group: svg('M4 8V4h4|M16 4h4v4|M20 16v4h-4|M8 20H4v-4|M9.5 9.5h5v5h-5z'),
    ungroup: svg('M3.5 4h7v7h-7z|M13.5 13h7v7h-7z')
  };

  /* chevrons for the panel folds: one per direction, named for the way the
     panel travels rather than the way the arrow points */
  const CHEV = {
    up: 'M6 14l6-6 6 6',
    down: 'M6 10l6 6 6-6',
    left: 'M14 6l-6 6 6 6',
    right: 'M10 6l6 6-6 6'
  };

  const PALETTE = ['ink', '#5b6472', '#4f6bff', '#0ea5e9', '#12a150', '#f5a524', '#e5484d', '#8e4ec6'];
  const PALETTE_DARK = ['ink', '#a3adbd', '#7d92ff', '#38bdf8', '#3ecf8e', '#fbbf24', '#ff6b6b', '#c084fc'];
  const HL = ['#ffe066', '#a7f3d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#ddd6fe', '#bbf7d0', '#fecaca'];
  const NOTE = ['#ffe58a', '#c7f0d8', '#cfe3ff', '#ffd6e7', '#ffd9b3', '#e2d9ff', '#e8eaee', '#c8f0f0'];
  const FILL = ['none', 'paper', '#eef1ff', '#e8f7ee', '#fff4e0', '#fde8e8', '#f3ebff', 'ink'];

  class UI {
    constructor(app) {
      this.app = app;
      this.rail = $('#rail');
      this.panel = $('#style');
      this.buildRail();
      this.buildTop();
      this.buildViewBar();
      this.buildFolds();
      this.buildSheet();
      this.refresh();
    }

    palette() { return document.documentElement.dataset.theme === 'dark' ? PALETTE_DARK : PALETTE; }

    /* ── tool rail ───────────────────────────────────────────────── */
    buildRail() {
      const app = this.app;
      const defs = [
        {
          id: 'select', icon: ICON.select, key: 'V', title: 'Select · V (hold for lasso)', flyout: [
            ['select', ICON.select, 'Rectangle select · V'], ['lasso', ICON.lasso, 'Lasso select · G']
          ], get: () => app.toolName === 'lasso' ? 'lasso' : 'select', set: k => app.setTool(k), self: true
        },
        { id: 'pen', icon: ICON.pen, key: 'P', title: 'Pen · P' },
        { id: 'highlighter', icon: ICON.highlighter, key: 'H', title: 'Highlighter · H' },
        { id: 'eraser', icon: ICON.eraser, key: 'E', title: 'Eraser · E (or flip the pen)' },
        { div: true },
        {
          id: 'shape', icon: ICON.shape, key: 'R', title: 'Shapes · R', flyout: [
            ['rect', ICON.rect, 'Rectangle · R'], ['ellipse', ICON.ellipse, 'Ellipse · O'],
            ['line', ICON.line, 'Line · L'], ['arrow', ICON.arrow, 'Arrow · A'],
            ['diamond', ICON.diamond, 'Diamond'], ['triangle', ICON.triangle, 'Triangle']
          ], get: () => app.opts.shape.kind, set: k => { app.opts.shape.kind = k; }
        },
        { id: 'text', icon: ICON.text, key: 'T', title: 'Text · T' },
        { id: 'note', icon: ICON.note, key: 'K', title: 'Sticky note · K' },
        {
          id: 'node', icon: ICON.node, key: 'N', title: 'Decision-tree node · N', flyout: [
            ['process', ICON.rect, 'Process'], ['decision', ICON.diamond, 'Decision'],
            ['terminal', ICON.ellipse, 'Start / end'], ['data', ICON.triangle, 'Data']
          ], get: () => app.opts.node.kind, set: k => { app.opts.node.kind = k; }
        },
        { id: 'connector', icon: ICON.connector, key: 'C', title: 'Connector · C' },
        { div: true },
        { id: 'laser', icon: ICON.laser, key: 'Q', title: 'Laser pointer · Q' },
        { id: 'pan', icon: ICON.hand, key: ' ', title: 'Pan · hold Space' }
      ];
      this.railButtons = {};
      for (const d of defs) {
        if (d.div) { this.rail.append(el('div', { class: 'divider' })); continue; }
        const b = el('button', { class: 'icon tool', title: d.title, html: d.icon + (d.flyout ? '<i class="badge"></i>' : '') });
        b.addEventListener('click', () => {
          if (app.tool === app.tools[d.id] && d.flyout) this.openFlyout(b, d);
          else app.setTool(d.id);
        });
        b.addEventListener('contextmenu', e => { e.preventDefault(); if (d.flyout) this.openFlyout(b, d); });
        let hold;
        b.addEventListener('pointerdown', () => { if (d.flyout) hold = setTimeout(() => this.openFlyout(b, d), 420); });
        b.addEventListener('pointerup', () => clearTimeout(hold));
        b.addEventListener('pointerleave', () => clearTimeout(hold));
        this.rail.append(b);
        this.railButtons[d.id] = b;
        d.el = b;
      }
      this.railDefs = defs;
    }

    openFlyout(anchor, d) {
      this.closeFlyout();
      const r = anchor.getBoundingClientRect();
      const f = el('div', { class: 'flyout' });
      for (const [k, icon, title] of d.flyout) {
        const b = el('button', { class: 'icon' + (d.get() === k ? ' on' : ''), title, html: icon });
        b.onclick = () => { d.set(k); if (!d.self) this.app.setTool(d.id); this.closeFlyout(); this.refresh(); };
        f.append(b);
      }
      document.body.append(f);
      f.style.left = (r.right + 8) + 'px';
      f.style.top = Math.max(8, r.top - 4) + 'px';
      this.flyout = f;
      setTimeout(() => addEventListener('pointerdown', this._close = e => {
        if (!f.contains(e.target)) this.closeFlyout();
      }, { once: true }), 0);
    }
    closeFlyout() { if (this.flyout) { this.flyout.remove(); this.flyout = null; } }

    /* ── top bar / view bar ──────────────────────────────────────── */
    buildTop() {
      const app = this.app;
      $('#btn-undo').onclick = () => app.undo();
      $('#btn-redo').onclick = () => app.redo();
      $('#btn-menu').onclick = () => this.openSheet();
      $('#btn-theme').onclick = () => app.toggleTheme();
      $('#btn-settings').onclick = () => this.openSettings();
      const t = $('#board-title');
      t.addEventListener('input', () => { app.board.name = t.value; app.markDirty(); });
      t.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') t.blur(); });
    }

    buildViewBar() {
      const app = this.app, c = app.camera;
      $('#btn-zoom-in').onclick = () => { c.zoomBy(1.25, innerWidth / 2, innerHeight / 2); app.requestDraw(); this.refresh(); };
      $('#btn-zoom-out').onclick = () => { c.zoomBy(0.8, innerWidth / 2, innerHeight / 2); app.requestDraw(); this.refresh(); };
      $('#btn-zoom-reset').onclick = () => { c.zoomTo(1, innerWidth / 2, innerHeight / 2); app.requestDraw(); this.refresh(); };
      $('#btn-fit').onclick = () => app.zoomToFit();
      $('#btn-grid').onclick = () => app.cycleGrid();
    }

    /* ── folding the chrome away ─────────────────────────────────── */
    /* Four pieces of chrome, one fold each. A panel's chevron points the
       way it is about to travel and the tab it leaves behind points back,
       so the direction of the arrow is always "press it and the panel goes
       this way". The two tall panels get a handle stuck to their edge
       instead of a chevron in the corner: the rail and the style panel are
       narrow enough that a corner button would sit on a tool or a swatch,
       and the style panel is long enough to scroll, which would carry a
       child of its own out of reach. The style panel's handle therefore
       hangs off the body — see #style-fold in css/app.css. */
    buildFolds() {
      const foldable = [
        { k: 'top', id: 'topbar-fold', tab: 'topbar-tab', into: '#topbar', what: 'top bar', away: 'up', back: 'down' },
        { k: 'rail', id: 'rail-fold', tab: 'rail-tab', into: '#rail', what: 'tool rail', away: 'left', back: 'right', stick: true },
        { k: 'style', id: 'style-fold', tab: 'style-tab', into: null, what: 'style panel', away: 'right', back: 'left', stick: true },
        { k: 'view', id: 'viewbar-fold', tab: 'viewbar-tab', into: '#viewbar', what: 'zoom bar', away: 'down', back: 'up' }
      ];
      this.folds = {};
      for (const f of foldable) {
        const fold = el('button', {
          id: f.id, class: 'collapse' + (f.stick ? ' stick' : ''),
          title: 'Hide the ' + f.what + '  ·  Ctrl+\\', html: svg(CHEV[f.away])
        });
        fold.onclick = () => this.setFold(f.k, true);
        (f.into ? $(f.into) : document.body).append(fold);

        const tab = el('button', {
          id: f.tab, class: 'tab',
          title: 'Show the ' + f.what + '  ·  Ctrl+\\', html: svg(CHEV[f.back])
        });
        tab.onclick = () => this.setFold(f.k, false);
        document.body.append(tab);

        this.folds[f.k] = { fold, tab, folded: false };
      }
    }

    setFold(name, folded) {
      const f = this.folds[name];
      if (!f || f.folded === folded) return;
      f.folded = folded;
      document.body.classList.toggle('fold-' + name, folded);
      if (folded && name === 'rail') this.closeFlyout();   // it would point at nothing
      this.rememberFolds();
      this.app.requestDraw();      // the canvas just gained or lost the room
    }

    /* Fold state belongs to the window you are sitting at, not to the
       board, so it is kept in localStorage rather than in the board's
       prefs: the same board opened on a bigger screen, or inline in a
       note, should not arrive with its panels hidden. */
    rememberFolds() {
      const on = Object.keys(this.folds).filter(k => this.folds[k].folded);
      try { localStorage.setItem('dpo:fold', on.join(',')); } catch (_) { }
    }

    restoreFolds() {
      let on = [];
      try { on = (localStorage.getItem('dpo:fold') || '').split(','); } catch (_) { }
      for (const k in this.folds) {
        if (!on.includes(k)) continue;
        this.folds[k].folded = true;
        document.body.classList.add('fold-' + k);
      }
    }

    /* One key for "give me the canvas": everything folded comes back, and
       with nothing folded everything goes away. It is always the same key
       home, so hiding the panels is never a one-way door. */
    toggleFolds() {
      const any = Object.keys(this.folds).some(k => this.folds[k].folded);
      for (const k in this.folds) this.setFold(k, !any);
      this.app.toast(any ? 'Panels back' : 'Panels hidden — Ctrl+\\ brings them back');
    }

    /* ── contextual style panel ──────────────────────────────────── */
    refresh() {
      const app = this.app;
      const active = app.toolName === 'lasso' ? 'select' : app.toolName;
      for (const id in this.railButtons) this.railButtons[id].classList.toggle('on', active === id);
      $('#btn-undo').disabled = !app.scene.undoStack.length;
      $('#btn-redo').disabled = !app.scene.redoStack.length;
      $('#btn-zoom-reset').textContent = Math.round(app.camera.zoom * 100) + '%';
      this.buildPanel();
    }

    buildPanel() {
      const app = this.app, p = this.panel;
      p.textContent = '';
      const tool = app.toolName === 'lasso' ? 'select' : app.toolName;
      const sel = app.selection;

      if (tool === 'select' && sel.length) return this.panelForSelection(sel);

      switch (tool) {
        case 'pen': return this.panelInk('pen', this.palette(), [1.5, 3, 5.5, 9, 16]);
        case 'highlighter': return this.panelInk('highlighter', HL, [10, 18, 28, 40]);
        case 'eraser': return this.panelEraser();
        case 'shape': return this.panelShape();
        case 'text': return this.panelText();
        case 'note': return this.panelNote();
        case 'node': return this.panelNode();
        case 'connector': return this.panelEdge();
        default: return this.panelGeneral();
      }
    }

    /* Element.append(null) writes the literal text "null" into the panel,
       so every conditional row has to be filtered out on the way in. */
    add(...kids) { for (const k of kids.flat()) if (k != null) this.panel.append(k); }

    group(title, ...kids) { return el('div', { class: 'group' }, title ? el('h4', {}, title) : null, ...kids); }

    /* Every control in the style panel ends here. The tool options they
       change — pen colour, size, opacity, pressure, eraser mode and the
       rest — are part of the prefs, but only the canvas and behaviour
       switches used to save them, so a restart put the pen back to its
       defaults. savePrefs is debounced, so a slider being dragged costs one
       write when it stops. On a selection the same controls restyle items
       rather than tools; saving the unchanged prefs then is harmless. */
    picked() { this.app.savePrefs(); }

    swatches(colors, current, onpick, allowCustom = true) {
      const wrap = el('div', { class: 'swatches' });
      for (const c of colors) {
        const b = el('button', {
          class: 'sw' + (c === current ? ' on' : ''), title: c,
          style: c === 'none'
            ? 'background:linear-gradient(45deg,transparent 46%,#e5484d 46%,#e5484d 54%,transparent 54%);border-style:dashed'
            : c === 'ink' ? 'background:var(--text)'
              : c === 'paper' ? 'background:var(--paper)'
                : `background:${c}`
        });
        b.onclick = () => { onpick(c); this.picked(); this.buildPanel(); this.app.requestDraw(); };
        wrap.append(b);
      }
      if (allowCustom) {
        const off = /^#/.test(current) && !colors.includes(current);   // a colour picked by hand
        const inp = el('input', { type: 'color', value: /^#/.test(current) ? current : '#4f6bff' });
        inp.oninput = () => { onpick(inp.value); this.picked(); this.app.requestDraw(); };
        wrap.append(el('button', {
          class: 'sw custom' + (off ? ' on' : ''), title: 'Custom colour',
          style: off ? `background:${current}` : 'background:conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)'
        }, inp));
      }
      return wrap;
    }

    sizes(list, current, onpick, color) {
      const wrap = el('div', { class: 'sizes' });
      for (const s of list) {
        const b = el('button', { class: 'size' + (s === current ? ' on' : ''), title: s + 'px' },
          el('i', { style: `width:${Math.min(22, 3 + s * .9)}px;height:${Math.min(22, 3 + s * .9)}px;background:${color || 'currentColor'}` }));
        b.onclick = () => { onpick(s); this.picked(); this.buildPanel(); };
        wrap.append(b);
      }
      return wrap;
    }

    seg(options, current, onpick) {
      const wrap = el('div', { class: 'seg' });
      for (const [v, label] of options) {
        const b = el('button', { class: current === v ? 'on' : '' }, label);
        b.onclick = () => { onpick(v); this.picked(); this.buildPanel(); this.app.requestDraw(); };
        wrap.append(b);
      }
      return wrap;
    }

    slider(label, value, min, max, step, oninput, fmt = v => v) {
      const out = el('span', {}, fmt(value));
      const r = el('input', { type: 'range', min, max, step, value });
      r.oninput = () => { out.textContent = fmt(+r.value); oninput(+r.value); this.picked(); };
      return el('div', { class: 'group' }, el('div', { class: 'rowlbl' }, el('span', {}, label), out), r);
    }

    check(label, value, onchange) {
      const i = el('input', { type: 'checkbox' });
      i.checked = value;
      i.onchange = () => { onchange(i.checked); this.picked(); };
      return el('label', { class: 'check' }, i, label);
    }

    panelInk(kind, colors, sizeList) {
      const o = this.app.opts[kind];
      this.add(
        this.group('Colour', this.swatches(colors, o.color, c => o.color = c)),
        this.group('Size', this.sizes(sizeList, o.size, s => o.size = s, o.color)),
        this.slider('Opacity', o.alpha, 0.1, 1, 0.05, v => o.alpha = v, v => Math.round(v * 100) + '%'),
        kind === 'pen' ? this.slider('Pressure', o.thinning, 0, 0.95, 0.05, v => o.thinning = v, v => Math.round(v * 100) + '%') : null,
        kind === 'pen' ? this.group('Behaviour',
          this.check('Hold to snap shapes', this.app.opts.general.holdToSnap, v => this.app.opts.general.holdToSnap = v),
          this.check('Scribble to erase', this.app.opts.general.scribbleErase, v => this.app.opts.general.scribbleErase = v)) : null
      );
    }

    panelEraser() {
      const o = this.app.opts.eraser;
      this.add(
        this.group('Eraser', this.seg([['object', 'Whole'], ['partial', 'Pixel']], o.mode, v => o.mode = v)),
        this.slider('Size', o.size, 6, 120, 2, v => o.size = v, v => v + 'px'),
        this.group('', el('div', { class: 'rowlbl' }, el('span', { style: 'line-height:1.5' },
          (o.mode === 'object' ? 'Removes each stroke it touches. ' : 'Rubs out just the part you cross. ') +
          'PDFs, images, notes and nodes are left alone — select those and press Delete.')))
      );
    }

    panelShape() {
      const o = this.app.opts.shape;
      this.add(
        this.group('Shape', this.seg([['rect', '▭'], ['ellipse', '◯'], ['diamond', '◇'], ['triangle', '△'], ['line', '╱'], ['arrow', '↗']], o.kind, v => { o.kind = v; this.refresh(); })),
        this.group('Stroke', this.swatches(this.palette(), o.color, c => o.color = c)),
        this.group('Fill', this.swatches(FILL, o.fill, c => o.fill = c, false)),
        this.group('Weight', this.sizes([1.5, 3, 5, 8], o.size, s => o.size = s, o.color)),
        this.group('Line', this.seg([[0, 'Solid'], [1, 'Dashed'], [2, 'Dotted']], o.dash, v => o.dash = v)),
        this.slider('Opacity', o.alpha, 0.1, 1, 0.05, v => o.alpha = v, v => Math.round(v * 100) + '%'),
        o.kind === 'rect' ? this.slider('Corners', o.radius, 0, 40, 1, v => o.radius = v) : null
      );
    }

    panelText() {
      const o = this.app.opts.text;
      this.add(
        this.group('Colour', this.swatches(this.palette(), o.color, c => o.color = c)),
        this.group('Size', this.seg([[14, 'S'], [20, 'M'], [30, 'L'], [46, 'XL']], o.size, v => o.size = v)),
        this.group('Font', this.seg([['sans', 'Clean'], ['hand', 'Hand']], o.font, v => o.font = v)),
        this.group('Align', this.seg([['left', '⯇'], ['center', '≡'], ['right', '⯈']], o.align, v => o.align = v))
      );
    }

    panelNote() {
      const o = this.app.opts.note;
      this.add(
        this.group('Note colour', this.swatches(NOTE, o.color, c => o.color = c, false)),
        this.group('Text size', this.seg([[13, 'S'], [16, 'M'], [22, 'L'], [30, 'XL']], o.size, v => o.size = v))
      );
    }

    panelNode() {
      const o = this.app.opts.node;
      this.add(
        this.group('Node', this.seg([['process', '▭'], ['decision', '◇'], ['terminal', '⬭'], ['data', '▱']], o.kind, v => o.kind = v)),
        this.group('Fill', this.swatches(FILL, o.fill, c => o.fill = c, true)),
        this.group('Outline', this.swatches(this.palette(), o.color, c => o.color = c)),
        this.group('Text size', this.seg([[13, 'S'], [15, 'M'], [19, 'L'], [26, 'XL']], o.textSize, v => o.textSize = v)),
        this.group('', el('div', { class: 'rowlbl' }, el('span', { style: 'line-height:1.5' },
          'Select a node, then Tab for a child or Enter for a sibling — connectors are drawn for you.')))
      );
    }

    panelEdge() {
      const o = this.app.opts.edge;
      this.add(
        this.group('Route', this.seg([['elbow', 'Elbow'], ['line', 'Direct'], ['curve', 'Curve']], o.style, v => o.style = v)),
        this.group('Colour', this.swatches(this.palette(), o.color, c => o.color = c)),
        this.group('Weight', this.sizes([1.5, 2.5, 4], o.size, s => o.size = s, o.color)),
        this.group('Line', this.seg([[0, 'Solid'], [1, 'Dashed']], o.dash, v => o.dash = v)),
        this.group('Ends', this.seg([['end', '→'], ['both', '↔'], ['none', '—']],
          o.arrowStart && o.arrowEnd ? 'both' : o.arrowEnd ? 'end' : 'none',
          v => { o.arrowEnd = v !== 'none'; o.arrowStart = v === 'both'; }))
      );
    }

    panelGeneral() {
      const g = this.app.opts.general;
      this.add(
        this.group('Canvas',
          this.seg([['dots', 'Dots'], ['lines', 'Grid'], ['lined', 'Ruled'], ['none', 'Plain']], this.app.renderer.grid, v => { this.app.renderer.grid = v; this.app.requestDraw(); this.app.savePrefs(); })),
        this.group('Behaviour',
          this.check('Hold to snap shapes', g.holdToSnap, v => { g.holdToSnap = v; this.app.savePrefs(); }),
          this.check('Scribble to erase', g.scribbleErase, v => { g.scribbleErase = v; this.app.savePrefs(); }),
          this.check('Snap to grid', g.snapGrid, v => { g.snapGrid = v; this.app.savePrefs(); }),
          this.check('Touch pans the canvas', g.touchPan, v => { g.touchPan = v; this.app.savePrefs(); }),
          this.check('Keep drawing tool after each shape', g.stickyTools, v => { g.stickyTools = v; this.app.savePrefs(); })),
        this.group('', this.pill('⚙ All settings…', () => this.openSettings()))
      );
    }

    panelForSelection(sel) {
      const app = this.app;
      const first = sel[0];
      const has = t => sel.some(i => i.type === t);
      const apply = fn => {
        app.scene.begin('style');
        for (const it of sel) { app.scene.touch(it); fn(it); }
        app.scene.commit();
        app.requestDraw(); app.markDirty(); this.buildPanel();
      };

      const grouped = sel.some(i => i.group);
      const colorNow = first.type === 'note' ? first.color : (first.color || '#000');
      this.add(
        this.group(sel.length > 1 ? sel.length + ' items' : labelOf(first),
          this.swatches(has('note') ? NOTE : this.palette(), colorNow, c => apply(it => { it.color = c; it._path = null; }))),
        (has('shape') || has('node')) ? this.group('Fill', this.swatches(FILL, first.fill, c => apply(it => { if ('fill' in it) it.fill = c; }), true)) : null,
        this.group('Weight', this.sizes([1.5, 3, 5, 8, 14], first.size, s => apply(it => { it.size = s; it._path = null; it._b = null; }), first.color)),
        this.slider('Opacity', first.alpha ?? 1, 0.1, 1, 0.05, v => apply(it => it.alpha = v), v => Math.round(v * 100) + '%'),
        (has('text') || has('note') || has('node')) ? this.group('Text size',
          this.seg([[13, 'S'], [17, 'M'], [24, 'L'], [34, 'XL']], first.textSize || first.size,
            v => apply(it => { if (it.type === 'node') it.textSize = v; else it.size = v; it._lines = null; it._b = null; }))) : null,
        has('edge') ? this.group('Route', this.seg([['elbow', 'Elbow'], ['line', 'Direct'], ['curve', 'Curve']], first.style, v => apply(it => { if (it.type === 'edge') { it.style = v; it._b = null; } }))) : null,
        this.group('Arrange', el('div', { class: 'actions' },
          iconBtn(ICON.front, 'Bring to front · ]', () => app.arrange('front')),
          iconBtn(ICON.back, 'Send to back · [', () => app.arrange('back')),
          iconBtn(ICON.dup, 'Duplicate · Ctrl+D', () => app.duplicate()),
          grouped ? iconBtn(ICON.ungroup, 'Ungroup · Ctrl+Shift+G', () => app.toggleGroup())
                  : iconBtn(ICON.group, 'Group · Ctrl+G', () => app.toggleGroup()),
          iconBtn(ICON.trash, 'Delete · Del', () => app.deleteSelection(), 'danger')))
      );
    }

    /* ── sheet ───────────────────────────────────────────────────── */
    buildSheet() {
      const app = this.app;
      $('#sheet-close').onclick = () => this.closeSheet();
      $('#sheet-backdrop').onclick = () => { this.closeSheet(); this.closeSettings(); };
      $('#settings-close').onclick = () => this.closeSettings();
      $('#act-settings').onclick = () => this.openSettings();
      for (const a of document.querySelectorAll('[data-link]')) {
        a.onclick = e => { e.preventDefault(); D.desktop.open(D.desktop.links[a.dataset.link]); };
      }
      $('#act-new').onclick = () => app.newBoard();
      $('#act-duplicate').onclick = () => app.duplicateBoard();
      $('#act-export-json').onclick = () => app.exportJSON();
      $('#act-export-png').onclick = () => app.exportPNG();
      $('#act-export-svg').onclick = () => app.exportSVG();
      $('#act-import').onclick = () => { const f = $('#file-input'); f.accept = '.board,.json'; f.click(); };
      $('#act-open-pdf').onclick = () => {
        const f = $('#file-input'); f.accept = '.pdf,image/*'; f.click();
        this.closeSheet();
      };
    }

    async openSheet() {
      // make sure the board you are looking at is represented as it is now
      await this.app.refreshThumb();
      this.boards = await D.store.list();
      const s = $('#board-search');
      s.value = '';
      s.oninput = () => this.renderBoards();
      this.renderBoards();
      $('#sheet').hidden = false; $('#sheet-backdrop').hidden = false;
    }

    renderBoards() {
      const app = this.app;
      const q = ($('#board-search').value || '').trim().toLowerCase();
      const grid = $('#board-grid');
      grid.textContent = '';
      const list = (this.boards || []).filter(b => !q || (b.name || '').toLowerCase().includes(q));

      if (!list.length) {
        grid.append(el('div', { class: 'board-empty' }, q ? `Nothing matching “${q}”` : 'No boards yet'));
        return;
      }

      for (const b of list) {
        const current = b.id === app.board.id;
        const shot = b.thumb
          ? el('img', { class: 'shot', src: b.thumb, alt: '', loading: 'lazy', draggable: 'false' })
          : el('div', { class: 'shot empty' }, 'Empty board');
        const card = el('button', { class: 'board-card' + (current ? ' on' : ''), title: b.name || 'Untitled' },
          shot,
          el('div', { class: 'meta' },
            el('div', { class: 'nm' }, b.name || 'Untitled'),
            el('div', { class: 'dt' }, `${b.count || 0} item${b.count === 1 ? '' : 's'} · ${when(b.updated)}`)),
          current ? el('span', { class: 'badge-now' }, 'open') : null,
          el('span', { class: 'del', title: 'Delete board', html: ICON.trash }));

        card.onclick = async e => {
          if (e.target.closest('.del')) {
            e.stopPropagation();
            if (!confirm(`Delete “${b.name}”? This cannot be undone.`)) return;
            await app.deleteBoard(b.id);
            this.boards = await D.store.list();
            this.renderBoards();
            return;
          }
          if (!current) await app.openBoard(b.id);
          this.closeSheet();
        };
        grid.append(card);
      }
    }
    closeSheet() { $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; }

    /* ── settings ────────────────────────────────────────────────── */
    /* Everything that is not about the ink in your hand: where boards are
       kept, how the canvas looks, what the pen and touch do, updates, and
       where to ask for things. Rebuilt on every open, so it shows the state
       as it is now rather than as it was when the page loaded. */
    async openSettings() {
      this.closeSheet();
      const X = D.desktop;
      const cfg = X.on ? await X.config().catch(() => null) : null;
      const body = $('#settings-body');
      body.textContent = '';
      body.append(...[
        this.setStorage(cfg),
        this.setCanvas(),
        this.setInput(),
        X.on ? this.setUpdates(cfg) : null,
        this.setFeedback(cfg)
      ].filter(Boolean));
      $('#settings').hidden = false; $('#sheet-backdrop').hidden = false;
    }
    closeSettings() { $('#settings').hidden = true; $('#sheet-backdrop').hidden = true; }

    section(title, ...kids) { return el('section', { class: 'set' }, el('h3', {}, title), ...kids); }
    row(label, control) { return el('div', { class: 'set-row' }, el('span', {}, label), control); }
    note(text) { return el('p', { class: 'note' }, text); }
    pill(label, onclick) { return el('button', { class: 'pill', onclick }, label); }

    /* seg() rebuilds the style panel to show its pick; this one marks its
       own, because the settings page is not rebuilt underneath you */
    setSeg(options, current, onpick) {
      const wrap = el('div', { class: 'seg' });
      for (const [v, label] of options) {
        const b = el('button', { class: current === v ? 'on' : '' }, label);
        b.onclick = () => { for (const x of wrap.children) x.classList.toggle('on', x === b); onpick(v); this.refresh(); };
        wrap.append(b);
      }
      return wrap;
    }

    setStorage(cfg) {
      const app = this.app, X = D.desktop;
      const path = text => el('div', { class: 'path' }, text);

      if (!X.on) {
        const where = {
          host: 'In your Obsidian vault, by the Draw · Plan · Order plugin',
          indexedDB: 'In this browser, on this computer',
          localStorage: 'In this browser’s local storage, on this computer',
          memory: 'Nowhere — this board is not being saved',
          scratch: 'Nowhere — a ?scratch board is thrown away when you close it'
        }[D.store.backend] || 'In this browser';
        return this.section('Saving', path(where),
          this.note(D.store.backend === 'host'
            ? 'The folder is set in the plugin’s settings inside Obsidian.'
            : 'Each browser keeps its own boards. Export a board from ☰ to move it elsewhere, or use the desktop app to keep boards as files in a folder you choose.'));
      }

      const choose = this.pill(cfg && cfg.dir ? 'Change folder…' : 'Choose a folder…', async () => {
        await app.saveNow(true);              // the board on screen belongs to where it came from
        let next;
        try { next = await X.chooseFolder(); }
        catch (err) { app.toast('Could not use that folder: ' + err); return; }
        if (next) location.replace(location.pathname);    // start again against the new folder
      });

      if (!cfg || !cfg.dir) {
        let copied = false;
        try { copied = !localStorage.getItem('dpo:migrated-to-vault'); } catch (_) { }
        return this.section('Saving', path('Inside the app, on this computer'),
          this.note('Choose a folder to keep boards as ordinary files you can back up, sync, or open from Obsidian.' +
            (copied ? ' The boards you have now are copied into it.' : '')),
          el('div', { class: 'set-actions' }, choose));
      }

      return this.section('Saving', path(cfg.dir),
        cfg.obsidian ? this.note('This is an Obsidian vault, so the Draw · Plan · Order plugin opens these same boards.') : null,
        this.note('Changing the folder leaves the boards already saved where they are; switch back to reach them.'),
        el('div', { class: 'set-actions' }, choose,
          this.pill('Open folder', () => X.revealFolder().catch(err => app.toast('Could not open the folder: ' + err)))));
    }

    setCanvas() {
      const app = this.app, dark = () => document.documentElement.dataset.theme === 'dark';
      return this.section('Canvas',
        this.row('Theme', this.setSeg([['light', 'Light'], ['dark', 'Dark']], dark() ? 'dark' : 'light',
          v => { if ((v === 'dark') !== dark()) app.toggleTheme(); })),
        this.row('Paper', this.setSeg([['dots', 'Dots'], ['lines', 'Grid'], ['lined', 'Ruled'], ['none', 'Plain']], app.renderer.grid,
          v => { app.renderer.grid = v; app.requestDraw(); app.savePrefs(); })));
    }

    setInput() {
      const g = this.app.opts.general, set = (k, v) => { g[k] = v; this.app.savePrefs(); this.refresh(); };
      return this.section('Pen and touch',
        this.check('Hold the pen still to snap a shape clean', g.holdToSnap, v => set('holdToSnap', v)),
        this.check('Scribble over ink to erase it', g.scribbleErase, v => set('scribbleErase', v)),
        this.check('Snap to grid', g.snapGrid, v => set('snapGrid', v)),
        this.check('A finger pans and zooms instead of drawing', g.touchPan, v => set('touchPan', v)),
        this.check('Keep the drawing tool after each shape', g.stickyTools, v => set('stickyTools', v)));
    }

    setUpdates(cfg) {
      const app = this.app, X = D.desktop;
      const status = el('div', { class: 'note' });
      const check = this.pill('Check now', async () => {
        check.disabled = true;
        status.textContent = 'Checking…';
        try {
          const u = await X.checkUpdate();
          status.textContent = u ? `Version ${u.version} is ready to install.` : 'You have the newest version.';
          if (u) status.append(' ', el('button', { class: 'pill', onclick: () => app.installUpdate(u) }, 'Install and restart'));
        } catch (err) {
          status.textContent = 'Could not reach GitHub to check: ' + err;
        }
        check.disabled = false;
      });
      return this.section('Updates',
        this.row('Version', el('span', { class: 'ver' }, cfg ? cfg.version : '…')),
        this.check('Check for updates when the app starts', X.autoUpdate, v => { X.autoUpdate = v; }),
        el('div', { class: 'set-actions' }, check), status);
    }

    setFeedback() {
      const X = D.desktop, go = k => () => X.open(X.links[k]);
      return this.section('Ideas and problems',
        this.note('Something missing, or something that would make this better to work with? Requests and bug reports live on GitHub (you will need a free account to post one).'),
        el('div', { class: 'set-actions' },
          this.pill('💡 Suggest a feature', go('feature')),
          this.pill('Report a problem', go('bug')),
          this.pill('What’s new', go('releases'))));
    }

    /* ── toast ───────────────────────────────────────────────────── */
    toast(msg, actionLabel, action, ms = 4200) {
      const t = $('#toast');
      t.textContent = '';
      t.append(el('span', {}, msg));
      if (actionLabel) {
        const b = el('button', {}, actionLabel);
        b.onclick = () => { action(); this.hideToast(); };
        t.append(b);
      }
      t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => this.hideToast(), ms);
    }
    hideToast() { $('#toast').classList.remove('show'); }
  }

  function iconBtn(icon, title, onclick, extra) {
    const b = el('button', { class: 'icon' + (extra ? ' ' + extra : ''), title, html: icon });
    b.onclick = onclick;
    return b;
  }

  function labelOf(it) {
    return { stroke: 'Ink', shape: 'Shape', text: 'Text', note: 'Sticky note', node: 'Node', edge: 'Connector', image: 'Image' }[it.type] || 'Item';
  }

  function when(ts) {
    const d = Date.now() - ts;
    if (d < 6e4) return 'just now';
    if (d < 36e5) return Math.round(d / 6e4) + 'm ago';
    if (d < 864e5) return Math.round(d / 36e5) + 'h ago';
    return new Date(ts).toLocaleDateString();
  }

  D.UI = UI;
  D.ICON = ICON;
})(window.DPO);

/* ── ui.js ── tool rail, contextual style panel, sheets, toasts ───── */
(function (D) {
  'use strict';
  const U = D.util, el = U.el, $ = U.$;

  /* `heavy` draws the paths a little bolder: the force arrow is told apart
     from the plain one by its weight, as it is on paper */
  const svg = (d, heavy) => `<svg viewBox="0 0 24 24"${heavy ? ' style="stroke-width:2.6"' : ''}>${d.split('|').map(p => `<path d="${p}"/>`).join('')}</svg>`;
  /* A feature's icon (ext.js) may be finished markup or, like ICON below,
     just the path data. */
  const iconOf = s => !s ? '' : /^\s*</.test(s) ? s : svg(s);

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
    polyline: svg('M4 18l5-9 6 6 5-10|M16.5 5h3.5v3.5'),
    force: svg('M4 20L17 7|M11 6.4h7.6V14|M4 20l1.2-1.2', 'force'),
    moment: svg('M17.6 15.4A7 7 0 1 1 18.4 9|M19.4 4.4l-.6 5-4.8-1.2'),
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
          id: 'shape', icon: ICON.shape, key: 'R', title: 'Shapes and arrows · R', flyout: [
            ['rect', ICON.rect, 'Rectangle · R'], ['ellipse', ICON.ellipse, 'Ellipse · O'],
            ['diamond', ICON.diamond, 'Diamond'], ['triangle', ICON.triangle, 'Triangle'],
            ['line', ICON.line, 'Line · L'], ['arrow', ICON.arrow, 'Arrow · A'],
            ['polyline', ICON.polyline, 'Polyline — tap the last point to finish'],
            ['force', ICON.force, 'Force arrow'], ['moment', ICON.moment, 'Moment arrow']
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
      /* Registered tools (ext.js) go after the entry they name, or else at
         the end of the making tools, before the laser/pan group. */
      for (const t of D.ext.tools) {
        if (!t.rail) continue;
        const d = { ...t.rail, id: t.name, icon: iconOf(t.rail.icon), title: t.rail.title || t.name };
        let at = t.rail.after ? defs.findIndex(x => x.id === t.rail.after) + 1 : 0;
        if (at <= 0) at = defs.findIndex(x => x.id === 'laser') - 1;    // the divider before it
        defs.splice(at, 0, d);
      }
      this.railButtons = {};
      this.railAlso = {};
      for (const d of defs) {
        // a rail entry that stands for several tools stays lit for all of them
        if (d.also) for (const a of d.also) this.railAlso[a] = d.id;
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
      $('#btn-insert').onclick = () => {
        const f = $('#file-input');
        f.accept = '.pdf,image/*,.svg';
        f.multiple = true;
        f.click();
      };
      const menu = $('#export-menu');
      $('#btn-export').onclick = e => {
        e.stopPropagation();
        if (!menu.hidden) { menu.hidden = true; return; }
        const r = $('#btn-export').getBoundingClientRect();
        menu.style.left = r.left + 'px';
        menu.style.top = (r.bottom + 8) + 'px';
        menu.hidden = false;
        // a press anywhere else closes it; one on the button is left to the click, which toggles
        addEventListener('pointerdown', ev => {
          if (!menu.contains(ev.target) && !$('#btn-export').contains(ev.target)) menu.hidden = true;
        }, { once: true });
      };
      for (const b of menu.querySelectorAll('[data-export]')) {
        b.onclick = () => {
          menu.hidden = true;
          ({ png: () => app.exportPNG(), svg: () => app.exportSVG(), board: () => app.exportJSON() })[b.dataset.export]();
        };
      }
      const t = $('#board-title');
      t.addEventListener('input', () => { app.board.name = t.value; app.markDirty(); });
      t.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') t.blur(); });
      this.extButtons('top', 'icon', b => $('#btn-theme').before(b));
    }

    /** the buttons features registered for one bar (ext.js) */
    extButtons(where, cls, put) {
      for (const x of D.ext.buttons) {
        if (x.where !== where) continue;
        const b = el('button', { class: cls, id: x.id, title: x.title || '', html: iconOf(x.icon) });
        b.onclick = () => x.onClick(this.app);
        put(b);
      }
    }

    buildViewBar() {
      const app = this.app, c = app.camera;
      $('#btn-zoom-in').onclick = () => { c.zoomBy(1.25, innerWidth / 2, innerHeight / 2); app.requestDraw(); this.refresh(); };
      $('#btn-zoom-out').onclick = () => { c.zoomBy(0.8, innerWidth / 2, innerHeight / 2); app.requestDraw(); this.refresh(); };
      $('#btn-zoom-reset').onclick = () => { c.zoomTo(1, innerWidth / 2, innerHeight / 2); app.requestDraw(); this.refresh(); };
      $('#btn-fit').onclick = () => app.zoomToFit();
      $('#btn-grid').onclick = () => app.cycleGrid();
      this.extButtons('view', 'icon sm', b => $('#viewbar').append(b));
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
      const name = app.toolName === 'lasso' ? 'select' : app.toolName;
      const active = this.railAlso[name] || name;
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
        default: {
          const x = D.ext.tools.find(t => t.name === tool);
          return x && x.panel ? x.panel(this) : this.panelGeneral();
        }
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

    /** seg(), with an icon in each button rather than a word: options are [value, svg, title] */
    iconSeg(options, current, onpick) {
      const wrap = el('div', { class: 'seg icons' });
      for (const [v, icon, title] of options) {
        const b = el('button', { class: current === v ? 'on' : '', title: title || String(v), 'aria-label': title || String(v), html: icon });
        b.onclick = () => { onpick(v); this.picked(); this.buildPanel(); this.app.requestDraw(); };
        wrap.append(b);
      }
      return wrap;
    }

    /** an arrowhead style as a little picture: the head at the right, or at the left when `start` */
    headIcon(style, start) {
      const shaft = { none: 21, open: 21, filled: 15, half: 17, tick: 20, dot: 16 }[style] || 21;
      const head = {
        open: '<path d="M15 7l6 5-6 5"/>',
        filled: '<path d="M21 12l-7-4.6v9.2z" fill="currentColor"/>',
        half: '<path d="M21 12l-7-4.6V12z" fill="currentColor"/>',
        tick: '<path d="M16.5 15.5l7-7" style="stroke-width:2.2"/>',
        dot: '<circle cx="19" cy="12" r="2.8" fill="currentColor"/>'
      }[style] || '';
      const body = `<path d="M3 12h${shaft - 3}"/>${head}`;
      return `<svg viewBox="0 0 24 24">${start ? `<g transform="matrix(-1 0 0 1 24 0)">${body}</g>` : body}</svg>`;
    }

    /** a line style as a little picture: solid, dashed, dotted, centre, hidden */
    dashIcon(dash) {
      const da = { 1: '5 3.2', 2: '0.1 3.4', 3: '7 2.6 0.1 2.6', 4: '2.6 2.8' }[dash];
      return `<svg viewBox="0 0 24 24"><path d="M2 12h20" style="stroke-width:2.2"${da ? ` stroke-dasharray="${da}"` : ''}/></svg>`;
    }

    /** a line of explanation under a control */
    hintText(text) { return el('p', { class: 'cad-note' }, text); }

    /** a one-line text field that applies on Enter or when it loses focus */
    textField(value, placeholder, onchange, id) {
      const i = el('input', { type: 'text', class: 'txt-in', value: value || '', placeholder: placeholder || '', id: id ? 'f-' + id : null, spellcheck: 'false' });
      i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); if (e.key === 'Escape') { i.value = value || ''; i.blur(); } });
      i.onchange = () => onchange(i.value);
      return i;
    }

    /** put the caret in a field of the style panel, once it has been built */
    focusField(id) {
      setTimeout(() => {
        const f = document.getElementById('f-' + id);
        if (f) { f.focus(); if (f.select) f.select(); }
      }, 30);
    }

    /**
     * A number to set exactly: a large field with a − and a + either side,
     * built for a pen. The steppers repeat while held (and speed up), and
     * a hold is one undo step however long it runs. The field takes
     * arithmetic and units ("1200/4", "2.5 m") when cad.js is loaded.
     *
     * o: { unit, prec, step, min, max, wrap, id,
     *      apply(v) — change the board: runs inside one step, after the
     *                 items in o.items have been touched; or
     *      set(v)   — just be told }
     */
    num(label, value, o = {}) {
      const app = this.app, prec = o.prec ?? 2;
      const show = v => String(+(+v).toFixed(prec));
      let cur = value, open = false;
      const inp = el('input', {
        type: 'text', inputmode: 'decimal', class: 'num-in', value: show(value), id: o.id ? 'f-' + o.id : null,
        'aria-label': label, autocomplete: 'off', spellcheck: 'false'
      });
      const touch = () => {
        if (!o.apply) return;
        if (!open) { app.scene.begin(o.label || 'exact size'); open = true; }
        for (const it of o.items || []) app.scene.touch(it);
      };
      const set = v => {
        if (!isFinite(v)) { inp.value = show(cur); return; }
        if (o.wrap) v = ((v % o.wrap) + o.wrap) % o.wrap;
        if (o.min != null) v = Math.max(o.min, v);
        if (o.max != null) v = Math.min(o.max, v);
        cur = v; inp.value = show(v);
        if (o.apply) { touch(); o.apply(v); app.requestDraw(); }
        if (o.set) o.set(v);
      };
      const end = () => { if (!open) return; open = false; app.scene.commit(); app.afterEdit(); };
      inp.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') inp.blur();
        else if (e.key === 'Escape') { inp.value = show(cur); inp.blur(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(+(cur + (e.key === 'ArrowUp' ? 1 : -1) * (o.step || 1)).toFixed(10)); end(); }
      });
      inp.addEventListener('focus', () => inp.select());
      inp.onchange = () => {
        const v = D.cad ? D.cad.parse(inp.value, o.unit) : parseFloat(inp.value);
        if (isFinite(v) && Math.abs(v - cur) > 1e-12) { set(v); end(); } else inp.value = show(cur);
      };
      const stepper = (sign, glyph) => {
        const b = el('button', { class: 'num-step', title: sign > 0 ? 'More (hold to keep going)' : 'Less (hold to keep going)', 'aria-label': sign > 0 ? 'More' : 'Less' }, glyph);
        let wait, rep, n = 0;
        const tick = () => { n++; set(+(cur + sign * (o.step || 1) * (n > 14 ? 10 : 1)).toFixed(10)); };
        const stop = () => { clearTimeout(wait); clearInterval(rep); if (n) { n = 0; end(); } };
        b.addEventListener('pointerdown', e => {
          e.preventDefault();
          try { b.setPointerCapture(e.pointerId); } catch (_) { }
          tick();
          wait = setTimeout(() => { rep = setInterval(tick, 70); }, 420);
        });
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointercancel', stop);
        b.addEventListener('lostpointercapture', stop);
        return b;
      };
      return el('div', { class: 'num' },
        el('span', { class: 'num-lbl' }, label),
        el('div', { class: 'num-row' }, stepper(-1, '−'),
          el('label', { class: 'num-box' }, inp, o.unit ? el('span', { class: 'num-unit' }, o.unit) : null),
          stepper(1, '+')));
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
      const app = this.app, o = app.opts.shape, cad = app.opts.cad;
      const lineish = ['line', 'arrow', 'force', 'polyline'].includes(o.kind), open = lineish || o.kind === 'moment';
      const pick = v => { if (app.tools.shape.poly) app.tools.shape.cancel(); o.kind = v; this.refresh(); };
      const heads = lineish && o.heads ? (o.heads[o.kind] || ['none', 'none']) : null;
      const setHead = (i, v) => { const h = heads.slice(); h[i] = v; o.heads[o.kind] = h; };
      this.add(
        this.group('Shape',
          this.iconSeg([['rect', ICON.rect, 'Rectangle'], ['ellipse', ICON.ellipse, 'Ellipse'], ['diamond', ICON.diamond, 'Diamond'], ['triangle', ICON.triangle, 'Triangle']], o.kind, pick),
          this.iconSeg([['line', ICON.line, 'Line'], ['arrow', ICON.arrow, 'Arrow'], ['polyline', ICON.polyline, 'Polyline'], ['force', ICON.force, 'Force arrow'], ['moment', ICON.moment, 'Moment arrow']], o.kind, pick)),
        app.tools.shape.poly ? this.group('', el('button', { class: 'btn primary', onclick: () => app.tools.shape.finishPoly() }, 'Finish the line')) : null,
        this.group('Stroke', this.swatches(this.palette(), o.color, c => o.color = c)),
        !open ? this.group('Fill', this.swatches(FILL, o.fill, c => o.fill = c, false)) : null,
        this.group('Weight', this.sizes([1.5, 3, 5, 8], o.size, s => o.size = s, o.color)),
        this.group('Line', this.lineStyles(o.dash, v => o.dash = v)),
        heads ? this.endsGroup(heads, setHead) : null,
        open ? this.group('Head size', this.seg([[0.7, 'S'], [1, 'M'], [1.4, 'L'], [2, 'XL']], o.headScale || 1, v => o.headScale = v)) : null,
        o.kind === 'moment' ? this.group('Turns', this.seg([[true, '↺ Anticlockwise'], [false, '↻ Clockwise']], o.ccw !== false, v => o.ccw = v)) : null,
        !open && cad ? this.group('Draw',
          this.check('Square / circle', !!cad.square, v => { cad.square = v; }),
          this.check('From the centre', !!cad.centre, v => { cad.centre = v; })) : null,
        lineish && cad ? this.group('Angles', this.check('Only 15° steps', !!cad.ortho, v => { cad.ortho = v; })) : null,
        this.slider('Opacity', o.alpha, 0.1, 1, 0.05, v => o.alpha = v, v => Math.round(v * 100) + '%'),
        o.kind === 'rect' ? this.slider('Corners', o.radius, 0, 40, 1, v => o.radius = v) : null,
        D.cad ? D.cad.snapGroup(this) : null,
        o.kind === 'polyline' ? this.hintText('Lift the pen at each corner. Tap the last point again — or press Enter — to finish.') : null
      );
    }

    /** the five line styles, drafting's included */
    lineStyles(current, onpick) {
      return this.iconSeg([[0, this.dashIcon(0), 'Solid'], [1, this.dashIcon(1), 'Dashed'], [2, this.dashIcon(2), 'Dotted'],
        [3, this.dashIcon(3), 'Centre line (dash-dot)'], [4, this.dashIcon(4), 'Hidden line']], current || 0, onpick);
    }

    /** a head style for each end of a line */
    endsGroup(heads, onpick) {
      const styles = ['none', 'open', 'filled', 'half', 'tick', 'dot'];
      const names = { none: 'No head', open: 'Open', filled: 'Filled', half: 'Half', tick: 'Tick', dot: 'Dot' };
      return this.group('Ends',
        el('div', { class: 'rowlbl' }, el('span', {}, 'Start')),
        this.iconSeg(styles.map(s => [s, this.headIcon(s, true), names[s]]), heads[0], v => onpick(0, v)),
        el('div', { class: 'rowlbl' }, el('span', {}, 'End')),
        this.iconSeg(styles.map(s => [s, this.headIcon(s), names[s]]), heads[1], v => onpick(1, v)));
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
        this.group('', el('button', { class: 'btn', onclick: () => this.openSettings() }, 'All settings…'))
      );
    }

    /** restyle `items` as one undo step, then show the result */
    apply(items, fn) {
      const app = this.app;
      app.scene.begin('style');
      for (const it of items) { app.scene.touch(it); fn(it); }
      app.scene.commit();
      app.requestDraw(); app.markDirty(); this.buildPanel();
    }

    panelForSelection(sel) {
      const app = this.app;
      const first = sel[0];
      const has = t => sel.some(i => i.type === t);
      const apply = fn => this.apply(sel, fn);

      /* a registered type with a panel of its own, when it is all that is
         selected: its controls, then the usual Arrange row */
      const xt = D.ext.items[first.type];
      if (xt && xt.panel && sel.every(i => i.type === first.type)) {
        xt.panel(this, sel);
        this.add(this.arrangeGroup(sel));
        return;
      }

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
        ...this.lineGroups(sel),
        this.measureGroup(sel),
        this.calibrateFor(sel),
        this.arrangeGroup(sel)
      );
    }

    /* Line style for shapes and connectors; ends, head size and the bend
       for lines and arrows; the turn of a moment arrow. */
    lineGroups(sel) {
      const shapes = sel.filter(i => i.type === 'shape' || i.type === 'edge');
      if (!shapes.length) return [];
      const lines = sel.filter(D.isLine), opens = sel.filter(D.isOpenShape), apply = fn => this.apply(sel, fn);
      const out = [this.group('Line', this.lineStyles(shapes[0].dash, v => apply(it => { if (it.type === 'shape' || it.type === 'edge') it.dash = v; })))];
      if (lines.length) {
        const heads = D.headsOf(lines[0]);
        out.push(this.endsGroup(heads, (i, v) => apply(it => { if (D.isLine(it)) { const h = D.headsOf(it); h[i] = v; it.head1 = h[0]; it.head2 = h[1]; delete it.arrowStart; } })));
      }
      if (opens.length) out.push(this.group('Head size', this.seg([[0.7, 'S'], [1, 'M'], [1.4, 'L'], [2, 'XL']], opens[0].headScale || 1,
        v => apply(it => { if (D.isOpenShape(it)) it.headScale = v; }))));
      const m = sel.length === 1 && sel[0].kind === 'moment' && sel[0];
      if (m) out.push(this.group('Turns', this.seg([[true, '↺ Anticlockwise'], [false, '↻ Clockwise']], (m.sweep ?? 270) > 0,
        v => apply(it => { const s = it.sweep ?? 270; if ((s > 0) !== v) { it.a0 = (it.a0 || 0) + s; it.sweep = -s; } }))));
      if (lines.some(l => l.curve)) out.push(this.group('', el('button', { class: 'btn', onclick: () => apply(it => { delete it.curve; }) }, 'Straighten')));
      return out;
    }

    /**
     * Exact sizes for one selected thing, in the board's units (cad.js):
     * a line's length and angle; a moment's radius and sweep; anything
     * else's width, height and the position of its centre. Y counts up
     * the page and angles anticlockwise from east, as on paper.
     */
    measureGroup(sel) {
      if (sel.length !== 1 || !D.cad) return null;
      const it = sel[0], app = this.app, scene = app.scene, C = D.cad;
      const S = C.scaleOf(scene), k = S.k, unit = S.unit, prec = S.prec, items = [it];
      const len = (label, v, apply, extra) => this.num(label, v * k, { unit, prec, step: C.stepFor(v * k), min: 0, items, apply: x => apply(x / k), ...extra });
      if (D.isLine(it)) {
        if (it.via) return this.group('Size', this.hintText('Total length ' + C.fmtLen(scene, U.pathLength(scene.linePath(it)))));
        const [a, b] = scene.lineEnds(it);
        const L = Math.hypot(b.x - a.x, b.y - a.y), ang = C.angleOf(b.x - a.x, b.y - a.y);
        // the start stays put; the end lets go of anything it was attached to
        const put = (l, deg) => {
          const r = deg * Math.PI / 180;
          it.x = a.x; it.y = a.y; it.w = Math.cos(r) * l; it.h = -Math.sin(r) * l;
          delete it.bind2;
        };
        return this.group('Size',
          len('Length', L, l => put(l, C.angleOf(it.w, it.h)), { id: 'cad-len', min: 1e-6 }),
          this.num('Angle', ang, { unit: '°', prec: 2, step: 1, wrap: 360, items, id: 'cad-ang', apply: d => put(Math.hypot(it.w, it.h), d) }));
      }
      if (it.type === 'shape' && it.kind === 'moment') {
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
        return this.group('Size',
          len('Radius', Math.abs(it.w) / 2, r => { it.x = cx - r; it.y = cy - r; it.w = it.h = 2 * r; }, { min: 1e-6 }),
          this.num('Sweep', Math.abs(it.sweep ?? 270), { unit: '°', prec: 1, step: 5, min: 10, max: 359, items,
            apply: d => { const s = it.sweep ?? 270; const end = (it.a0 || 0) + s; it.sweep = Math.sign(s) * d; it.a0 = end - it.sweep; } }));
      }
      if (!['shape', 'note', 'node', 'image'].includes(it.type)) return null;
      const g = D.geomBox(scene, it);
      const cx = g.x + g.w / 2, cy = g.y + g.h / 2;
      const norm = () => { if (it.w < 0) { it.x += it.w; it.w = -it.w; } if (it.h < 0) { it.y += it.h; it.h = -it.h; } };
      return this.group('Size and position',
        el('div', { class: 'num-pair' },
          len('W', g.w, w => { norm(); it.w = Math.max(w, 1e-6); }, { min: 1e-6 }),
          len('H', g.h, h => { norm(); it.h = Math.max(h, 1e-6); }, { min: 1e-6 })),
        el('div', { class: 'num-pair' },
          this.num('X', cx * k, { unit, prec, step: C.stepFor(Math.max(g.w, g.h) * k), items, apply: x => { norm(); it.x = x / k - it.w / 2; } }),
          this.num('Y ↑', -cy * k, { unit, prec, step: C.stepFor(Math.max(g.w, g.h) * k), items, apply: y => { norm(); it.y = -y / k - it.h / 2; } })));
    }

    /** "this line is really …", to set the drawing scale from */
    calibrateFor(sel) {
      if (sel.length !== 1 || !D.cad || !D.isLine(sel[0]) || sel[0].via || sel[0].curve) return null;
      const [a, b] = this.app.scene.lineEnds(sel[0]);
      return D.cad.calibrateGroup(this, Math.hypot(b.x - a.x, b.y - a.y));
    }

    /** front, back, duplicate, group and delete, for whatever is selected */
    arrangeGroup(sel) {
      const app = this.app, grouped = sel.some(i => i.group);
      return this.group('Arrange', el('div', { class: 'actions' },
        iconBtn(ICON.front, 'Bring to front · ]', () => app.arrange('front')),
        iconBtn(ICON.back, 'Send to back · [', () => app.arrange('back')),
        iconBtn(ICON.dup, 'Duplicate · Ctrl+D', () => app.duplicate()),
        grouped ? iconBtn(ICON.ungroup, 'Ungroup · Ctrl+Shift+G', () => app.toggleGroup())
                : iconBtn(ICON.group, 'Group · Ctrl+G', () => app.toggleGroup()),
        iconBtn(ICON.trash, 'Delete · Del', () => app.deleteSelection(), 'danger')));
    }

    /* ── boards sheet ────────────────────────────────────────────── */
    /* Every board by name on the left; the one picked is shown on the
       right, large and movable, opening where it was left (BoardPreview),
       with what can be done to it underneath. Arrow keys walk the list,
       Enter opens, Escape closes. */
    buildSheet() {
      const app = this.app;
      $('#sheet-close').onclick = () => this.closeSheet();
      $('#sheet-backdrop').onclick = () => { this.closeSheet(); this.closeSettings(); };
      $('#settings-close').onclick = () => this.closeSettings();
      for (const a of document.querySelectorAll('[data-link]')) {
        a.onclick = e => { e.preventDefault(); D.desktop.open(D.desktop.links[a.dataset.link]); };
      }
      $('#act-new').onclick = () => app.newBoard();
      $('#act-import').onclick = () => { const f = $('#file-input'); f.accept = '.board,.json'; f.multiple = false; f.click(); };
      $('#act-help').onclick = () => this.showHelp($('#bs-help').hidden);

      this.preview = new D.BoardPreview($('#bs-preview'), $('#bs-canvas'), () => this.openSelected());
      this.preview.onPaint = () => { $('#bs-still').hidden = true; };
      $('#bs-reset').onclick = () => this.preview.home();
      $('#bs-open').onclick = () => this.openSelected();
      $('#bs-dup').onclick = async () => {
        const id = await app.duplicateBoard(this.selId);
        if (!id) return;
        this.boards = await D.store.list();
        this.renderBoards();
        this.selectBoard(id);
      };
      $('#bs-export').onclick = () => app.exportJSON(this.selId);
      $('#bs-delete').onclick = async () => {
        const b = this.selected();
        if (!b || !confirm(`Delete “${b.name}”? This cannot be undone.`)) return;
        const list = this.filtered(), i = list.findIndex(x => x.id === b.id);
        await app.deleteBoard(b.id);
        this.records.delete(b.id);
        this.boards = await D.store.list();
        this.renderBoards();
        const rest = this.filtered();
        this.selectBoard((rest[Math.min(i, rest.length - 1)] || {}).id || app.board.id);
      };

      const name = $('#bs-name');
      name.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') name.blur();
        if (e.key === 'Escape') { name.value = (this.selected() || {}).name || ''; name.blur(); }
      });
      name.addEventListener('change', async () => {
        const b = this.selected();
        if (!b || name.value.trim() === b.name) return;
        await app.renameBoard(b.id, name.value);
        this.records.delete(b.id);
        this.boards = await D.store.list();
        this.renderBoards();
        this.selectBoard(b.id);
      });

      const s = $('#board-search');
      s.oninput = () => {
        this.renderBoards();
        const list = this.filtered();
        if (list.length && !list.some(b => b.id === this.selId)) this.selectBoard(list[0].id);
      };
      s.addEventListener('keydown', e => {
        if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) this.sheetKey(e);
        e.stopPropagation();
      });

      this.records = new Map();         // id → Scene, the last few boards looked at
    }

    /* Opens at once, on the board you are on: the list it was last shown
       with, then the fresh one when the store answers. It used to save the
       whole board first and wait for the write — on a big board long
       enough to click the button again. The open board's card is brought
       up to date here in memory instead (a copy of the screen, a few ms),
       and reaches the disk with the next save. */
    async openSheet() {
      if (!$('#sheet').hidden) return;
      const app = this.app;
      // the open board's picture: taken now, encoded off the main thread, swapped in when ready
      const shot = app.captureThumb();
      app.storeThumb(app.board, shot).then(() => {
        if ($('#sheet').hidden) return;
        this.boards = this.withOpenBoard(this.boards || []);
        const img = $('#board-list').querySelector(`[data-id="${app.board.id}"] img.mini`);
        if (img && app.board.thumb) img.src = app.board.thumb;
      }).catch(err => console.warn('[dpo] picture', err));
      app.board.name = $('#board-title').value || app.board.name;
      this.records.clear();
      $('#board-search').value = '';
      this.showHelp(false);
      $('#sheet').hidden = false; $('#sheet-backdrop').hidden = false;
      this.boards = this.withOpenBoard(this.boards || []);
      this.renderBoards();
      this.selectBoard(app.board.id);
      $('#board-search').focus();

      const list = await D.store.list();
      if ($('#sheet').hidden) return;
      this.boards = this.withOpenBoard(list);
      this.renderBoards();                // keeps the selection; the preview is left as it is
    }

    /** the board list, with the open board's entry as it is right now */
    withOpenBoard(list) {
      const b = this.app.board;
      const entry = { id: b.id, name: b.name, thumb: b.thumb, thumbTheme: b.thumbTheme,
        count: this.app.scene.items.length, updated: Date.now() };
      const i = list.findIndex(x => x.id === b.id);
      const out = list.slice();
      if (i < 0) out.unshift(entry); else out[i] = { ...list[i], ...entry, updated: list[i].updated || entry.updated };
      return out;
    }

    closeSheet() {
      if ($('#sheet').hidden) return;
      $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true;
      this.preview.clear();
      this.records.clear();             // other boards' contents: let them go
    }

    /** keys while the sheet is open (App.onKey sends them here) */
    sheetKey(e) {
      const list = this.filtered();
      const i = list.findIndex(b => b.id === this.selId);
      if (e.key === 'Escape') { e.preventDefault(); this.closeSheet(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.openSelected(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = list[U.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, list.length - 1)];
        if (next) this.selectBoard(next.id);
      }
    }

    filtered() {
      const q = ($('#board-search').value || '').trim().toLowerCase();
      return (this.boards || []).filter(b => !q || (b.name || '').toLowerCase().includes(q));
    }

    selected() { return (this.boards || []).find(b => b.id === this.selId) || null; }

    renderBoards() {
      const app = this.app, box = $('#board-list');
      const q = ($('#board-search').value || '').trim();
      box.textContent = '';
      const list = this.filtered();
      if (!list.length) {
        box.append(el('div', { class: 'board-empty' }, q ? `Nothing matching “${q}”` : 'No boards yet'));
        return;
      }
      const narrow = matchMedia('(max-width:720px)');
      for (const b of list) {
        const current = b.id === app.board.id;
        const mini = b.thumb
          ? el('img', { class: 'mini', src: b.thumb, alt: '', loading: 'lazy', draggable: 'false' })
          : el('span', { class: 'mini' });
        const item = el('button', { class: 'bs-item' + (b.id === this.selId ? ' sel' : ''), role: 'option', 'data-id': b.id, title: b.name || 'Untitled' },
          mini,
          el('span', { class: 'tx' },
            el('span', { class: 'nm' }, b.name || 'Untitled'),
            el('span', { class: 'dt' }, current ? el('span', { class: 'now' }, 'open') : null, when(b.updated))));
        item.onclick = () => { if (narrow.matches) this.openBoard(b.id); else this.selectBoard(b.id); };
        item.ondblclick = () => this.openBoard(b.id);
        box.append(item);
      }
    }

    /** show a board on the right */
    async selectBoard(id) {
      const app = this.app, b = (this.boards || []).find(x => x.id === id);
      this.selId = id;
      for (const n of $('#board-list').children) {
        const on = n.dataset && n.dataset.id === id;
        n.classList.toggle('sel', on);
        n.setAttribute('aria-selected', on ? 'true' : 'false');
        /* after the frame: scrolling first would force a layout of the
           whole sheet before it has even been shown */
        if (on) requestAnimationFrame(() => n.scrollIntoView({ block: 'nearest' }));
      }
      this.showHelp(false);
      const current = !!b && id === app.board.id;
      for (const k of ['#bs-open', '#bs-dup', '#bs-export', '#bs-delete', '#bs-name']) $(k).disabled = !b;
      $('#bs-name').value = b ? b.name || 'Untitled' : '';
      $('#bs-meta').textContent = b
        ? `${(b.count || 0).toLocaleString()} item${b.count === 1 ? '' : 's'} · ${current ? 'open now' : 'edited ' + when(b.updated)}`
        : '';
      $('#bs-open').textContent = current ? 'Back to board' : 'Open board';

      // the saved picture straight away; the live board replaces it once it has loaded
      const still = $('#bs-still');
      still.hidden = !(b && b.thumb);
      still.src = (b && b.thumb) || '';
      $('#bs-empty').hidden = true;
      if (!b) { this.preview.clear(); return; }

      const token = this._sel = (this._sel || 0) + 1;
      let scene, view, getAsset;
      if (current) {
        scene = app.scene;
        view = app.camera.toJSON();
        getAsset = aid => app.getAsset(aid);
      } else {
        scene = await this.recordScene(id);
        if (token !== this._sel) return;          // picked something else meanwhile
        if (!scene) { $('#bs-meta').textContent = 'Could not read this board'; return; }
        view = D.readView(id) || scene._camera || null;
        getAsset = aid => D.store.getAsset(aid);
      }
      $('#bs-empty').hidden = scene.items.length > 0;
      this.preview.show(scene, view, getAsset);
    }

    /** a board that is not open, loaded for looking at; kept for the last few picked */
    async recordScene(id) {
      if (this.records.has(id)) return this.records.get(id);
      const rec = await D.store.load(id);
      if (!rec) return null;
      const scene = new D.Scene(rec.doc);
      scene._camera = rec.camera;
      this.records.set(id, scene);
      while (this.records.size > 4) this.records.delete(this.records.keys().next().value);
      return scene;
    }

    openSelected() { if (this.selId) this.openBoard(this.selId); }

    /* Opening a big board takes a moment to read: say so at once, and
       ignore the clicks that would otherwise queue up behind it. */
    async openBoard(id) {
      if (this._opening) return;
      if (id === this.app.board.id) { this.closeSheet(); return; }
      this._opening = true;
      const btn = $('#bs-open');
      $('#sheet').classList.add('busy');
      btn.textContent = 'Opening…';
      try { await this.app.openBoard(id); }
      finally {
        this._opening = false;
        $('#sheet').classList.remove('busy');
        this.closeSheet();
      }
    }

    showHelp(on) {
      $('#bs-help').hidden = !on;
      $('#act-help').classList.toggle('on', on);
    }

    /* ── settings ────────────────────────────────────────────────── */
    /* Everything that is not about the ink in your hand: where boards are
       kept, how the canvas looks, what the pen and touch do, updates, and
       help. Laid out as the boards sheet is — the sections on the left,
       the one picked on the right — and rebuilt on every open, so it shows
       the state as it is now rather than as it was when the page loaded. */
    async openSettings(section) {
      this.closeSheet();
      const X = D.desktop;
      this._cfg = X.on ? await X.config().catch(() => null) : null;
      const sections = this.settingsSections();
      let pick = section || (() => { try { return localStorage.getItem('dpo:settings-tab'); } catch (_) { return null; } })();
      if (!sections.some(s => s.id === pick)) pick = sections[0].id;

      const nav = $('#settings-nav');
      nav.textContent = '';
      for (const s of sections) {
        const b = el('button', { class: 'set-tab', 'data-id': s.id, html: s.icon });
        b.append(s.title);
        b.onclick = () => this.showSettings(s.id);
        nav.append(b);
      }
      $('#settings-version').textContent = this._cfg ? 'Version ' + this._cfg.version : '';
      $('#settings').hidden = false; $('#sheet-backdrop').hidden = false;
      this.showSettings(pick);
    }
    closeSettings() { $('#settings').hidden = true; $('#sheet-backdrop').hidden = true; }

    showSettings(id) {
      const s = this.settingsSections().find(x => x.id === id);
      if (!s) return;
      for (const b of $('#settings-nav').children) b.classList.toggle('sel', b.dataset.id === id);
      $('#settings-title').textContent = s.title;
      $('#settings-sub').textContent = s.sub;
      const body = $('#settings-body');
      body.textContent = '';
      body.append(...[].concat(s.build() || []).filter(Boolean));
      body.scrollTop = 0;
      try { localStorage.setItem('dpo:settings-tab', id); } catch (_) { }
    }

    settingsSections() {
      const X = D.desktop;
      const icon = d => svg(d);
      return [
        { id: 'saving', title: 'Saving', sub: 'Where your boards are kept', icon: icon('M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'), build: () => this.setStorage(this._cfg) },
        { id: 'canvas', title: 'Canvas', sub: 'How the board looks', icon: icon('M4 5h16v14H4z|M4 10h16|M9 5v14'), build: () => this.setCanvas() },
        { id: 'pen', title: 'Pen and touch', sub: 'What the pen, your fingers and the tools do', icon: ICON.pen, build: () => this.setInput() },
        { id: 'export', title: 'Export', sub: 'How PNG and SVG exports come out', icon: icon('M12 4v11|M7.5 10.5L12 15l4.5-4.5|M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3'), build: () => this.setExport() },
        X.on ? { id: 'updates', title: 'Updates', sub: 'New versions, from GitHub', icon: icon('M20 11a8 8 0 1 0-2.3 5.7|M20 5v6h-6'), build: () => this.setUpdates(this._cfg) } : null,
        // what features add (ext.js), ahead of Help, which stays last
        ...D.ext.settings.map(x => ({
          id: x.id, title: x.title, sub: x.sub || '',
          icon: iconOf(x.icon || 'M4 7h9|M17 7h3|M4 17h3|M11 17h9|M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z|M9 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'),
          build: () => x.render(this)
        })),
        { id: 'help', title: 'Help', sub: 'Shortcuts, and where to ask for things', icon: icon('M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z|M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.1-2.4 3.6|M12 17.2v.1'), build: () => this.setHelp() }
      ].filter(Boolean);
    }

    /* the pieces each section is made of */
    setGroup(...rows) { return el('div', { class: 'set-group' }, ...rows.filter(Boolean)); }
    setLabel(title, desc) { return el('div', { class: 'set-lbl' }, el('span', {}, title), desc ? el('small', {}, desc) : null); }
    setRow(title, desc, control) { return el('div', { class: 'set-row' }, this.setLabel(title, desc), control); }
    setStack(...kids) { return el('div', { class: 'set-row stack' }, ...kids.filter(Boolean)); }
    setNote(text) { return el('p', { class: 'set-note' }, text); }
    setButton(label, onclick, primary) { return el('button', { class: 'btn' + (primary ? ' primary' : ''), onclick }, label); }
    setToggle(title, desc, value, onchange) {
      const i = el('input', { type: 'checkbox', class: 'switch', 'aria-label': title });
      i.checked = value;
      i.onchange = () => onchange(i.checked);
      const r = this.setRow(title, desc, i);
      r.onclick = e => { if (e.target !== i) { i.checked = !i.checked; onchange(i.checked); } };
      r.style.cursor = 'pointer';
      return r;
    }

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
      const path = text => el('div', { class: 'set-path' }, text);

      if (!X.on) {
        const where = {
          host: 'In your Obsidian vault, by the Draw · Plan · Order plugin',
          indexedDB: 'In this browser, on this computer',
          localStorage: 'In this browser’s local storage, on this computer',
          memory: 'Nowhere — this board is not being saved',
          scratch: 'Nowhere — a ?scratch board is thrown away when you close it'
        }[D.store.backend] || 'In this browser';
        return [this.setGroup(this.setStack(this.setLabel('Boards are kept'), path(where))),
          this.setNote(D.store.backend === 'host'
            ? 'The folder is set in the plugin’s settings inside Obsidian.'
            : 'Each browser keeps its own boards. Export a board from the boards list to move it elsewhere, or use the desktop app to keep boards as files in a folder you choose.')];
      }

      const choose = this.setButton(cfg && cfg.dir ? 'Change folder…' : 'Choose a folder…', async () => {
        await app.saveNow(true);              // the board on screen belongs to where it came from
        let next;
        try { next = await X.chooseFolder(); }
        catch (err) { app.toast('Could not use that folder: ' + err); return; }
        if (next) location.replace(location.pathname);    // start again against the new folder
      });

      if (!cfg || !cfg.dir) {
        let copied = false;
        try { copied = !localStorage.getItem('dpo:migrated-to-vault'); } catch (_) { }
        return [this.setGroup(this.setStack(this.setLabel('Boards are kept'), path('Inside the app, on this computer'),
          el('div', { class: 'set-actions' }, choose))),
          this.setNote('Choose a folder to keep boards as ordinary files you can back up, sync, or open from Obsidian.' +
            (copied ? ' The boards you have now are copied into it.' : ''))];
      }

      return [
        this.setGroup(this.setStack(
          this.setLabel('Boards are kept in', cfg.obsidian ? 'An Obsidian vault: the Draw · Plan · Order plugin opens these same boards.' : null),
          path(cfg.dir),
          el('div', { class: 'set-actions' }, choose,
            this.setButton('Open folder', () => X.revealFolder().catch(err => app.toast('Could not open the folder: ' + err)))))),
        this.setNote('Changing the folder leaves the boards already saved where they are; switch back to reach them.')
      ];
    }

    setCanvas() {
      const app = this.app, dark = () => document.documentElement.dataset.theme === 'dark';
      return [this.setGroup(
        this.setRow('Theme', 'Also on the moon button in the top bar', this.setSeg([['light', 'Light'], ['dark', 'Dark']], dark() ? 'dark' : 'light',
          v => { if ((v === 'dark') !== dark()) app.toggleTheme(); })),
        this.setRow('Paper', 'What the board is printed with', this.setSeg([['dots', 'Dots'], ['lines', 'Grid'], ['lined', 'Ruled'], ['none', 'Plain']], app.renderer.grid,
          v => { app.renderer.grid = v; app.requestDraw(); app.savePrefs(); })))];
    }

    /* PNG and SVG exports. The theme decides what "ink" comes out as and
       whether PDF pages are light or dark; it can follow the screen or be
       pinned, so a board worked on at night still exports for a white
       slide. Transparent is the default: the work alone, nothing behind. */
    setExport() {
      const o = this.app.opts.export, save = () => this.app.savePrefs();
      return [this.setGroup(
        this.setRow('Theme', 'Sets the colour of default ink and of PDF pages, whatever the app is showing',
          this.setSeg([['auto', 'Match the app'], ['light', 'Light'], ['dark', 'Dark']], o.theme, v => { o.theme = v; save(); })),
        this.setRow('Background', 'Transparent keeps only what is on the board, ready for a slide or page of any colour',
          this.setSeg([['transparent', 'Transparent'], ['paper', 'Paper colour']], o.background, v => { o.background = v; save(); }))),
        this.setNote('Export from the download button in the top bar.')];
    }

    setInput() {
      const g = this.app.opts.general, set = (k, v) => { g[k] = v; this.app.savePrefs(); this.refresh(); };
      return [this.setGroup(
        this.setToggle('Hold to snap shapes', 'Hold the pen still at the end of a stroke to turn it into a clean line, box or circle', g.holdToSnap, v => set('holdToSnap', v)),
        this.setToggle('Scribble to erase', 'Scribble back and forth over ink to rub it out', g.scribbleErase, v => set('scribbleErase', v)),
        this.setToggle('Snap to grid', 'Shapes, notes and nodes line up with the paper', g.snapGrid, v => set('snapGrid', v)),
        this.setToggle('Fingers pan and zoom', 'A finger moves the board instead of drawing, so a resting hand leaves no marks', g.touchPan, v => set('touchPan', v)),
        this.setToggle('Keep the tool', 'Stay on the shape, note or node tool after making one', g.stickyTools, v => set('stickyTools', v)))];
    }

    setUpdates(cfg) {
      const app = this.app, X = D.desktop;
      const status = el('div', { class: 'set-status' });
      const check = this.setButton('Check now', async () => {
        check.disabled = true;
        status.textContent = 'Checking…';
        try {
          const u = await X.checkUpdate();
          status.textContent = u ? `Version ${u.version} is ready to install.` : 'You have the newest version.';
          if (u) status.append(' ', this.setButton('Install and restart', () => app.installUpdate(u), true));
        } catch (err) {
          status.textContent = 'Could not reach GitHub to check: ' + err;
        }
        check.disabled = false;
      });
      return [this.setGroup(
        this.setRow('Version', null, el('span', { class: 'set-version' }, cfg ? cfg.version : '…')),
        this.setToggle('Check when the app starts', 'Offers an update when there is one; nothing installs without asking', X.autoUpdate, v => { X.autoUpdate = v; }),
        this.setStack(el('div', { class: 'set-actions' }, check, this.setButton('What’s new', () => X.open(X.links.releases))), status))];
    }

    setHelp() {
      const X = D.desktop, go = k => () => X.open(X.links[k]);
      const keys = $('#bs-help .keys').cloneNode(true);
      return [
        this.setGroup(this.setStack(this.setLabel('Keyboard and pen shortcuts'), keys)),
        this.setGroup(this.setStack(
          this.setLabel('Ideas and problems', 'Something missing, or something that would make this better to work with? Requests and bug reports live on GitHub (you will need a free account to post one).'),
          el('div', { class: 'set-actions' }, this.setButton('Suggest a feature', go('feature')), this.setButton('Report a problem', go('bug')))))
      ];
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
    const x = D.ext.items[it.type];
    return { stroke: 'Ink', shape: 'Shape', text: 'Text', note: 'Sticky note', node: 'Node', edge: 'Connector', image: 'Image' }[it.type] ||
      (x && x.label) || 'Item';
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
  D.svgIcon = svg;
})(window.DPO);

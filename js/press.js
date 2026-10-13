/* ── press.js ── the long-press menu and the selection action bar ─────
   What a pen or a finger gets in place of a right button and a keyboard.
   Holding still on the board arms a ring at that spot: lift, and a menu
   opens there; drag on instead, and it draws a selection. Whatever is
   selected gets a bar of actions just above it. The gestures themselves
   — when a hold is a hold, what a tap or a double-tap does — are worked
   out in app.js (armHold, onHold, dragFromHold, onTap) and taps.js
   (Hold); this file
   is what they open.

   ── For features: D.ext.pressActions ───────────────────────────────

   D.ext.pressActions.push({ id, label, icon, order, when(ctx), run(ctx) })

     Offered in the long-press menu, and in the action bar whenever
     when(ctx) passes for the selection. Sorted by order (default 100),
     after the built-in actions. icon is an <svg> string or path data in
     the ICON style ('M…|M…', 24×24, stroked); without one, the action
     bar shows the label as text. when() is optional (always offered)
     and is asked each time the menu opens or the selection changes —
     not per frame — so it may look around the scene, but should not be
     slow. A when() or run() that throws is logged and skipped.

     ctx = {
       app,            the App
       x, y,           world point: where the press was (menu), or the
                       centre of the selection (bar)
       sx, sy,         the same, in screen (CSS) px
       hit,            the item under the press, or null. On the bar,
                       the selected item if there is exactly one.
                       Under a drawing tool a PDF page or picture is hit
                       but NOT selected: the press was writing on it.
       selection,      a copy of app.selection when the menu opened
                       (the press selects what it lands on first)
       pointerType,    'touch' | 'pen' | 'mouse' (a right click)
       source,         'menu' | 'bar' — where the action is shown; an
                       action that only makes sense at a point ("new
                       block here") checks for 'menu'
       close()         closes the menu (no-op on the bar). The menu
                       closes itself before run() is called anyway.
     }

   ── Options and settings ─────────────────────────────────────────────

   app.opts.press = { hold, pen, delay, bar, drag, lastSelect }, saved
   with the prefs: long-press on for fingers, and for the pen too; the
   hold in ms; when the action bar shows — 'touch' (after a pen or finger
   pressed: the mouse and keyboard keep the style panel to themselves),
   'always' or 'off'; what a hold-and-drag draws — 'tool' (whichever of
   the select tool's box and lasso was picked last, which App.setTool
   keeps in lastSelect), 'box' or 'lasso'. Settings → Touch and hold sets
   all but lastSelect.                                                  */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;

  D.ext.opts.press = { hold: true, pen: true, delay: 500, bar: 'touch', drag: 'tool', lastSelect: 'select' };

  const svg = d => `<svg viewBox="0 0 24 24">${d.split('|').map(p => `<path d="${p}"/>`).join('')}</svg>`;
  const iconOf = s => !s ? '' : /^\s*</.test(s) ? s : svg(s);

  const ICON = {
    copy: svg('M9 8.5h10.5V20H9z|M15 8.5V4H4.5v11.5H9'),
    cut: svg('M6.5 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M17.5 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z|M8.3 16.2L17 3.5|M15.7 16.2L7 3.5'),
    dup: svg('M9 9h11v11H9z|M15 5.5V4H4v11h1.5'),
    trash: svg('M5 7h14|M9 7V5h6v2|M7 7l1 13h8l1-13'),
    front: svg('M12 3.4v9.2|M8.2 7.2L12 3.4l3.8 3.8|M4.5 15.5h15v5h-15z'),
    back: svg('M12 20.6v-9.2|M8.2 16.8L12 20.6l3.8-3.8|M4.5 8.5h15v-5h-15z'),
    group: svg('M4 8V4h4|M16 4h4v4|M20 16v4h-4|M8 20H4v-4|M9.5 9.5h5v5h-5z'),
    ungroup: svg('M3.5 4h7v7h-7z|M13.5 13h7v7h-7z'),
    edit: svg('M4 20l4.5-1.2L20 7.3a2 2 0 0 0 0-2.8l-.5-.5a2 2 0 0 0-2.8 0L5.2 15.5z|M14.5 6.5l3 3'),
    paste: svg('M9 3.5h6v3H9z|M9 5H6.5A1.5 1.5 0 0 0 5 6.5v12A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 5H15'),
    here: svg('M12 2.5v4|M12 17.5v4|M2.5 12h4|M17.5 12h4|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'),
    insert: svg('M4 16l4.5-4.5 3.5 3.5|M13 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7|M15 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|M18 16v6|M15 19h6'),
    all: svg('M4 8V4h4|M16 4h4v4|M20 16v4h-4|M8 20H4v-4|M11 4h2|M11 20h2|M4 11v2|M20 11v2'),
    page: svg('M4 5h16v14H4z|M4 16l4.5-4.5 4 4L16 12l4 4'),
    undo: svg('M9 14L4 9l5-5|M4 9h10a6 6 0 0 1 0 12H9'),
    redo: svg('M15 14l5-5-5-5|M20 9H10a6 6 0 0 0 0 12h5'),
    hold: svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z')
  };

  const TEXTY = new Set(['text', 'note', 'node']);
  const BAR_TOP = 60;          // CSS px kept clear for the top bar
  const BAR_GAP = 16;          // between the selection's outline and the bar
  const EDGE = 8;              // nearest the menu and bar come to the window's edge

  /* ── what can be done ─────────────────────────────────────────────
     Each is { id, label, icon, run(app, ctx), danger, off }: `off` greys
     it out rather than hiding it, so the menu keeps its shape. */
  function selectionActions(app, sel) {
    const grouped = sel.some(i => i.group);
    const one = sel.length === 1 ? sel[0] : null;
    const edit = one && app.canEdit(one) ? {
      id: 'edit', icon: ICON.edit, run: () => app.editItem(one),
      label: one.type === 'edge' ? (one.label ? 'Edit label' : 'Add a label') : TEXTY.has(one.type) ? 'Edit text' : 'Edit'
    } : null;
    return {
      tiles: [
        { id: 'copy', label: 'Copy', icon: ICON.copy, run: () => { app.copy(); app.flash('Copied'); } },
        { id: 'cut', label: 'Cut', icon: ICON.cut, run: () => { app.copy(); app.deleteSelection(); } },
        { id: 'duplicate', label: 'Duplicate', icon: ICON.dup, run: () => app.duplicate() },
        { id: 'delete', label: 'Delete', icon: ICON.trash, run: () => app.deleteSelection(), danger: true }
      ],
      edit,
      front: { id: 'front', label: 'To front', icon: ICON.front, run: () => app.arrange('front') },
      back: { id: 'back', label: 'To back', icon: ICON.back, run: () => app.arrange('back') },
      group: grouped
        ? { id: 'group', label: 'Ungroup', icon: ICON.ungroup, run: () => app.toggleGroup() }
        : { id: 'group', label: 'Group', icon: ICON.group, run: () => app.toggleGroup(), off: sel.length < 2 }
    };
  }

  /** the features' actions for ctx, in order; a when() that throws counts as no */
  function extActions(ctx) {
    const out = [];
    for (const a of D.ext.pressActions) {
      let ok = true;
      try { ok = !a.when || !!a.when(ctx); } catch (err) { console.error('[dpo] press action ' + a.id, err); ok = false; }
      if (ok) out.push(a);
    }
    return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  class Press {
    constructor(app) {
      this.app = app;
      this.menu = null;          // the open long-press menu's element
      this.ctx = null;           // and what it was opened for
      this.label = null;         // { edge, el } while a connector label is being typed

      this.ringEl = el('div', { class: 'press-ring', 'aria-hidden': 'true',
        html: '<svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="28"/><circle class="arc" cx="32" cy="32" r="28" pathLength="100"/>' +
          // what a drag from the armed ring will draw (lock)
          '<rect class="mode box" x="22" y="24" width="20" height="16" rx="1.5"/><path class="mode loop" d="M32 22.5c7 0 11 3.4 11 7.3S39 37 32 37s-11-3.3-11-7.2 4-7.3 11-7.3z M27 36.2c-1 2.6 0 4.6 2.3 5.6"/></svg>' });
      this.arc = this.ringEl.querySelector('.arc');

      this.barEl = el('div', { class: 'press-bar', role: 'toolbar', 'aria-label': 'Selection actions' });
      /* the bar's buttons act on click like any other; this only keeps a
         press on the bar from reaching the outside-the-menu check */
      this.barEl.addEventListener('pointerdown', e => e.stopPropagation());
      this.bar = { shown: false, sel: null, ver: -1, w: 0, h: 0, x: NaN, y: NaN };
      document.body.append(this.ringEl, this.barEl);

      this.onOutside = this.onOutside.bind(this);
    }

    /* ── the arming ring ──────────────────────────────────────────── */
    /* Shown once a contact has been still for a moment (Hold), at the
       press, and runs down the time left — so the hold explains itself,
       and moving off visibly abandons it. Element.animate rather than a
       class: it starts from zero each time without forcing a layout. */
    ring(h) {
      const r = this.ringEl, size = h.type === 'touch' ? 84 : 60;
      this.stopRing();
      r.classList.remove('locked');
      r.style.width = r.style.height = size + 'px';
      r.style.transform = `translate(${h.x - size / 2}px,${h.y - size / 2}px)`;
      r.classList.add('on');
      const left = Math.max(60, h.t0 + h.delay - performance.now());
      this.ringAnims = [
        this.arc.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: left, easing: 'linear', fill: 'forwards' }),
        r.firstChild.animate([{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 160, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' })
      ];
    }

    unring() { this.stopRing(); this.ringEl.classList.remove('on', 'locked'); }

    stopRing() {
      for (const a of this.ringAnims || []) a.cancel();
      this.ringAnims = null;
    }

    /* The hold has fired and is armed (App.onHold): the ring locks full,
       in solid accent, with a little box or lasso in it for what a drag
       will draw from here — and stays until the press lifts or drags. A
       quick swell says "now", for a hand that is not looking at it. */
    lock(h, mode) {
      const r = this.ringEl;
      if (!r.classList.contains('on')) this.ring(h);
      this.stopRing();
      r.dataset.mode = mode === 'lasso' ? 'lasso' : 'box';
      r.classList.add('locked');
      this.ringAnims = [r.firstChild.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' })];
    }

    /* the menu has opened: one short pulse outward, then gone */
    pulse() {
      if (!this.ringEl.classList.contains('on')) return;
      this.stopRing();
      const a = this.ringEl.firstChild.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.45)' }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      this.ringAnims = [a];
      a.onfinish = () => { if (this.ringAnims && this.ringAnims[0] === a) this.unring(); };
    }

    /* ── the long-press menu ──────────────────────────────────────── */
    get menuOpen() { return !!this.menu; }

    openMenu(ctx) {
      const app = this.app;
      this.closeMenu();
      this.pulse();
      ctx.source = 'menu';
      ctx.close = () => this.closeMenu();
      this.ctx = ctx;

      const m = this.menu = el('div', { class: 'press-menu', role: 'menu', 'aria-label': ctx.selection.length ? 'Selection' : 'Board' });
      const button = (a, cls) => {
        // a blank where an icon would be, so labels without one still line up
        const b = el('button', { class: cls + (a.danger ? ' danger' : ''), role: 'menuitem', html: iconOf(a.icon) || '<i class="press-blank"></i>' },
          el('span', {}, a.label));
        if (a.off) b.disabled = true;
        b.onclick = () => this.run(a, ctx);
        return b;
      };
      const tile = a => button(a, 'press-tile');
      const row = a => button(a, 'press-row');
      const pair = (a, b) => el('div', { class: 'press-pair' }, row(a), row(b));

      const here = { id: 'paste-here', label: 'Paste here', icon: ICON.here, run: () => app.pasteFromClipboard({ x: ctx.x, y: ctx.y }) };
      const list = [];
      if (ctx.selection.length) {
        const s = selectionActions(app, ctx.selection);
        m.append(el('div', { class: 'press-tiles' }, s.tiles.map(tile)));
        if (s.edit) list.push(row(s.edit));
        list.push(pair(s.front, s.back), row(s.group), row(here));
      } else {
        m.append(el('div', { class: 'press-tiles' }, [
          { id: 'paste', label: 'Paste', icon: ICON.paste, run: () => app.pasteFromClipboard(null) },
          here,
          { id: 'insert', label: 'Picture or PDF', icon: ICON.insert, run: () => app.pickFile({ x: ctx.x, y: ctx.y }) },
          { id: 'select-all', label: 'Select all', icon: ICON.all, run: () => { app.setTool('select'); app.select(app.scene.items.slice()); }, off: !app.scene.items.length }
        ].map(tile)));
        if (ctx.hit && D.backdrop(ctx.hit)) {
          const it = ctx.hit;
          list.push(row({ id: 'select-page', label: it.type === 'pdfpage' ? 'Select this page' : it.type === 'image' ? 'Select this picture' : 'Select this',
            icon: ICON.page, run: () => app.select(app.groupOf(it)) }));
        }
      }
      for (const a of extActions(ctx)) list.push(row(a));
      if (list.length) m.append(el('div', { class: 'press-list' }, list));
      const sc = app.scene;
      m.append(el('div', { class: 'press-foot' },
        row({ id: 'undo', label: 'Undo', icon: ICON.undo, run: () => app.undo(), off: !sc.undoStack.length }),
        row({ id: 'redo', label: 'Redo', icon: ICON.redo, run: () => app.redo(), off: !sc.redoStack.length })));

      document.body.append(m);
      this.placeMenu(m, ctx);
      addEventListener('pointerdown', this.onOutside, true);
      app.requestDrawLive();          // the bar steps aside while the menu is up
    }

    /* Above the press, centred on it, where neither the finger nor the
       hand holding the pen covers it. With no room above, beside it — on
       whichever side has more room — rather than below, which is where
       the hand is. Below only when it fits nowhere else, and always
       wholly on screen. Measured once, as it opens. */
    placeMenu(m, ctx) {
      const w = m.offsetWidth, h = m.offsetHeight, W = innerWidth, H = innerHeight;
      const gap = ctx.pointerType === 'touch' ? 44 : 26;
      const fitY = y => U.clamp(y, EDGE, Math.max(EDGE, H - EDGE - h));
      let x = ctx.sx - w / 2, y = ctx.sy - gap - h;
      if (y < EDGE) {
        const right = W - EDGE - (ctx.sx + gap), left = ctx.sx - gap - EDGE;
        if (Math.max(right, left) >= w) {
          x = right >= left ? ctx.sx + gap : ctx.sx - gap - w;
          y = fitY(ctx.sy - h / 2);
        } else y = fitY(ctx.sy + gap);
      }
      x = U.clamp(x, EDGE, Math.max(EDGE, W - EDGE - w));
      m.style.left = x + 'px';
      m.style.top = y + 'px';
      m.style.transformOrigin = `${U.clamp(ctx.sx - x, 0, w)}px ${U.clamp(ctx.sy - y, 0, h)}px`;
    }

    closeMenu() {
      if (!this.menu) return;
      removeEventListener('pointerdown', this.onOutside, true);
      this.menu.remove();
      this.menu = null;
      this.ctx = null;
      this.app.requestDrawLive();
    }

    /* A press anywhere else closes the menu. On the board it does nothing
       more — a tap to dismiss should not also leave a dot or move the
       page — while on the rest of the chrome it goes on to do its job. */
    onOutside(e) {
      if (!this.menu || this.menu.contains(e.target)) return;
      this.closeMenu();
      if (e.target.closest && e.target.closest('#stage')) { e.stopPropagation(); e.preventDefault(); }
    }

    run(a, ctx) {
      this.closeMenu();
      try {
        const r = a.run(ctx);
        if (r && r.catch) r.catch(err => this.failed(a, err));
      } catch (err) { this.failed(a, err); }
    }

    failed(a, err) {
      console.error('[dpo] press action ' + a.id, err);
      this.app.toast(`${a.label} did not work: ${err && err.message || err}`);
    }

    /** Escape closes the menu (or abandons a label); true if it was ours */
    key(e) {
      if (e.key !== 'Escape') return false;
      if (this.menu) { this.closeMenu(); return true; }
      return false;
    }

    /** a different board: nothing open belongs to it */
    reset() {
      this.closeMenu();
      this.closeLabel(false);
      this.unring();
      this.hideBar();
      this.bar.sel = null;
    }

    /* ── the action bar ───────────────────────────────────────────── */
    /* Called from App.frame on every full repaint of the live layer, which
       is every frame of a pan or zoom and never a frame of inking. It
       costs a few comparisons and, when the selection's box has moved, one
       transform: the bar is only rebuilt (and measured) when the selection
       or the scene has changed, and no pointer is busy. */
    frame() {
      const app = this.app, b = this.bar;
      if (this.label) this.placeLabel();
      const box = app.selBox;
      if (!this.wantBar(box)) { this.hideBar(); return; }
      if (b.sel !== app.selection || b.ver !== app.scene.version) this.buildBar();
      if (!b.w) { this.hideBar(); return; }

      let y = box.y - BAR_GAP - b.h;
      if (y < BAR_TOP) {
        y = box.y + box.h + BAR_GAP;
        // a selection that fills the window: inside its top edge instead
        if (y + b.h > innerHeight - EDGE) y = U.clamp(box.y + BAR_GAP, BAR_TOP, innerHeight - EDGE - b.h);
      }
      const x = U.clamp(box.x + box.w / 2 - b.w / 2, EDGE, Math.max(EDGE, innerWidth - EDGE - b.w));
      if (x !== b.x || y !== b.y) {
        b.x = x; b.y = y;
        this.barEl.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
      }
      if (!b.shown) { b.shown = true; this.barEl.classList.add('on'); }
    }

    wantBar(box) {
      const app = this.app, o = app.opts.press || {};
      if (!box || !app.selection.length || o.bar === 'off' || (o.bar !== 'always' && !app.coarse)) return false;
      if (this.menu || this.label || app.editor.active) return false;
      // hidden while anything but a pan has the pointer: a drag, a resize, a marquee
      if (app.active && app.active !== app.tools.pan) return false;
      // nothing to hang it off once the selection has scrolled away
      return box.x + box.w > 0 && box.x < innerWidth && box.y + box.h > 0 && box.y < innerHeight;
    }

    hideBar() {
      const b = this.bar;
      if (!b.shown) return;
      b.shown = false;
      this.barEl.classList.remove('on');
    }

    buildBar() {
      const app = this.app, b = this.bar, sel = app.selection;
      b.sel = sel; b.ver = app.scene.version;
      const bounds = app.selectionBounds();
      if (!bounds) { b.w = 0; return; }
      const c = U.boxCenter(bounds), s = app.camera.toScreen(c.x, c.y);
      const ctx = {
        app, x: c.x, y: c.y, sx: s.x, sy: s.y, hit: sel.length === 1 ? sel[0] : null,
        selection: sel.slice(), pointerType: app.pointerType, source: 'bar', close() { }
      };
      const a = selectionActions(app, sel);
      const btn = x => {
        const k = el('button', { class: 'icon' + (x.danger ? ' danger' : '') + (x.icon ? '' : ' txt'), title: x.label, 'aria-label': x.label,
          html: x.icon ? iconOf(x.icon) : '' }, x.icon ? null : x.label);
        if (x.off) k.disabled = true;
        k.onclick = () => this.run(x, ctx);
        return k;
      };
      const sep = () => el('span', { class: 'sep' });
      const ext = extActions(ctx);
      const bar = this.barEl;
      bar.textContent = '';
      bar.append(...a.tiles.map(btn), sep(), btn(a.front), btn(a.back));
      if (!a.group.off) bar.append(btn(a.group));          // one loose item has nothing to group with
      if (a.edit) bar.append(sep(), btn(a.edit));
      if (ext.length) bar.append(sep(), ...ext.map(btn));
      b.w = bar.offsetWidth; b.h = bar.offsetHeight;
    }

    /* ── a connector's label, typed on the board ──────────────────── */
    editLabel(edge) {
      const app = this.app;
      this.closeMenu();
      this.closeLabel(true);
      app.select([edge]);
      const input = el('input', { class: 'press-label', type: 'text', spellcheck: 'false', autocomplete: 'off',
        placeholder: 'Label', 'aria-label': 'Connector label', enterkeyhint: 'done' });
      input.value = edge.label || '';
      input.addEventListener('pointerdown', e => e.stopPropagation());
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.closeLabel(true); }
        else if (e.key === 'Escape') { e.preventDefault(); this.closeLabel(false); }
      });
      input.addEventListener('blur', () => this.closeLabel(true));
      this.label = { edge, el: input };
      document.getElementById('overlay').append(input);
      this.placeLabel();
      requestAnimationFrame(() => { if (this.label && this.label.el === input) { input.focus(); input.select(); } });
      app.requestDrawLive();
    }

    /* centred on the label's spot, the middle of the line, as the painter puts it */
    placeLabel() {
      const app = this.app, L = this.label;
      if (!app.scene.get(L.edge.id)) { this.closeLabel(false); return; }
      const pts = app.scene.edgePath(L.edge), m = midOf(pts), p = app.camera.toScreen(m.x, m.y);
      L.el.style.left = p.x + 'px';
      L.el.style.top = p.y + 'px';
    }

    /** close the label field, keeping what was typed if `keep` */
    closeLabel(keep) {
      const L = this.label;
      if (!L) return;
      this.label = null;          // first: removing a focused field may blur it, which comes back here
      L.el.remove();
      if (keep) this.app.setLabel(L.edge, L.el.value);
      this.app.requestDrawLive();
    }
  }

  /** the point halfway along a polyline (as render.js finds a label's place) */
  function midOf(pts) {
    const total = U.pathLength(pts); let d = 0;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const l = U.dist(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      if (d + l >= total / 2) {
        const t = (total / 2 - d) / (l || 1);
        return { x: U.lerp(pts[i], pts[i + 2], t), y: U.lerp(pts[i + 1], pts[i + 3], t) };
      }
      d += l;
    }
    return { x: pts[0], y: pts[1] };
  }

  /* ── Settings → Touch and hold ──────────────────────────────────── */
  D.ext.settings.push({
    id: 'touch', title: 'Touch and hold', icon: ICON.hold,
    sub: 'The menu a held pen or finger opens, and the bar over a selection',
    render(ui) {
      const app = ui.app, o = app.opts.press, save = () => app.savePrefs();
      return [
        ui.setGroup(
          ui.setToggle('Hold for a menu', 'Hold a finger still on the board, then lift, for paste, pictures and PDFs, undo, and what you can do with the thing under it',
            o.hold, v => { o.hold = v; save(); }),
          ui.setToggle('With the pen too', 'Hold the pen still where it first touched. A stroke held still at its end still snaps to a shape instead',
            o.pen, v => { o.pen = v; save(); }),
          ui.setRow('How long to hold', 'A ring fills up while you hold; move off before it closes to carry on as normal',
            ui.setSeg([[350, 'Short'], [500, 'Medium'], [800, 'Long']], o.delay, v => { o.delay = v; save(); })),
          ui.setRow('Hold, then drag, to select', 'Once the ring locks, drag without lifting to draw a selection. Select tool follows whichever of box or lasso you last used it with',
            ui.setSeg([['tool', 'Select tool'], ['box', 'Box'], ['lasso', 'Lasso']], o.drag, v => { o.drag = v; save(); })),
          ui.setRow('Action bar', 'Copy, cut, delete, arrange and edit, just above what is selected',
            ui.setSeg([['touch', 'Pen and touch'], ['always', 'Always'], ['off', 'Off']], o.bar, v => { o.bar = v; save(); app.requestDrawLive(); }))),
        ui.setNote('Double-tap with the pen or a finger to edit text, notes and connector labels. With the select tool, tap with a finger to select, and drag what is selected with it. A selection made by holding and dragging moves with the same pen: press inside it and drag. A right click, or the pen’s barrel button, opens the same menu as holding.')
      ];
    }
  });

  D.Press = Press;
})(window.DPO);

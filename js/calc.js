/* ── calc.js ── the calculator panel and calc blocks ──────────────────
   Two ways to do sums on a board, both on the engine in js/math.js and
   both plugged in through D.ext (see ext.js), so no core file knows
   about either.

   The calculator: a floating keypad panel, from the top-bar button or
   Ctrl+K. Made for a pen and no keyboard — big keys in tabs (Basic,
   Functions, Calculus, Matrix, Units, Constants), a live answer while
   you type, a history to tap back into, and the variables you have set
   as chips. A keyboard works too. Variables and ans last for the board
   session (one scope per board, in memory). "Insert" puts the line on
   the board as a calc block — with the lines that define its variables —
   or as text.

   The calc block: a worksheet on the board (tool B). Each line is
   worked out, the answer right-aligned in the accent colour, and
   variables carry down the lines (F = 2 kN, L = 3 m, M = F*L → 6 kN·m).
   Double-click, a pen double-tap or F2 edits it in place; the keypad
   types into it while it is being edited.

   The answers are kept on the item (`res`, with the settings they were
   worked out under in `sig`), so painting a block never evaluates
   anything and a board full of them opens and draws without math.js
   loaded at all. They are worked out again when the block is edited, and
   when the settings they were made under change.

   ── The API ──────────────────────────────────────────────────────────

   D.calc.open(expr?)   open the calculator, the line set to expr if given
                        (for handwriting recognised as maths, say)
   D.calc.close(), D.calc.toggle(), D.calc.isOpen
   D.calc.newBlock(app, at, text, { edit }) → item
                        a calc block at world point `at` (its top-left),
                        worked out, added as one undo step; edit opens it
   D.calc.edit(app, item)        edit a block in place
   D.calc.recalc(item)           work a block's answers out again (needs
                                 D.math loaded; returns the line results)
   D.calc.layout(item)           its laid-out lines, cached in _lines

   ── The item ─────────────────────────────────────────────────────────

   { type: 'calc', x, y, text, size, res: [{ t } | { e } | null], sig, alpha }
   text   the lines, as typed
   res    per line: { t: answer } | { e: error } | null (blank, comment)
   sig    the settings `res` was worked out with                       */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;

  const svg = d => `<svg viewBox="0 0 24 24">${d.split('|').map(p => `<path d="${p}"/>`).join('')}</svg>`;
  const ICON = {
    calc: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z|M8.5 6.5h7v3.5h-7z|M9 13.6h.01|M12 13.6h.01|M15 13.6h.01|M9 17.2h.01|M12 17.2h.01|M15 17.2h.01',
    block: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z|M7.5 9h5|M7.5 14.5h4|M15.5 8.2h2|M15.5 10.2h2|M15.5 13.7h2|M15.5 15.7h2',
    close: 'M6 6l12 12|M18 6L6 18',
    fold: 'M6 14l6-6 6 6',
    unfold: 'M6 10l6 6 6-6',
    back: 'M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6z|M12 10l4 4|M16 10l-4 4',
    left: 'M14 6l-6 6 6 6',
    right: 'M10 6l6 6-6 6',
    keyboard: 'M3.5 7h17v10h-17z|M7 10h.01|M10 10h.01|M13 10h.01|M16 10h.01|M8 14h8',
    text: 'M5 6V4h14v2|M12 4v16|M9 20h6'
  };
  const ERR = '#e5484d';

  /* ── settings ────────────────────────────────────────────────────── */
  D.ext.opts.calc = { angle: 'deg', format: 'auto', sig: 5, exact: false, size: 16 };

  /** the app's calculator settings into the engine */
  function sync(app) {
    const o = app.opts.calc, c = D.math.config;
    c.angle = o.angle === 'rad' ? 'rad' : 'deg';
    c.format = ['auto', 'eng', 'sci', 'fixed'].includes(o.format) ? o.format : 'auto';
    c.sig = U.clamp(+o.sig || 5, 1, 12);
    c.exact = !!o.exact;
  }
  const sigNow = () => { const c = D.math.config; return [1, c.angle, c.format, c.sig, c.exact ? 1 : 0].join('|'); };

  /* ── calc blocks: layout ─────────────────────────────────────────── */
  let mctx = null;
  const measurer = () => mctx || (mctx = document.createElement('canvas').getContext('2d'));
  const LH = 1.6;

  /** an error, short enough to sit in the answer column */
  const short = e => e.length > 26 ? e.slice(0, 25) + '…' : e;

  /**
   * Where everything in a block goes, measured once and cached in _lines,
   * which the core clears whenever the block changes. Painting only reads
   * it. While a block is being edited it is laid out a little wider, so
   * the caret has room at the end of the longest line.
   */
  function layout(it) {
    const was = it._lines;
    if (was && was.calc) return was;
    const size = it.size || 16;
    const font = `${size}px ${D.FONT_STACK}`, bold = `600 ${size}px ${D.FONT_STACK}`, ital = `italic ${size}px ${D.FONT_STACK}`;
    const m = measurer();
    m.font = font;
    const lh = size * LH;
    const hg = m.measureText('Hg');
    const A = hg.fontBoundingBoxAscent, De = hg.fontBoundingBoxDescent;
    // the baseline where CSS puts it in a line box of height lh (see Scene.layout)
    const base = isFinite(A) && isFinite(De) ? (lh - (A + De)) / 2 + A : (lh - size) / 2 + size * 0.8;
    const res = it.res || [];
    let srcW = 0, resW = 0;
    const rows = String(it.text || '').split('\n').map((src, i) => {
      const r = res[i] || null;
      const comment = /^\s*(#|\/\/)/.test(src);
      m.font = comment ? ital : font;
      const sw = src ? m.measureText(src).width : 0;
      let out = '', kind = '';
      if (r && r.t) { out = r.t; kind = 'ok'; }
      else if (r && r.e) { out = short(r.e); kind = 'err'; }
      m.font = bold;
      const rw = out ? m.measureText(out).width : 0;
      srcW = Math.max(srcW, sw); resW = Math.max(resW, rw);
      return { src, out, kind, comment, sw, rw };
    });
    const pad = size * 0.9, bar = size * 0.2, gap = size * 2.4;
    const left = pad + bar + size * 0.45;
    const room = editor.item === it ? size * 3 : 0;
    const w = Math.ceil(Math.max(size * 10, left + srcW + room + (resW ? gap + resW : 0) + pad));
    const h = Math.ceil(pad * 2 + rows.length * lh);
    return (it._lines = { calc: true, rows, font, bold, ital, size, lh, base, pad, bar, left, w, h });
  }

  /** a #rrggbb colour at alpha a, or the colour itself if it is not one */
  const withAlpha = (c, a) => /^#[0-9a-f]{6}$/i.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, '0') : c;

  /* ── calc blocks: painting ───────────────────────────────────────── */
  function drawBlock(ctx, it, r) {
    const L = layout(it), size = L.size;
    const tok = r.tokens(), ink = U.color('ink');
    const z = r.paintZoom || (r.app && r.app.camera && r.app.camera.zoom) || 1;
    const x = it.x, y = it.y, rad = size * 0.55;

    ctx.beginPath();
    ctx.roundRect(x, y, L.w, L.h, rad);
    ctx.fillStyle = tok.panel;
    ctx.fill();
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = withAlpha(ink, 0.18);
    ctx.stroke();
    // the mark down the left that says "this one works things out"
    ctx.beginPath();
    ctx.roundRect(x + pad0(L), y + L.pad * 0.75, L.bar, L.h - L.pad * 1.5, L.bar / 2);
    ctx.fillStyle = tok.accent;
    ctx.fill();

    const tx = x + L.left, rx = x + L.w - L.pad;
    const top = y + L.pad;

    /* Too small to read: a bar where each line is, as the strokes do
       below a pixel. Text is the dearest thing the painter draws. */
    if (size * z < 4) {
      L.rows.forEach((row, i) => {
        const ry = top + i * L.lh + L.lh * 0.3;
        if (row.sw) { ctx.fillStyle = withAlpha(ink, 0.28); ctx.fillRect(tx, ry, row.sw, L.lh * 0.4); }
        if (row.rw) { ctx.fillStyle = row.kind === 'err' ? ERR : tok.accent; ctx.globalAlpha *= 0.6; ctx.fillRect(rx - row.rw, ry, row.rw, L.lh * 0.4); ctx.globalAlpha /= 0.6; }
      });
      return;
    }

    // on the board itself, the textarea is the only copy of the text while it is edited
    const editing = editor.item === it && ctx === r.bctx;
    const leaders = [];
    ctx.textBaseline = 'alphabetic';
    L.rows.forEach((row, i) => {
      const by = top + i * L.lh + L.base;
      if (row.src && !editing) {
        ctx.font = row.comment ? L.ital : L.font;
        ctx.fillStyle = row.comment ? tok.muted : ink;
        ctx.textAlign = 'left';
        ctx.fillText(row.src, tx, by);
      }
      // the line being typed is unfinished, not wrong
      if (!row.out || (editing && row.kind === 'err' && i === editor.line)) return;
      ctx.font = L.bold;
      ctx.textAlign = 'right';
      ctx.fillStyle = row.kind === 'err' ? ERR : tok.accent;
      ctx.fillText(row.out, rx, by);
      const a = tx + row.sw + size * 0.7, b = rx - row.rw - size * 0.7;
      if (b - a > size) leaders.push(a, b, by - size * 0.32);
    });
    if (leaders.length) {
      // dotted leaders from each line to its answer, as one path
      ctx.beginPath();
      for (let i = 0; i < leaders.length; i += 3) { ctx.moveTo(leaders[i], leaders[i + 2]); ctx.lineTo(leaders[i + 1], leaders[i + 2]); }
      ctx.setLineDash([0.01, size * 0.42]);
      ctx.lineCap = 'round';
      ctx.lineWidth = size * 0.11;
      ctx.strokeStyle = withAlpha(tok.muted, 0.55);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  const pad0 = L => L.pad * 0.55;

  function svgBlock(it, r) {
    const L = layout(it), size = L.size;
    const tok = r.tokens(), ink = U.color('ink');
    const x = it.x, y = it.y, R = U.round;
    const tx = x + L.left, rx = x + L.w - L.pad, top = y + L.pad;
    const fam = `font-family="Segoe UI, sans-serif" font-size="${size}"`;
    const out = [`<g><rect x="${R(x)}" y="${R(y)}" width="${L.w}" height="${L.h}" rx="${R(size * 0.55)}" fill="${tok.panel}" stroke="${ink}" stroke-opacity="0.18" stroke-width="1"/>`,
      `<rect x="${R(x + pad0(L))}" y="${R(y + L.pad * 0.75)}" width="${R(L.bar)}" height="${R(L.h - L.pad * 1.5)}" rx="${R(L.bar / 2)}" fill="${tok.accent}"/>`];
    L.rows.forEach((row, i) => {
      const by = R(top + i * L.lh + L.base, 1);
      if (row.src) out.push(`<text x="${R(tx, 1)}" y="${by}" ${fam}${row.comment ? ' font-style="italic"' : ''} fill="${row.comment ? tok.muted : ink}" xml:space="preserve">${U.escapeXml(row.src)}</text>`);
      if (!row.out) return;
      out.push(`<text x="${R(rx, 1)}" y="${by}" ${fam} font-weight="600" text-anchor="end" fill="${row.kind === 'err' ? ERR : tok.accent}">${U.escapeXml(row.out)}</text>`);
      const a = tx + row.sw + size * 0.7, b = rx - row.rw - size * 0.7, ly = R(by - size * 0.32, 1);
      if (b - a > size) out.push(`<line x1="${R(a, 1)}" y1="${ly}" x2="${R(b, 1)}" y2="${ly}" stroke="${tok.muted}" stroke-opacity="0.55" stroke-width="${R(size * 0.11)}" stroke-linecap="round" stroke-dasharray="0.01 ${R(size * 0.42)}"/>`);
    });
    out.push('</g>');
    return out.join('');
  }

  /* ── calc blocks: working out ────────────────────────────────────── */
  /** the answers for every line, onto the item. D.math must be loaded. */
  function recalc(it) {
    const out = D.math.evaluateLines(it.text || '');
    it.res = out.map(r => r.kind === 'ok' ? { t: r.pretty } : r.kind === 'err' ? { e: r.error } : null);
    it.sig = sigNow();
    it._lines = null; it._b = null;
    return out;
  }

  /* Blocks whose answers were worked out under other settings — after the
     settings change, after an undo brings back an old version, on a board
     made elsewhere — are brought up to date. Only these load the engine:
     a board whose blocks are current never does. Not an undo step: the
     answers follow from the text, they are not an edit of it. */
  let refreshing = false;
  function refreshBlocks(app) {
    if (refreshing || !app.scene) return;
    const sig = sigNow();
    const stale = app.scene.items.filter(i => i.type === 'calc' && i.sig !== sig && i !== editor.item);
    if (!stale.length) return;
    refreshing = true;
    D.math.ready().then(() => {
      refreshing = false;
      let n = 0;
      for (const it of stale) {
        if (app.scene.get(it.id) !== it) continue;
        recalc(it);
        app.scene.dirty(it);
        n++;
      }
      if (n) { app.requestDraw(); app.markDirty(); }
    }).catch(err => { refreshing = false; console.warn('[dpo] calc', err); });
  }

  /** a new block, worked out and added as one undo step */
  function newBlock(app, at, text = '', opts = {}) {
    const it = { id: U.uid(), type: 'calc', x: at.x, y: at.y, text, size: app.opts.calc.size || 16, res: [], sig: '', alpha: 1 };
    if (D.math.loaded) recalc(it);
    const scene = app.scene;
    if (opts.edit) {
      // the add and the typing that follows are one step: undo takes the block away whole
      app.setTool('select');
      scene.begin('calc block');
      scene.add(it);
      editor.open(app, it, { isNew: true, inTx: true });
      return it;
    }
    scene.begin('calc block'); scene.add(it); scene.commit();
    app.setTool('select');
    app.select([it]);
    app.afterEdit();
    if (!D.math.loaded) refreshBlocks(app);
    return it;
  }

  /* ── calc blocks: the in-place editor ────────────────────────────── */
  /* A textarea over the block's left column, laid out exactly as the
     painter lays the lines out and scaled with the camera, as the text
     editor does (editor.js); the answers keep being painted beside it
     as you type. Below the block, a strip with what is wrong with the
     line you are on (or how to use the function you are in), and Keypad
     and Done buttons big enough for a finger. */
  const editor = {
    app: null, item: null, ta: null, bar: null, msg: null, isNew: false, line: -1, _t: 0,
    get active() { return !!this.item; },

    open(app, it, opts = {}) {
      if (this.item === it) { this.ta.focus(); return; }
      this.close();
      this.app = app; this.item = it; this.isNew = !!opts.isNew;
      const scene = app.scene;
      scene.begin('edit calc');
      if (!opts.inTx) scene.touch(it);           // the block as it was, for undo
      it._lines = null; it._b = null;

      const ta = this.ta = el('textarea', {
        class: 'calc-edit', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off',
        'aria-label': 'Calc block lines'
      });
      ta.value = it.text || '';
      if (panel && panel.open) ta.setAttribute('inputmode', 'none');    // the keypad is up: no on-screen keyboard as well
      ta.addEventListener('input', () => this.changed());
      for (const ev of ['keyup', 'click', 'select']) ta.addEventListener(ev, () => this.caret());
      ta.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.close(); app.focusCanvas(); }
        else if (e.key === 'Tab') e.preventDefault();
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(); }
      });
      ta.addEventListener('paste', e => e.stopPropagation());       // not a pasted text box on the board
      ta.addEventListener('pointerdown', e => e.stopPropagation());
      ta.addEventListener('blur', () => setTimeout(() => {
        // focus went to the keypad or the strip: still editing
        const a = document.activeElement;
        if (this.ta === ta && !(a && (a === ta || (this.bar && this.bar.contains(a)) || (panel && panel.root.contains(a))))) this.close();
      }, 0));

      this.msg = el('span', { class: 'calc-bar-msg' });
      this.graphB = el('button', { class: 'btn', type: 'button', hidden: true, onclick: () => this.graphLine(), html: U.GRAPH_ICON + 'Graph' });
      this.bar = el('div', { class: 'calc-bar' }, this.msg, this.graphB,
        D.inkmath ? el('button', { class: 'btn', type: 'button', title: 'Write lines with the pen', html: svg('M4 20l4.5-1.2L20 7.3a2 2 0 0 0 0-2.8l-.5-.5a2 2 0 0 0-2.8 0L5.2 15.5z|M14.5 6.5l3 3') + 'Write',
          onclick: () => D.inkmath.writePad(app, { title: 'Write lines for the calc block', multi: true, near: this.bar, use: text => {
            const t = this.ta;
            if (!t) return;
            const at = t.selectionStart, before = t.value.slice(0, at);
            t.setRangeText((before && !/\n$/.test(before) ? '\n' : '') + text, at, t.selectionEnd, 'end');
            this.changed(); t.focus();
          } }) }) : null,
        el('button', { class: 'btn', type: 'button', onclick: () => { open(); this.ta && this.ta.focus(); }, html: svg(ICON.calc) + 'Keypad' }),
        el('button', { class: 'btn primary', type: 'button', onclick: () => this.close() }, 'Done'));
      this.bar.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target.closest('button')) e.preventDefault(); });

      const host = document.getElementById('overlay');
      host.append(ta, this.bar);
      app.select([]);
      this.onFrame = () => this.place();
      D.ext.on('frame', this.onFrame);
      this.onOutside = e => {
        const t = e.target;
        if (t === ta || this.bar.contains(t) || (panel && panel.root.contains(t))) return;
        this.close();
      };
      addEventListener('pointerdown', this.onOutside, true);
      this.place();
      this.message();
      if (panel) panel.target();
      app.requestDraw();
      requestAnimationFrame(() => { if (this.ta === ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); this.caret(); } });
      D.math.ready().then(() => { if (this.item === it) this.work(); }).catch(err => this.message(String(err.message || err)));
    },

    /** the text changed: lay it out now, work it out a moment later */
    changed() {
      const it = this.item;
      if (!it) return;
      it.text = this.ta.value;
      it._lines = null; it._b = null; it._json = null;
      this.caret();
      this.place();
      this.app.requestDraw();
      clearTimeout(this._t);
      this._t = setTimeout(() => this.work(), 90);
    },

    work() {
      const it = this.item;
      if (!it || !D.math.loaded) return;
      this.results = recalc(it);
      this.place();
      this.message();
      this.app.requestDraw();
    },

    caret() {
      if (!this.ta) return;
      const at = this.ta.selectionStart;
      const line = this.ta.value.slice(0, at).split('\n').length - 1;
      if (line !== this.line) { this.line = line; this.app.requestDraw(); }
      this.message();
    },

    /** what to say under the block: this line's error, or how to use the function the caret is in */
    message(text) {
      if (!this.msg) return;
      if (text == null) {
        const r = this.results && this.results[this.line];
        const fn = enclosing(this.ta.value, this.ta.selectionStart);
        const hint = fn && D.math.hint(fn);
        text = !D.math.loaded ? 'Loading the maths engine…'
          : r && r.kind === 'err' ? (hint || r.error)
            : hint || 'Variables carry down the lines: F = 2 kN, then M = F * 3 m';
        this.msg.classList.toggle('err', !!(r && r.kind === 'err' && !hint && r.error !== 'The expression is not finished'));
      }
      this.msg.textContent = text;
      // the caret's line is a function of x it could not answer: offer to graph it
      if (this.graphB) {
        const src = this.ta ? this.ta.value.split('\n')[this.line] || '' : '';
        const r = this.results && this.results[this.line];
        const fn = D.graph && (!r || r.kind === 'err') ? D.graph.graphable(src.replace(/^[^:=]*:\s*/, '')) : null;
        this.graphB.hidden = !fn;
        this.graphB.dataset.fn = fn || '';
        if (fn) this.graphB.title = 'Graph y = ' + fn;
      }
    },

    /** the caret's line, graphed beside the block */
    graphLine() {
      const fn = this.graphB && this.graphB.dataset.fn, it = this.item, app = this.app;
      if (!fn || !it) return;
      const L = layout(it);
      this.close();
      D.graph.beside(app, U.box(it.x, it.y, it.x + L.w, it.y + L.h), fn);
    },

    /** keep the textarea and the strip glued to the block as the camera moves */
    place() {
      const it = this.item;
      if (!it) return;
      const app = this.app, cam = app.camera, z = cam.zoom;
      const L = layout(it);
      const p = cam.toScreen(it.x + L.left, it.y + L.pad);
      const ta = this.ta;
      ta.style.left = p.x + 'px';
      ta.style.top = p.y + 'px';
      ta.style.width = Math.max(L.size * 4, L.w - L.left - L.pad) + 'px';
      ta.style.height = Math.max(1, L.rows.length) * L.lh + 'px';
      ta.style.font = L.font;
      ta.style.lineHeight = L.lh + 'px';
      ta.style.transform = `scale(${z})`;
      const below = cam.toScreen(it.x, it.y + L.h);
      const bar = this.bar, bh = bar.offsetHeight || 52;
      let by = below.y + 8;
      if (by + bh > innerHeight - 8) by = cam.toScreen(it.x, it.y).y - bh - 8;     // no room below: above
      bar.style.left = U.clamp(below.x, 8, Math.max(8, innerWidth - (bar.offsetWidth || 360) - 8)) + 'px';
      bar.style.top = U.clamp(by, 8, innerHeight - bh - 8) + 'px';
    },

    close() {
      const it = this.item;
      if (!it) return;
      const app = this.app, ta = this.ta, scene = app.scene;
      clearTimeout(this._t);
      it.text = ta.value.replace(/\s+$/, '');
      if (D.math.loaded) { recalc(it); this.results = null; }
      this.item = null; this.ta = null; this.line = -1;
      D.ext.off('frame', this.onFrame);
      if (typeof removeEventListener === 'function') removeEventListener('pointerdown', this.onOutside, true);
      ta.remove(); this.bar.remove(); this.bar = this.msg = null;
      it._lines = null; it._b = null;
      if (!it.text.trim() && this.isNew) {
        // an empty new block is noise: it leaves no trace, in the board or the undo stack
        scene.cancel();
        scene.remove(it);
        app.select([]);
      } else {
        scene.touch(it);
        scene.commit();
        app.select([it]);
        if (!D.math.loaded) refreshBlocks(app);
      }
      if (panel) panel.target();
      app.afterEdit();
    }
  };

  /** the function whose brackets the caret is inside, if any: "int" in int(x^2, x, |0, 1) */
  function enclosing(s, at) {
    let depth = 0;
    for (let i = at - 1; i >= 0; i--) {
      const c = s[i];
      if (c === ')' || c === ']') depth++;
      else if (c === '[') { if (depth) depth--; }
      else if (c === '(') {
        if (depth) { depth--; continue; }
        const m = /(d\/d[a-z]|[A-Za-z_]\w*|∫)\s*$/.exec(s.slice(0, i));
        if (!m) continue;
        return m[1] === '∫' ? 'int' : /^d\/d/.test(m[1]) ? 'diff' : m[1];
      }
    }
    return null;
  }

  /* ── calc blocks: the tool ───────────────────────────────────────── */
  class CalcTool {
    constructor(app) { this.app = app; this.at = null; }
    down(ev) { this.at = { x: ev.x, y: ev.y }; }
    move() { }
    up() {
      const app = this.app, at = this.at;
      this.at = null;
      if (!at) return;
      // on a block already: edit that one rather than stacking a new one on it
      const hit = app.scene.hitTest(at.x, at.y, 6 / app.camera.zoom);
      if (hit && hit.type === 'calc') { app.setTool('select'); app.select([hit]); editor.open(app, hit); return; }
      const size = app.opts.calc.size || 16;
      newBlock(app, { x: at.x, y: at.y - size * 1.3 }, '', { edit: true });
    }
    cancel() { this.at = null; }
    paint() { }
  }

  /* ── the calculator panel ────────────────────────────────────────── */
  /* The keys. Each inserts `ins` at the caret; "|" in it is where the
     caret goes after, and a selection is wrapped in place of it — select
     "x+1", press √, get √(x+1). The column on the right of every tab is
     the same (delete, brackets, the caret, and =), so the hand learns it. */
  const k = (label, ins, title, cls) => ({ label, ins, title: title || '', cls: cls || '' });
  const FIXED = [
    { label: svg(ICON.back), act: 'back', title: 'Delete', cls: 'fn' },
    k('(', '(|)', 'Brackets — wraps a selection', 'fn'),
    k(')', ')', '', 'fn'),
    { label: svg(ICON.left), act: 'left', title: 'Caret left', cls: 'fn' },
    { label: svg(ICON.right), act: 'right', title: 'Caret right', cls: 'fn' },
    { label: '=', act: 'eval', title: 'Work it out (Enter)', cls: 'eq' }
  ];
  const TABS = [
    { id: 'basic', label: 'Basic', keys: [
      k('π', 'π'), k('√', '√(|)', 'Square root'), k('x²', '²', 'Square'), k('xʸ', '^', 'Power'),
      k('7', '7', '', 'num'), k('8', '8', '', 'num'), k('9', '9', '', 'num'), k('÷', '÷', '', 'op'),
      k('4', '4', '', 'num'), k('5', '5', '', 'num'), k('6', '6', '', 'num'), k('×', '×', '', 'op'),
      k('1', '1', '', 'num'), k('2', '2', '', 'num'), k('3', '3', '', 'num'), k('−', '−', '', 'op'),
      k('0', '0', '', 'num'), k('.', '.', '', 'num'), k('×10ⁿ', 'e', 'Times ten to the… (4.7e3)'), k('+', '+', '', 'op'),
      k('ans', 'ans', 'The last answer'), k('x', 'x'), k('x =', ' = ', 'Set a variable, or write an equation to solve'), k(',', ', ')
    ] },
    { id: 'func', label: 'Func', keys: [
      k('sin', 'sin(|)'), k('cos', 'cos(|)'), k('tan', 'tan(|)'), k('ln', 'log(|)', 'Natural log'),
      k('sin⁻¹', 'asin(|)'), k('cos⁻¹', 'acos(|)'), k('tan⁻¹', 'atan(|)'), k('log₁₀', 'log10(|)'),
      k('eˣ', 'exp(|)'), k('ⁿ√', 'nthRoot(|, 3)', 'nth root'), k('|x|', 'abs(|)', 'Absolute value'), k('x⁻¹', '⁻¹', 'Reciprocal'),
      k('n!', '!', 'Factorial'), k('nCr', 'combinations(|, )', 'n choose r'), k('mod', 'mod(|, )'), k('round', 'round(|, 2)'),
      k('°', '°', 'Degrees'), k('rad', ' rad', 'Radians'), k('∠', '∠', 'A phasor: 10∠30°'), k('i', 'i', 'The imaginary unit'),
      k('sinh', 'sinh(|)'), k('cosh', 'cosh(|)'), k('tanh', 'tanh(|)'), k('atan2', 'atan2(|, )', 'The angle of (x, y): atan2(y, x)')
    ] },
    { id: 'calc', label: 'Calc', keys: [
      k('d/dx', 'd/dx(|)', 'Derivative'), k('∫', 'int(|, x, 0, 1)', 'Definite integral'), k('lim', 'lim(|, x = 0)', 'Limit'), k('Σ…', 'taylor(|, x, 0, 5)', 'Taylor series'),
      k('solve', 'solve(| = 0, x)', 'Every x that makes it true'), k('roots', 'roots(|)', 'Roots of a polynomial'), k('=', ' = '), k('∞', 'inf'),
      k('x', 'x'), k('y', 'y'), k('t', 't'), k(',', ', '),
      k('mean', 'mean([|])'), k('std', 'std([|])', 'Sample standard deviation'), k('median', 'median([|])'), k('fit', 'linreg([|], [])', 'Straight-line fit'),
      k('sum', 'sum([|])'), k('min', 'min(|)'), k('max', 'max(|)'), k('[ ]', '[|]', 'A list'),
      k('f(x) =', 'f(x) = ', 'Define a function'), k('f', 'f(|)'), k('e', 'e', "Euler's number"), k('π', 'π')
    ] },
    { id: 'matrix', label: 'Matrix', keys: [
      k('[ ]', '[|]', 'A matrix: [1, 2; 3, 4]'), k(',', ', ', 'Next column'), k(';', '; ', 'Next row'), k('Aᵀ', 'ᵀ', 'Transpose'),
      k('det', 'det(|)'), k('inv', 'inv(|)'), k('A\\b', ' \\ ', 'Solve A x = b'), k('eig', 'eigs(|)', 'Eigenvalues and vectors'),
      k('dot', 'dot(|, )'), k('cross', 'cross(|, )'), k('norm', 'norm(|)', 'Length'), k('rank', 'rank(|)'),
      k('I', 'identity(|)', 'Identity matrix'), k('zeros', 'zeros(|, )'), k('trace', 'trace(|)'), k('size', 'size(|)'),
      k('A', 'A'), k('B', 'B'), k('b', 'b'), k('=', ' = '),
      k('x', 'x'), k('v', 'v'), k('ans', 'ans'), k('i', 'i')
    ] },
    { id: 'units', label: 'Units', keys: [
      k('mm', ' mm'), k('m', ' m'), k('km', ' km'), k('in', ' in'),
      k('N', ' N'), k('kN', ' kN'), k('kg', ' kg'), k('lbf', ' lbf'),
      k('Pa', ' Pa'), k('kPa', ' kPa'), k('MPa', ' MPa'), k('psi', ' psi'),
      k('J', ' J'), k('W', ' W'), k('kW', ' kW'), k('s', ' s'),
      k('V', ' V'), k('A', ' A'), k('Ω', ' Ω'), k('kΩ', ' kΩ'),
      k('µF', ' µF'), k('mH', ' mH'), k('Hz', ' Hz'), k('to', ' to ', 'Convert: 3 in to mm')
    ] },
    { id: 'const', label: 'Const', keys: null }      // from D.math.constants
  ];
  const OPS = new Set(['+', '−', '×', '÷', '^', '²', '⁻¹', '!']);

  /** variables and history for one board, kept for the session */
  const sessions = new Map();
  function session(app) {
    const id = (app.board && app.board.id) || '-';
    if (!sessions.has(id)) sessions.set(id, { scope: D.math.scope(), history: [] });
    return sessions.get(id);
  }

  let panel = null;

  class CalcPanel {
    constructor(app) {
      this.app = app;
      this.open = false;
      this.tab = 'basic';
      this.folded = false;
      this.build();
    }

    build() {
      const B = (cls, title, html, onclick) => {
        const b = el('button', { class: cls, type: 'button', title, 'aria-label': title, html });
        if (onclick) b.onclick = onclick;
        return b;
      };
      this.angle = el('div', { class: 'seg calc-angle', role: 'group', 'aria-label': 'Angle unit' });
      for (const [v, l] of [['deg', 'DEG'], ['rad', 'RAD']]) {
        const b = B('', v === 'deg' ? 'Angles in degrees' : 'Angles in radians', l, () => this.setOpt('angle', v));
        b.dataset.v = v;
        this.angle.append(b);
      }
      this.exactBtn = B('calc-chip', 'Exact answers: fractions, roots and π', 'a/b', () => this.setOpt('exact', !this.app.opts.calc.exact));
      this.foldBtn = B('icon', 'Fold the keypad away', svg(ICON.fold), () => this.fold(!this.folded));
      const head = el('header', { class: 'calc-head' },
        el('span', { class: 'calc-title' }, 'Calculator'),
        this.angle, this.exactBtn, this.foldBtn,
        B('icon', 'Close (Ctrl+K)', svg(ICON.close), () => close()));
      this.drag(head);

      this.hist = el('div', { class: 'calc-hist', role: 'log', 'aria-label': 'Answers' });
      this.input = el('input', {
        class: 'calc-input', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
        inputmode: 'none', 'aria-label': 'Expression', placeholder: 'Type or tap a sum'
      });
      this.input.addEventListener('input', () => this.changed());
      // a pen on the line writes on the app's pad, not in Windows' handwriting panel
      U.penField(this.input, () => this.write());
      this.input.addEventListener('keydown', e => this.key(e));
      this.input.addEventListener('paste', e => e.stopPropagation());
      for (const ev of ['keyup', 'click']) this.input.addEventListener(ev, () => this.preview());
      this.kbd = B('icon', 'On-screen keyboard, for letters', svg(ICON.keyboard), () => {
        const on = this.input.getAttribute('inputmode') === 'none';
        this.input.setAttribute('inputmode', on ? 'text' : 'none');
        this.kbd.classList.toggle('on', on);
        this.input.blur(); this.input.focus();
      });
      const clear = B('icon', 'Clear the line', svg(ICON.close), () => { this.input.value = ''; this.changed(); this.input.focus(); });
      this.line = el('div', { class: 'calc-line' }, this.input, this.kbd, clear);
      this.out = el('div', { class: 'calc-preview', 'aria-live': 'polite' });
      this.vars = el('div', { class: 'calc-vars' });
      this.tabs = el('nav', { class: 'calc-tabs', role: 'tablist' });
      for (const t of TABS) {
        const b = B('calc-tab', t.label, t.label, () => this.showTab(t.id));
        b.dataset.id = t.id;
        b.setAttribute('role', 'tab');
        this.tabs.append(b);
      }
      this.pad = el('div', { class: 'calc-pad' });
      this.into = el('div', { class: 'calc-into' });
      const foot = el('footer', { class: 'calc-foot' },
        B('btn', 'Put this on the board as a calc block, with the lines its variables come from', svg(ICON.block) + 'Insert block', () => this.insertBlock()),
        B('btn', 'Put this on the board as text', svg(ICON.text) + 'Insert text', () => this.insertText()),
        B('btn', 'Plot this as y = f(x) on the board', svg('M4 4v16h16|M6.5 15c2-6 3.5-8 5.5-8s3 4 4.5 4 2-2 2.5-3') + 'Plot', () => this.plot()),
        B('btn', 'Write the sum with the pen instead of the keys', svg('M4 20l4.5-1.2L20 7.3a2 2 0 0 0 0-2.8l-.5-.5a2 2 0 0 0-2.8 0L5.2 15.5z|M14.5 6.5l3 3') + 'Write', () => this.write()));
      this.body = el('div', { class: 'calc-body' }, this.vars, this.tabs, this.pad, foot);
      this.root = el('section', { class: 'glass calc-panel', id: 'calc-panel', role: 'dialog', 'aria-label': 'Calculator', hidden: '' },
        head, this.hist, this.line, this.out, this.into, this.body);
      // a press on a key must not take the focus (and the caret) away from the line being typed into
      this.root.addEventListener('pointerdown', e => {
        if (e.target.closest('button') && !e.target.closest('.calc-head')) e.preventDefault();
      });
      this.root.addEventListener('keydown', e => e.stopPropagation());
      document.body.append(this.root);
      this.showTab(this.tab);
    }

    /* ── opening, folding, moving ── */
    show(expr) {
      sync(this.app);
      this.root.hidden = false;
      this.open = true;
      this.place();
      this.refresh();
      if (expr != null) { this.input.value = String(expr); }
      this.changed();
      if (!editor.active) this.input.focus();
      if (editor.ta) editor.ta.setAttribute('inputmode', 'none');
      if (!D.math.loaded) D.math.ready().then(() => this.changed()).catch(err => this.say(String(err.message || err), 'err'));
      const b = document.getElementById('btn-calc');
      if (b) b.classList.add('on');
    }
    hide() {
      // keys go back to the board, not to a line nobody can see
      if (this.root.contains(document.activeElement)) /** @type {HTMLElement} */ (document.activeElement).blur();
      this.root.hidden = true;
      this.open = false;
      const b = document.getElementById('btn-calc');
      if (b) b.classList.remove('on');
      if (editor.ta) { editor.ta.removeAttribute('inputmode'); editor.ta.focus(); }
    }
    fold(on) {
      this.folded = on;
      this.root.classList.toggle('folded', on);
      this.foldBtn.innerHTML = svg(on ? ICON.unfold : ICON.fold);
      this.foldBtn.title = on ? 'Show the keypad' : 'Fold the keypad away';
      this.place();
    }

    /* Where it opens: where it was left (in this window — like the panel
       folds, a matter of the screen, not the board), else top right,
       clear of the style panel. */
    place(x, y) {
      const r = this.root, w = r.offsetWidth || 344, h = r.offsetHeight || 600;
      if (x == null) {
        let at = null;
        try { at = JSON.parse(localStorage.getItem('dpo:calc-at') || 'null'); } catch (_) { }
        const styleW = innerWidth > 720 && !document.body.classList.contains('fold-style') ? 206 + 24 : 0;
        x = at ? at.x : innerWidth - w - 12 - styleW;
        y = at ? at.y : 64;
      }
      x = U.clamp(x, 8, Math.max(8, innerWidth - w - 8));
      y = U.clamp(y, 8, Math.max(8, innerHeight - Math.min(h, innerHeight - 16) - 8));
      r.style.left = x + 'px';
      r.style.top = y + 'px';
      return { x, y };
    }

    drag(head) {
      let from = null;
      head.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        const r = this.root.getBoundingClientRect();
        from = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
        head.setPointerCapture(e.pointerId);
        head.classList.add('grabbing');
        e.preventDefault();
      });
      head.addEventListener('pointermove', e => {
        if (!from || e.pointerId !== from.id) return;
        this.place(e.clientX - from.dx, e.clientY - from.dy);
      });
      const end = e => {
        if (!from || e.pointerId !== from.id) return;
        from = null;
        head.classList.remove('grabbing');
        const r = this.root.getBoundingClientRect();
        try { localStorage.setItem('dpo:calc-at', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (_) { }
      };
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
    }

    setOpt(k, v) {
      this.app.opts.calc[k] = v;
      this.app.savePrefs();
      settingsChanged(this.app);
    }

    /** the header's toggles, the history and the variables, as they are now */
    refresh() {
      const o = this.app.opts.calc;
      for (const b of this.angle.children) b.classList.toggle('on', b.dataset.v === (o.angle === 'rad' ? 'rad' : 'deg'));
      this.exactBtn.classList.toggle('on', !!o.exact);
      this.exactBtn.setAttribute('aria-pressed', o.exact ? 'true' : 'false');
      this.renderHistory();
      this.renderVars();
      this.target();
    }

    showTab(id) {
      this.tab = id;
      for (const b of this.tabs.children) {
        const on = b.dataset.id === id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      const t = TABS.find(x => x.id === id);
      let keys = t.keys;
      if (!keys) {
        keys = D.math.constants.map(c => k(c.label.replace(/_([A-Za-z]+)/, (m, s) => `<sub>${s}</sub>`), c.name, `${c.desc} (${c.unit})`));
        keys.push(k('π', 'π'), k('e', 'e', "Euler's number"), k('i', 'i'), k('∞', 'inf'), k('ans', 'ans'), k('x', 'x'), k('=', ' = '), k(',', ', '), k('°', '°'));
      }
      this.pad.textContent = '';
      for (let row = 0; row < 6; row++) {
        for (let c = 0; c < 4; c++) this.pad.append(this.keyEl(keys[row * 4 + c]));
        this.pad.append(this.keyEl(FIXED[row]));
      }
    }

    keyEl(key) {
      if (!key) return el('span', { class: 'calc-key blank' });
      const b = el('button', { class: 'calc-key ' + key.cls, type: 'button', title: key.title || '', html: key.label });
      if (key.title) b.setAttribute('aria-label', key.title);
      let rep = null, repeated = false;
      const stop = () => { clearTimeout(rep); clearInterval(rep); rep = null; };
      if (key.act === 'back' || key.act === 'left' || key.act === 'right') {
        // held, these repeat — the only keys that need to
        b.addEventListener('pointerdown', () => {
          repeated = false;
          stop();
          rep = setTimeout(() => { rep = setInterval(() => { repeated = true; this.press(key); }, 70); }, 420);
        });
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointerleave', stop);
        b.addEventListener('pointercancel', stop);
      }
      b.onclick = () => { if (repeated) { repeated = false; return; } this.press(key); };
      return b;
    }

    /* ── typing ── */
    /** where the keys go: a field a feature lent (a graph's function), the calc block being edited, or the panel's own line */
    field() {
      if (this.ext && !this.ext.isConnected) this.ext = null;
      return this.ext || (editor.active ? editor.ta : this.input);
    }

    /** say which it is */
    target() {
      const ext = this.field() === this.ext && this.ext, into = editor.active || !!ext;
      this.root.classList.toggle('into-block', into);
      this.into.textContent = ext ? 'Keys type into the graph' : into ? 'Keys type into the calc block' : '';
    }

    press(key) {
      const f = this.field(), into = f !== this.input;
      if (key.act === 'eval') {
        if (f === this.ext) return;                 // a graph's function plots as it is typed
        if (into) this.insert(f, '\n');
        else this.commit();
        return;
      }
      if (key.act === 'back') {
        const a = f.selectionStart, b = f.selectionEnd;
        if (a !== b) f.setRangeText('', a, b, 'end');
        else if (a > 0) {
          // a whole function name and its bracket go at once: "sin(" is one key, so one delete
          const m = /(?:[A-Za-z_]\w*\(|d\/d[a-z]\(| to | = |, |\s?[A-Za-zΩµ]+)$/.exec(f.value.slice(0, a));
          const n = m && m[0].length > 1 && key.act === 'back' && /\($| to $| = $|, $/.test(m[0]) ? m[0].length : 1;
          f.setRangeText('', a - n, a, 'end');
        }
        this.typed(f);
        return;
      }
      if (key.act === 'left' || key.act === 'right') {
        const p = U.clamp(f.selectionStart + (key.act === 'left' ? -1 : 1), 0, f.value.length);
        f.setSelectionRange(p, p);
        if (f === this.input) this.preview(); else editor.caret();
        return;
      }
      let ins = key.ins;
      // a closing bracket that is already there (√ typed both) is stepped over, not doubled
      if (ins === ')' && f.selectionStart === f.selectionEnd && f.value[f.selectionStart] === ')') {
        const p = f.selectionStart + 1;
        f.setSelectionRange(p, p);
        if (f === this.input) this.preview(); else editor.caret();
        return;
      }
      // straight after an answer, an operator carries on from it
      if (!into && !f.value && OPS.has(ins.trim()) && session(this.app).history.length) ins = 'ans' + ins;
      // a unit after a space, not glued to it twice
      if (/^ /.test(ins) && /(^|[\s(])$/.test(f.value.slice(0, f.selectionStart))) ins = ins.replace(/^ +/, '');
      this.insert(f, ins);
    }

    insert(f, ins) {
      const a = f.selectionStart, b = f.selectionEnd;
      const sel = f.value.slice(a, b);
      const at = ins.indexOf('|');
      let text, caret;
      if (at < 0) { text = ins; caret = a + text.length; }
      else {
        text = ins.slice(0, at) + sel + ins.slice(at + 1);
        caret = a + at + sel.length;
      }
      f.setRangeText(text, a, b, 'end');
      f.setSelectionRange(caret, caret);
      this.typed(f);
    }

    typed(f) {
      if (f === this.input) this.changed();
      else if (f === this.ext) f.dispatchEvent(new Event('input'));
      else editor.changed();
    }

    key(e) {
      e.stopPropagation();
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') { e.preventDefault(); close(); this.app.focusCanvas(); return; }
      if (k === 'Enter') { e.preventDefault(); this.commit(); return; }
      if (k === 'Escape') { e.preventDefault(); if (this.input.value) { this.input.value = ''; this.changed(); } else { close(); this.app.focusCanvas(); } return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        // walk back through what was typed, as a shell does
        const h = session(this.app).history;
        if (!h.length) return;
        e.preventDefault();
        this._walk = U.clamp((this._walk ?? h.length) + (k === 'ArrowUp' ? -1 : 1), 0, h.length);
        this.input.value = this._walk < h.length ? h[this._walk].src : '';
        this.changed(true);
      }
    }

    changed(walking) {
      if (!walking) this._walk = null;
      clearTimeout(this._t);
      this._t = setTimeout(() => this.preview(), 60);
    }

    say(text, cls) {
      this.out.textContent = text;
      this.out.className = 'calc-preview' + (cls ? ' ' + cls : '');
    }

    /** the answer so far, worked out in a throwaway child of the session's scope */
    preview() {
      if (!this.open) return;
      const src = this.input.value;
      if (!src.trim()) { this.say(''); return; }
      if (!D.math.loaded) { this.say('Loading the maths engine…', 'tip'); return; }
      const fn = enclosing(src, this.input.selectionStart);
      const hint = fn && D.math.hint(fn);
      const r = D.math.evaluate(src, session(this.app).scope.child());
      if (r.ok && !r.empty) {
        this.out.textContent = '';
        this.out.className = 'calc-preview ok';
        this.out.append(el('span', { class: 'eq' }, '= '), r.pretty);
        if (hint) this.out.append(el('small', {}, hint));
      } else if (hint) this.say(hint, 'tip');
      else if (this.offerGraph(src)) return;
      else if (r.error && /\bx\b/.test(r.error) && D.graph && D.graph.graphable(src, session(this.app).scope, { bare: true })) this.say(r.error + ' — set x = …, or write y = … to graph it', 'tip');
      else if (r.error && r.error !== 'The expression is not finished') this.say(r.error, 'tip');
      else this.say('');
    }

    commit() {
      const src = this.input.value.trim();
      if (!src) return;
      if (!D.math.loaded) { this.say('Loading the maths engine…', 'tip'); return; }
      const s = session(this.app);
      const r = D.math.evaluate(src, s.scope);
      if (!r.ok) { if (!this.offerGraph(src)) this.say(r.error, 'err'); return; }
      if (r.empty) return;
      s.history.push({ src, pretty: r.pretty, alt: r.alt, rows: r.rows, value: r.value, name: r.name });
      if (s.history.length > 200) s.history.shift();
      this.input.value = '';
      this._walk = null;
      this.say('');
      this.renderHistory();
      this.renderVars();
    }

    /* ── what the session holds ── */
    renderHistory() {
      const h = session(this.app).history, box = this.hist;
      box.textContent = '';
      if (!h.length) {
        box.append(el('div', { class: 'calc-empty' }, 'Answers land here. Tap one to use it again.'));
        return;
      }
      for (const e of h) {
        const a = el('button', { class: 'calc-a', type: 'button', title: 'Use this answer' });
        if (e.rows && e.rows.length > 1) a.append(matrix(e.rows));
        else a.append(e.pretty);
        if (e.alt) a.append(el('small', {}, e.alt));
        a.onclick = () => this.insert(this.field(), reuse(e));
        const q = el('button', { class: 'calc-q', type: 'button', title: 'Edit this line again' }, e.src);
        q.onclick = () => { this.input.value = e.src; this.changed(); this.input.focus(); };
        box.append(el('div', { class: 'calc-entry' }, q, a));
      }
      box.scrollTop = box.scrollHeight;
    }

    renderVars() {
      const s = session(this.app), box = this.vars;
      box.textContent = '';
      const names = s.scope.own().filter(n => n !== 'ans');
      box.hidden = !names.length;
      for (const n of names) {
        const v = s.scope.get(n);
        const f = typeof v === 'function' ? (v.syntax || n) : n;
        const b = el('button', { class: 'calc-var', type: 'button', title: typeof v === 'function' ? f : `${n} = ${D.math.format(v).pretty}` }, f);
        b.onclick = () => this.insert(this.field(), typeof v === 'function' ? n + '(|)' : n);
        box.append(b);
      }
    }

    /* ── onto the board ── */
    /** the line, or the last answer if the line is empty */
    current() {
      const src = this.input.value.trim();
      if (src) return src;
      const h = session(this.app).history;
      return h.length ? h[h.length - 1].src : '';
    }

    /**
     * The line as a calc block, with the lines that define what it uses —
     * "M = F * L" arrives with F and L, so it works out on its own. Into
     * the selected calc block, if one is selected; otherwise a new one in
     * the middle of the view.
     */
    /** the pen instead of the keys: what is written goes into the line (or the calc block) */
    write() {
      if (!D.inkmath || !D.inkmath.writePad) return;
      const f = this.field(), block = editor.active && f === editor.ta;
      D.inkmath.writePad(this.app, {
        title: block ? 'Write lines for the calc block' : 'Write a sum', multi: block, near: this.root,
        use: text => { f.focus(); this.insert(f, block && f.value && !/\n$/.test(f.value.slice(0, f.selectionStart)) ? '\n' + text : text); }
      });
    }

    /** a function of x the calculator cannot answer: offer to graph it instead */
    offerGraph(src) {
      const fn = D.graph && D.graph.graphable(src, session(this.app).scope);
      if (!fn) return false;
      this.out.textContent = '';
      this.out.className = 'calc-preview tip';
      this.out.append(el('span', {}, 'A function of x: '),
        el('button', { class: 'btn primary calc-graph', type: 'button', onclick: () => this.plot(), html: U.GRAPH_ICON + '<span></span>' }));
      this.out.lastChild.lastChild.textContent = 'Graph y = ' + fn;
      return true;
    }

    /** the line as a graph of y against x, beside the panel (js/graph.js) */
    plot() {
      const app = this.app, src = this.current();
      if (!src) { app.toast('Type a function of x first, like sin(x) or x^2 − 3'); return; }
      if (!D.graph) return;
      if (!/(^|[^A-Za-z_])x([^A-Za-z_(]|$)/.test(src)) app.toast('No x in that: it plots as a flat line');
      D.graph.add(app, this.clearSpot(), { fns: [(D.graph.graphable(src, null, { bare: true }) || src).replace(/^\s*y\s*=\s*/, '')] }, { edit: false });
    }

    insertBlock() {
      const app = this.app, src = this.current();
      if (!src) { app.toast('Type a sum first'); return; }
      const lines = withDefinitions(session(app), src);
      const sel = app.selection.length === 1 && app.selection[0].type === 'calc' ? app.selection[0] : null;
      if (sel) {
        const have = new Set(String(sel.text || '').split('\n').map(l => l.trim()));
        const add = lines.filter(l => !have.has(l.trim()));
        app.scene.begin('calc block');
        app.scene.touch(sel);
        sel.text = (sel.text ? sel.text.replace(/\s+$/, '') + '\n' : '') + add.join('\n');
        if (D.math.loaded) recalc(sel);
        app.scene.commit();
        app.afterEdit();
        app.toast('Added to the calc block');
        return;
      }
      const it = { size: app.opts.calc.size || 16, text: lines.join('\n') };
      const c = this.clearSpot();
      const L = layout({ ...it, res: [] });
      newBlock(app, { x: c.x - L.w / 2, y: c.y - L.h / 2 }, it.text);
      app.toast('Calc block added');
    }

    /** the middle of the part of the view the panel is not covering, in world units */
    clearSpot() {
      const r = this.root.getBoundingClientRect();
      let x = innerWidth / 2;
      if (r.left > 360) x = (70 + r.left) / 2;                  // room to its left (past the rail)
      else if (innerWidth - r.right > 360) x = (r.right + innerWidth) / 2;
      return this.app.camera.toWorld(x, innerHeight / 2);
    }

    insertText() {
      const app = this.app, src = this.current();
      if (!src) { app.toast('Type a sum first'); return; }
      const r = D.math.loaded ? D.math.evaluate(src, session(app).scope.child()) : null;
      const text = r && r.ok && !r.empty ? `${src} = ${r.pretty.replace(/^[A-Za-z_]\w* = /, '')}` : src;
      const o = app.opts.text;
      const c = this.clearSpot();
      const it = D.make.text({ x: c.x, y: c.y, text, color: o.color, size: o.size, font: o.font, autoWidth: true, w: 40 });
      app.scene.begin('text'); app.scene.add(it); app.scene.commit();
      const b = app.scene.bbox(it);
      app.scene.translate(it, -b.w / 2, -b.h / 2);
      app.setTool('select');
      app.select([it]);
      app.afterEdit();
      app.toast('Text added');
    }
  }

  /** an answer as something to type back in: full precision, so chaining answers does not round them */
  function reuse(e) {
    if (e.name) return e.name;
    const v = e.value;
    if (typeof v === 'number' || (v && (v.isUnit || v.isComplex))) {
      const f = D.math.format(v, { sig: 12, format: 'auto', exact: false });
      return /[ +-]/.test(f.text.trim()) && !/^-?[\d.e]+ [^\s]+$/.test(f.text) ? `(${f.text})` : f.text;
    }
    return e.pretty;
  }

  /** a small grid for a matrix answer */
  function matrix(rows) {
    const g = el('span', { class: 'calc-mat', style: `grid-template-columns:repeat(${rows[0].length},auto)` });
    for (const r of rows) for (const c of r) g.append(el('span', {}, c));
    return g;
  }

  /** src, after the history lines that assign the variables it uses, and theirs, in order */
  function withDefinitions(s, src) {
    const lib = D.math.lib;
    if (!lib) return [src];
    const h = s.history;
    const used = text => {
      try {
        const names = new Set();
        lib.parse(D.math.preprocess(text)).traverse(n => { if (n.isSymbolNode) names.add(n.name); });
        return names;
      } catch (_) { return new Set(); }
    };
    const need = new Set();
    const visit = (text, before) => {
      for (const name of used(text)) {
        let i = -1;
        for (let j = before - 1; j >= 0; j--) if (h[j].name === name) { i = j; break; }
        if (i < 0 || need.has(i)) continue;
        need.add(i);
        visit(h[i].src, i);
      }
    };
    const self = h.findIndex((e, i) => e.src === src && i === h.length - 1);
    visit(src, self >= 0 ? self : h.length);
    const lines = [...need].sort((a, b) => a - b).map(i => h[i].src);
    lines.push(src);
    return lines;
  }

  function open(expr) {
    const app = D.app;
    if (!app) return;
    if (!panel) panel = new CalcPanel(app);
    panel.show(expr);
  }
  function close() { if (panel && panel.open) panel.hide(); }
  function toggle() { if (panel && panel.open) close(); else open(); }

  function settingsChanged(app) {
    sync(app);
    if (panel && panel.open) { panel.refresh(); panel.changed(); }
    if (editor.active && D.math.loaded) editor.work();
    refreshBlocks(app);
  }

  /* ── plugging in ─────────────────────────────────────────────────── */
  D.ext.items.calc = {
    label: 'Calc block',
    bbox(it) { const L = layout(it); return { x: it.x, y: it.y, w: L.w, h: L.h }; },
    draw: drawBlock,
    svg: svgBlock,
    edit(app, it) { editor.open(app, it); },
    /* Resizing scales the text, as a text box's corner does; the block's
       size always follows from its lines. */
    scale(it, o, sx, sy) {
      const L = layout(it);
      const x1 = o.x + (it.x - o.x) * sx, x2 = o.x + (it.x + L.w - o.x) * sx;
      const y1 = o.y + (it.y - o.y) * sy, y2 = o.y + (it.y + L.h - o.y) * sy;
      it.x = Math.min(x1, x2); it.y = Math.min(y1, y2);
      it.size = U.clamp((it.size || 16) * Math.sqrt(Math.abs(sx * sy)), 6, 400);
      it._lines = null; it._b = null;
    },
    panel(ui, items) {
      const app = ui.app, first = items[0];
      ui.add(
        ui.group(items.length > 1 ? items.length + ' calc blocks' : 'Calc block',
          el('div', { class: 'calc-actions' },
            items.length === 1 ? el('button', { class: 'btn', type: 'button', onclick: () => editor.open(app, first) }, 'Edit') : null,
            el('button', { class: 'btn', type: 'button', onclick: () => D.math.ready().then(() => ui.apply(items, it => recalc(it))) }, 'Recalculate'),
            el('button', { class: 'btn', type: 'button', onclick: () => copyBlocks(app, items) }, 'Copy'))),
        ui.group('Text size', ui.seg([[13, 'S'], [16, 'M'], [21, 'L'], [28, 'XL']], first.size || 16,
          v => { app.opts.calc.size = v; ui.apply(items, it => { it.size = v; it._lines = null; }); })),
        ui.slider('Opacity', first.alpha ?? 1, 0.1, 1, 0.05, v => ui.apply(items, it => it.alpha = v), v => Math.round(v * 100) + '%'),
        ui.group('', el('div', { class: 'rowlbl' }, el('span', { style: 'line-height:1.5' },
          'Each line is worked out; variables carry down. Double-tap to edit.')))
      );
    }
  };

  /** the lines with their answers, as plain text, to paste into a report */
  function copyBlocks(app, items) {
    const text = items.map(it => {
      const L = layout(it);
      const w = Math.max(...L.rows.map(r => r.src.length), 0) + 4;
      return L.rows.map(r => r.out && r.kind === 'ok' ? r.src.padEnd(w) + r.out : r.src).join('\n');
    }).join('\n\n');
    const done = () => app.toast('Copied the lines and answers');
    try { navigator.clipboard.writeText(text).then(done, () => app.toast('Could not copy')); }
    catch (_) { app.toast('Could not copy'); }
  }

  D.ext.tools.push({
    name: 'calc',
    create: app => new CalcTool(app),
    rail: { icon: ICON.block, key: 'b', title: 'Calc block · B', after: 'note' },
    panel: ui => {
      const o = ui.app.opts.calc;
      ui.add(
        ui.group('Text size', ui.seg([[13, 'S'], [16, 'M'], [21, 'L'], [28, 'XL']], o.size, v => o.size = v)),
        ui.group('', el('div', { class: 'rowlbl' }, el('span', { style: 'line-height:1.5' },
          'Tap the board for a calc block: a worksheet where each line is worked out and variables carry down — F = 2 kN, L = 3 m, M = F * L.'))),
        ui.group('', el('button', { class: 'btn', type: 'button', onclick: () => open() }, 'Open the calculator · Ctrl+K'))
      );
    }
  });

  D.ext.buttons.push({ id: 'btn-calc', icon: ICON.calc, title: 'Calculator (Ctrl+K)', where: 'top', onClick: () => toggle() });

  D.ext.pressActions.push(
    { id: 'calc-open', label: 'Calculator', icon: ICON.calc, order: 60, when: ctx => ctx.source === 'menu', run: () => open() },
    {
      id: 'calc-block', label: 'New calc block here', icon: ICON.block, order: 61,
      when: ctx => ctx.source === 'menu' && !(ctx.hit && ctx.hit.type === 'calc'),
      run: ctx => newBlock(ctx.app, { x: ctx.x, y: ctx.y }, '', { edit: true })
    }
  );

  D.ext.settings.push({
    id: 'calc', title: 'Calculator', sub: 'Angles, number format and precision', icon: ICON.calc,
    render(ui) {
      const app = ui.app, o = app.opts.calc;
      const set = (k, v) => { o[k] = v; app.savePrefs(); settingsChanged(app); };
      return [
        ui.setGroup(
          ui.setRow('Angles', 'For sin, cos and tan, and phasor angles. Calculus works in radians either way', ui.setSeg([['deg', 'Degrees'], ['rad', 'Radians']], o.angle, v => set('angle', v))),
          ui.setRow('Numbers', 'Engineering writes 4.7k and 1.2 mA; scientific 4.7×10³', ui.setSeg([['auto', 'Auto'], ['eng', 'Engineering'], ['sci', 'Scientific'], ['fixed', 'Fixed']], o.format, v => set('format', v))),
          ui.setRow('Significant figures', 'Decimal places, for Fixed', ui.setSeg([[3, '3'], [4, '4'], [5, '5'], [6, '6'], [8, '8'], [10, '10']], +o.sig, v => set('sig', v))),
          ui.setToggle('Exact answers', 'Fractions, roots and multiples of π when the answer is one: 1/3 rather than 0.33333', !!o.exact, v => set('exact', v))),
        ui.setNote('The calculator opens from the top bar or with Ctrl+K. Calc blocks on the board are worked out again when these change.')
      ];
    }
  });

  /* Ctrl+K anywhere on the board. (In the calculator's own line, and in
     a calc block being edited, the same key is handled there: the core
     does not hand keys typed into a field to features.) */
  D.ext.on('key', (app, e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggle();
      return true;
    }
  });

  D.ext.on('ready', app => { sync(app); refreshBlocks(app); });
  D.ext.on('board', app => {
    if (editor.active) editor.close();
    if (panel) panel.app = app;
    if (panel && panel.open) panel.refresh();
    refreshBlocks(app);
  });
  // an undo can bring back answers worked out under other settings
  D.ext.on('change', app => { if (D.math.loaded) refreshBlocks(app); });

  D.calc = {
    open, close, toggle,
    /** lend the keypad a field to type into (null to take it back); it gets an input event per key */
    typeInto(f) {
      if (!panel) { if (!f) return; panel = new CalcPanel(D.app); }
      panel.ext = f || null;
      panel.target();
    },
    get isOpen() { return !!(panel && panel.open); },
    newBlock, recalc, layout,
    edit: (app, it) => editor.open(app, it),
    get editing() { return editor.item; }
  };
})(window.DPO);

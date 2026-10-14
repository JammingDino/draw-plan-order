/* ── symbols.js ── circuit and mechanics symbols ──────────────────────
   Resistors, capacitors, inductors, diodes, sources, switches, ground and
   an op-amp; pin and roller supports, a fixed wall, springs, dampers, a
   mass and a pulley. The symbol tool (S) puts the one picked in its panel
   wherever you tap, as many as you like; each is a box like any other —
   moved, resized, turned (Ctrl+R stands one up), coloured, exported.

   Each symbol's terminals are snap points (D.ext.items.symbol.snapPoints):
   a line, an arrow or a polyline drawn to one snaps onto it and stays
   attached, following the part as it moves or turns. So a circuit is
   symbols, then wires drawn from terminal to terminal. A symbol can carry
   a label — R1 = 4.7 kΩ — which stays upright however the part is turned.

   ── The item ─────────────────────────────────────────────────────────

   { type: 'symbol', kind, x, y, w, h, color, size, label, textSize }
   kind    a key of SYMBOLS below;  size  the line weight

   ── Drawing ──────────────────────────────────────────────────────────

   A symbol is drawn from a few parts in its own little box (W × H):
     ['l', x, y, x, y, …]        a polyline         ['p', …] the same, closed
     ['f', x, y, …]              a filled polygon   ['c', cx, cy, r] a circle
     ['d', cx, cy, r]            a filled dot       ['a', cx, cy, r, from°, to°] an arc
     ['t', x, y, text]           a small mark (+, −, m)
   and `pins`: { key: [x, y] } its terminals. Canvas and SVG both draw
   from the same parts, scaled to the item's box; circles stay round.     */
(function (D) {
  'use strict';
  const U = D.util, el = U.el;

  const zig = (x0, x1, y, amp, n) => {
    const o = [x0, y], step = (x1 - x0) / n;
    for (let i = 0; i < n; i++) o.push(x0 + step * (i + 0.5), y + (i % 2 ? amp : -amp));
    o.push(x1, y);
    return o;
  };
  const hatch = (x0, x1, y, dx, dy, gap) => {
    const o = [];
    for (let x = x0; x <= x1 + 0.01; x += gap) o.push(['l', x, y, x + dx, y + dy]);
    return o;
  };
  const sine = (cx, cy, w, a) => {
    const o = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; o.push(cx - w / 2 + w * t, cy - Math.sin(t * Math.PI * 2) * a); }
    return o;
  };

  const SYMBOLS = {
    // ── electrical: two terminals, a and b, left and right ──
    resistor: { label: 'Resistor', group: 'circuit', W: 80, H: 24,
      parts: [['l', 0, 12, 16, 12], ['l', ...zig(16, 64, 12, 8, 6)], ['l', 64, 12, 80, 12]], pins: { a: [0, 12], b: [80, 12] } },
    resistorBox: { label: 'Resistor (IEC)', group: 'circuit', W: 80, H: 24,
      parts: [['l', 0, 12, 18, 12], ['p', 18, 4, 62, 4, 62, 20, 18, 20], ['l', 62, 12, 80, 12]], pins: { a: [0, 12], b: [80, 12] } },
    capacitor: { label: 'Capacitor', group: 'circuit', W: 60, H: 40,
      parts: [['l', 0, 20, 26, 20], ['l', 26, 4, 26, 36], ['l', 34, 4, 34, 36], ['l', 34, 20, 60, 20]], pins: { a: [0, 20], b: [60, 20] } },
    inductor: { label: 'Inductor', group: 'circuit', W: 80, H: 20,
      parts: [['l', 0, 14, 12, 14], ['a', 19, 14, 7, 180, 360], ['a', 33, 14, 7, 180, 360], ['a', 47, 14, 7, 180, 360], ['a', 61, 14, 7, 180, 360], ['l', 68, 14, 80, 14]], pins: { a: [0, 14], b: [80, 14] } },
    diode: { label: 'Diode', group: 'circuit', W: 70, H: 30,
      parts: [['l', 0, 15, 22, 15], ['p', 22, 3, 22, 27, 46, 15], ['l', 46, 3, 46, 27], ['l', 46, 15, 70, 15]], pins: { a: [0, 15], k: [70, 15] } },
    dcSource: { label: 'DC source', group: 'circuit', W: 70, H: 44,
      parts: [['l', 0, 22, 17, 22], ['c', 35, 22, 18], ['l', 53, 22, 70, 22], ['t', 27, 22, '+'], ['t', 43, 22, '−']], pins: { p: [0, 22], n: [70, 22] } },
    acSource: { label: 'AC source', group: 'circuit', W: 70, H: 44,
      parts: [['l', 0, 22, 17, 22], ['c', 35, 22, 18], ['l', 53, 22, 70, 22], ['l', ...sine(35, 22, 22, 6)]], pins: { a: [0, 22], b: [70, 22] } },
    currentSource: { label: 'Current source', group: 'circuit', W: 70, H: 44,
      parts: [['l', 0, 22, 17, 22], ['c', 35, 22, 18], ['l', 53, 22, 70, 22], ['l', 25, 22, 45, 22], ['l', 39, 16, 45, 22, 39, 28]], pins: { a: [0, 22], b: [70, 22] } },
    battery: { label: 'Battery', group: 'circuit', W: 60, H: 40,
      parts: [['l', 0, 20, 26, 20], ['l', 26, 4, 26, 36], ['l', 34, 12, 34, 28], ['l', 35.5, 12, 35.5, 28], ['l', 35.5, 20, 60, 20], ['t', 18, 8, '+']], pins: { p: [0, 20], n: [60, 20] } },
    switch: { label: 'Switch', group: 'circuit', W: 80, H: 30,
      parts: [['l', 0, 22, 21.5, 22], ['d', 24, 22, 2.5], ['l', 24, 22, 54, 7], ['d', 56, 22, 2.5], ['l', 58.5, 22, 80, 22]], pins: { a: [0, 22], b: [80, 22] } },
    ground: { label: 'Ground', group: 'circuit', W: 40, H: 32,
      parts: [['l', 20, 0, 20, 14], ['l', 4, 14, 36, 14], ['l', 10, 21, 30, 21], ['l', 16, 28, 24, 28]], pins: { g: [20, 0] } },
    junction: { label: 'Junction', group: 'circuit', W: 10, H: 10,
      parts: [['d', 5, 5, 4]], pins: { j: [5, 5] } },
    opamp: { label: 'Op-amp', group: 'circuit', W: 90, H: 80,
      parts: [['p', 15, 5, 15, 75, 80, 40], ['l', 0, 25, 15, 25], ['l', 0, 55, 15, 55], ['l', 80, 40, 90, 40], ['t', 24, 25, '−'], ['t', 24, 55, '+']],
      pins: { inn: [0, 25], inp: [0, 55], out: [90, 40] } },
    // ── mechanics ──
    pin: { label: 'Pin support', group: 'mech', W: 50, H: 40,
      parts: [['p', 25, 6, 9, 30, 41, 30], ['c', 25, 6, 4], ['l', 2, 30, 48, 30], ...hatch(6, 46, 30, -6, 8, 8)], pins: { pin: [25, 6] } },
    roller: { label: 'Roller support', group: 'mech', W: 50, H: 48,
      parts: [['p', 25, 6, 11, 27, 39, 27], ['c', 25, 6, 4], ['c', 17, 32.5, 5], ['c', 33, 32.5, 5], ['l', 2, 38, 48, 38], ...hatch(6, 46, 38, -6, 8, 8)], pins: { pin: [25, 6] } },
    fixed: { label: 'Fixed support', group: 'mech', W: 24, H: 70,
      parts: [['l', 18, 0, 18, 70], ...Array.from({ length: 9 }, (_, i) => ['l', 18, 4 + i * 8, 8, 12 + i * 8])], pins: { face: [18, 35] } },
    spring: { label: 'Spring', group: 'mech', W: 80, H: 24,
      parts: [['l', 0, 12, 14, 12], ['l', ...zig(14, 66, 12, 9, 8)], ['l', 66, 12, 80, 12]], pins: { a: [0, 12], b: [80, 12] } },
    damper: { label: 'Damper', group: 'mech', W: 80, H: 30,
      parts: [['l', 0, 15, 26, 15], ['l', 50, 4, 26, 4, 26, 26, 50, 26], ['l', 40, 8, 40, 22], ['l', 40, 15, 80, 15]], pins: { a: [0, 15], b: [80, 15] } },
    mass: { label: 'Mass', group: 'mech', W: 60, H: 50,
      parts: [['p', 0, 0, 60, 0, 60, 50, 0, 50], ['t', 30, 25, 'm']], pins: { n: [30, 0], e: [60, 25], s: [30, 50], w: [0, 25] } },
    pulley: { label: 'Pulley', group: 'mech', W: 50, H: 50,
      parts: [['c', 25, 25, 22], ['d', 25, 25, 3.5]], pins: { n: [25, 3], e: [47, 25], s: [25, 47], w: [3, 25] } }
  };
  const ORDER = Object.keys(SYMBOLS);

  /* ── the parts, placed ─────────────────────────────────────────── */
  /** a symbol's parts in board units, for its box: points mapped, circles kept round */
  function placed(it) {
    const S = SYMBOLS[it.kind] || SYMBOLS.resistor;
    const sx = it.w / S.W, sy = it.h / S.H, k = Math.min(Math.abs(sx), Math.abs(sy));
    const X = v => it.x + v * sx, Y = v => it.y + v * sy;
    return { S, k, parts: S.parts.map(p => {
      const [t, ...a] = p;
      if (t === 'c' || t === 'd') return [t, X(a[0]), Y(a[1]), a[2] * k];
      if (t === 'a') return [t, X(a[0]), Y(a[1]), a[2] * k, a[3], a[4]];
      if (t === 't') return [t, X(a[0]), Y(a[1]), a[2]];
      return [t, ...a.map((v, i) => i % 2 ? Y(v) : X(v))];
    }) };
  }

  function draw(ctx, it, r) {
    const { k, parts } = placed(it);
    const col = U.color(it.color || 'ink');
    ctx.strokeStyle = ctx.fillStyle = col;
    ctx.lineWidth = it.size || 2;
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const p of parts) {
      const t = p[0];
      ctx.beginPath();
      if (t === 'c') { ctx.arc(p[1], p[2], p[3], 0, Math.PI * 2); ctx.stroke(); }
      else if (t === 'd') { ctx.arc(p[1], p[2], p[3], 0, Math.PI * 2); ctx.fill(); }
      else if (t === 'a') { ctx.arc(p[1], p[2], p[3], p[4] * Math.PI / 180, p[5] * Math.PI / 180); ctx.stroke(); }
      else if (t === 't') {
        ctx.font = `600 ${U.round(14 * k, 2)}px "Segoe UI",system-ui,sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p[3], p[1], p[2]);
      } else {
        ctx.moveTo(p[1], p[2]);
        for (let i = 3; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        if (t === 'p' || t === 'f') ctx.closePath();
        if (t === 'f') ctx.fill(); else ctx.stroke();
      }
    }
    if (it.label) {
      // upright whatever the turn: undo the item's turn about where the label sits
      const at = labelAt(it), fs = it.textSize || 14;
      ctx.save();
      ctx.translate(at.x, at.y);
      if (it.rot) ctx.rotate(-it.rot);
      ctx.font = `${fs}px "Segoe UI",system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(it.label, 0, 0);
      ctx.restore();
    }
  }
  /** where the label goes: just over the symbol's box, in its own frame */
  const labelAt = it => ({ x: it.x + it.w / 2, y: it.y - (it.textSize || 14) * 0.45 });

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function svg(it) {
    const { k, parts } = placed(it), r = v => U.round(v, 2);
    const col = U.color(it.color || 'ink'), sw = r(it.size || 2);
    const o = [];
    for (const p of parts) {
      const t = p[0];
      if (t === 'c') o.push(`<circle cx="${r(p[1])}" cy="${r(p[2])}" r="${r(p[3])}" fill="none" stroke="${col}" stroke-width="${sw}"/>`);
      else if (t === 'd') o.push(`<circle cx="${r(p[1])}" cy="${r(p[2])}" r="${r(p[3])}" fill="${col}"/>`);
      else if (t === 'a') {
        const a0 = p[4] * Math.PI / 180, a1 = p[5] * Math.PI / 180;
        const x0 = p[1] + Math.cos(a0) * p[3], y0 = p[2] + Math.sin(a0) * p[3], x1 = p[1] + Math.cos(a1) * p[3], y1 = p[2] + Math.sin(a1) * p[3];
        o.push(`<path d="M${r(x0)} ${r(y0)}A${r(p[3])} ${r(p[3])} 0 ${Math.abs(p[5] - p[4]) > 180 ? 1 : 0} 1 ${r(x1)} ${r(y1)}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`);
      } else if (t === 't') o.push(`<text x="${r(p[1])}" y="${r(p[2])}" font-size="${r(14 * k)}" font-weight="600" font-family="Segoe UI, sans-serif" fill="${col}" text-anchor="middle" dominant-baseline="middle">${esc(p[3])}</text>`);
      else {
        let d = `M${r(p[1])} ${r(p[2])}`;
        for (let i = 3; i < p.length; i += 2) d += `L${r(p[i])} ${r(p[i + 1])}`;
        if (t === 'p' || t === 'f') d += 'Z';
        o.push(`<path d="${d}" fill="${t === 'f' ? col : 'none'}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
    }
    if (it.label) {
      const at = labelAt(it), deg = it.rot ? -it.rot * 180 / Math.PI : 0;
      o.push(`<text x="${r(at.x)}" y="${r(at.y)}" font-size="${it.textSize || 14}" font-family="Segoe UI, sans-serif" fill="${col}" text-anchor="middle"${deg ? ` transform="rotate(${r(deg)} ${r(at.x)} ${r(at.y)})"` : ''}>${esc(it.label)}</text>`);
    }
    return '<g>' + o.join('') + '</g>';
  }

  /** a symbol's picture for a button: its parts in a 24-ish box */
  function icon(kind) {
    const S = SYMBOLS[kind], s = Math.min(30 / Math.max(S.W, S.H), 0.9);   // a dot stays a dot
    const it = { kind, x: (32 - S.W * s) / 2, y: (32 - S.H * s) / 2, w: S.W * s, h: S.H * s, size: 1.6, color: 'currentColor' };
    return `<svg viewBox="0 0 32 32" width="32" height="32">${svg(it).replace(/stroke-width="[\d.]+"/g, 'stroke-width="1.6"')}</svg>`;
  }

  /* ── the item ──────────────────────────────────────────────────── */
  D.ext.items.symbol = {
    label: 'Symbol',
    bbox(it) {
      const pad = (it.size || 2) / 2 + 1;
      const b = { x: it.x - pad, y: it.y - pad, w: it.w + pad * 2, h: it.h + pad * 2 };
      if (it.label) { const fs = it.textSize || 14; b.y -= fs * 1.4; b.h += fs * 1.4; }
      return b;
    },
    draw, svg,
    rotate: 'box',
    /** the terminals, to snap and attach lines to; and the middle */
    snapPoints(it) {
      const S = SYMBOLS[it.kind] || SYMBOLS.resistor, sx = it.w / S.W, sy = it.h / S.H;
      const out = Object.entries(S.pins).map(([k, [px, py]]) => ({ k, x: it.x + px * sx, y: it.y + py * sy, t: 'end' }));
      if (!S.pins.j) out.push({ k: 'c', x: it.x + it.w / 2, y: it.y + it.h / 2, t: 'centre' });
      return out;
    },
    edit(app, it) { const f = document.querySelector('.symbol-label'); if (f) f.focus(); },
    panel(ui, items) {
      const app = ui.app, first = items[0], one = items.length === 1;
      const lab = el('input', { class: 'symbol-label', type: 'text', spellcheck: 'false', placeholder: 'R1 = 4.7 kΩ', 'aria-label': 'Label' });
      lab.value = one ? first.label || '' : '';
      lab.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') lab.blur(); });
      lab.addEventListener('change', () => ui.apply(items, it => { it.label = lab.value.trim(); }));
      ui.add(
        ui.group(one ? (SYMBOLS[first.kind] || {}).label || 'Symbol' : items.length + ' symbols', one ? lab : null),
        ui.group('Colour', ui.swatches(ui.palette(), first.color, c => ui.apply(items, it => { it.color = c; }))),
        ui.group('Weight', ui.sizes([1.25, 2, 3, 4.5], first.size || 2, s => ui.apply(items, it => { it.size = s; }), first.color)),
        ui.group('Label size', ui.seg([[11, 'S'], [14, 'M'], [18, 'L'], [24, 'XL']], first.textSize || 14, v => ui.apply(items, it => { it.textSize = v; }))),
        ui.slider('Opacity', first.alpha ?? 1, 0.1, 1, 0.05, v => ui.apply(items, it => it.alpha = v), v => Math.round(v * 100) + '%'),
        // another part in its place: the same middle and the same scale
        ...(one ? [ui.group('Change to'), ...pickerGroups(ui, first.kind, k => ui.apply([first], it => swap(it, k)))] : [])
      );
    }
  };

  function swap(it, kind) {
    const was = SYMBOLS[it.kind] || SYMBOLS.resistor, now = SYMBOLS[kind];
    if (!now || kind === it.kind) return;
    const k = it.w / was.W, cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    it.kind = kind; it.w = now.W * k; it.h = now.H * k;
    it.x = cx - it.w / 2; it.y = cy - it.h / 2;
  }

  function make(app, kind, at) {
    const S = SYMBOLS[kind] || SYMBOLS.resistor, o = app.opts.symbol;
    const k = o.scale || 1;
    return {
      id: U.uid(), type: 'symbol', kind, x: at.x - S.W * k / 2, y: at.y - S.H * k / 2, w: S.W * k, h: S.H * k,
      color: o.color || 'ink', size: o.size || 2, label: '', textSize: 14, alpha: 1
    };
  }

  /* ── the tool ──────────────────────────────────────────────────── */
  /* A tap puts the symbol picked in the panel there, centred; the tool
     stays out, for the next one. The middle of a symbol snaps like
     anything else, so parts line up on the grid or on each other. */
  class SymbolTool {
    constructor(app) { this.app = app; this.at = null; }
    down(ev) { this.at = { x: ev.x, y: ev.y }; }
    move(ev) { if (this.at) this.at = { x: ev.x, y: ev.y }; this.app.requestDrawLive(); }
    up() {
      const app = this.app, at = this.at;
      this.at = null;
      if (!at) return;
      const it = make(app, app.opts.symbol.kind, at);
      app.scene.begin('symbol'); app.scene.add(it); app.scene.commit();
      app.select([it]);
      app.afterEdit();
    }
    cancel() { this.at = null; }
    paint(r) {
      if (!this.at) return;
      // where it will land, while the pen is down
      const it = make(this.app, this.app.opts.symbol.kind, this.at);
      const ctx = r.liveWorld();
      ctx.save(); ctx.globalAlpha = 0.45; draw(ctx, it, r); ctx.restore();
    }
  }

  const PANEL_GROUPS = [['circuit', 'Circuits'], ['mech', 'Mechanics']];
  function pickerGroups(ui, now, pick) {
    return PANEL_GROUPS.map(([g, title]) => ui.group(title, el('div', { class: 'symbol-grid' },
      ORDER.filter(k => SYMBOLS[k].group === g).map(k => el('button', {
        class: 'symbol-pick' + (k === now ? ' on' : ''), type: 'button', title: SYMBOLS[k].label, 'aria-label': SYMBOLS[k].label,
        html: icon(k), onclick: () => pick(k)
      })))));
  }

  D.ext.opts.symbol = { kind: 'resistor', color: 'ink', size: 2, scale: 1 };

  D.ext.tools.push({
    name: 'symbol',
    create: app => new SymbolTool(app),
    rail: { icon: 'M2 12h4|M6 12l1.5-4 3 8 3-8 3 8 1.5-4|M18 12h4', key: 's', title: 'Symbols · S', after: 'graph' },
    panel: ui => {
      const app = ui.app, o = app.opts.symbol;
      ui.add(
        ...pickerGroups(ui, o.kind, k => { o.kind = k; app.savePrefs(); ui.buildPanel(); }),
        ui.group('Size', ui.seg([[0.75, 'S'], [1, 'M'], [1.5, 'L'], [2, 'XL']], o.scale || 1, v => { o.scale = v; app.savePrefs(); })),
        ui.group('', el('div', { class: 'rowlbl' }, el('span', { style: 'line-height:1.5' },
          'Tap to place. Draw a line or an arrow from one terminal to another and it stays attached as parts move. Ctrl+R stands a part up.')))
      );
    }
  });

  D.symbols = { SYMBOLS, ORDER, make, placed, icon, swap };
})(window.DPO);

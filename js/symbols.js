/* ── symbols.js ── circuits, logic and mechanics, drawn as fast as by hand
   Resistors, capacitors, inductors, diodes, sources, a battery, a switch,
   ground and an op-amp; AND, OR, NOT, NAND, NOR, XOR and XNOR gates, a
   buffer, flip-flops and a latch; pin and roller supports, a fixed wall,
   springs, dampers, a mass and a pulley.

   It has to be quicker than drawing them with the pen, so the symbol
   tool (S) works the way a circuit is sketched:

   · Drag from one point to another and a two-terminal part — a resistor,
     a capacitor, a source, a spring — spans exactly that: its leads
     stretch, its body stays the size it should be, and it lies along the
     drag (square to the page when the drag nearly is). Its ends snap to
     terminals, wire ends and the grid, so parts chain end to end. A tap
     drops one at its usual size.
   · Wire (in the strip, or W) draws wires: drag from a terminal to a
     terminal and a right-angled wire joins them, attached at both ends,
     its corner moving as the parts move. Where three or more conductors
     meet — a T, or two wires on one terminal — a junction dot is drawn.
   · A strip of the parts sits along the bottom while the tool is out:
     one tap picks the next part, no panel to hunt through.
   · Parts are named as they are placed — R1, R2, C1, V1, k1 — and a
     double-tap edits the label (R1 = 4.7 kΩ), by keys or by pen. The
     label stays upright however the part is turned.

   ── The item ─────────────────────────────────────────────────────────

   { type: 'symbol', kind, x, y, w, h, rot?, color, size, label, textSize }
   kind    a key of SYMBOLS below;  size  the line weight

   ── Drawing ──────────────────────────────────────────────────────────

   A symbol is drawn from a few parts in its own little box (W × H):
     ['l', x, y, x, y, …]        a polyline         ['p', …] the same, closed
     ['f', x, y, …]              a filled polygon   ['c', cx, cy, r] a circle
     ['d', cx, cy, r]            a filled dot       ['a', cx, cy, r, from°, to°] an arc
     ['t', x, y, text]           a small mark (+, −, m)
     ['o', x, y, x, y]           a bar over a mark (Q̄): a line, but a mark
   with `pins`: { key: [x, y] } its terminals. A two-terminal part also
   has `body`: [x0, x1], the span between its leads, and its pins on
   either end at the same height: stretched wider than W, only the leads
   grow. Canvas, SVG and the strip's icons all draw from the same parts. */
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

  /** a quadratic curve, as the points of a polyline (without its first) */
  const quad = (x0, y0, cx, cy, x1, y1, n = 10) => {
    const o = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      o.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
    }
    return o;
  };

  /* The gates share one frame, 84 × 50: inputs at 15 and 35, the output
     at 25. An AND is a flat back and a half-round nose; an OR a curved
     back and a pointed one, which XOR doubles. The bubble of a NAND, NOR
     or XNOR sits on the nose, its output lead beyond it. */
  const andBody = { tip: 60, back: 14, parts: [['l', 40, 5, 14, 5, 14, 45, 40, 45], ['a', 40, 25, 20, -90, 90]] };
  const orBody = { tip: 66, back: 15.75, parts: [['p', 12, 5, ...quad(12, 5, 50, 5, 66, 25), ...quad(66, 25, 50, 45, 12, 45), ...quad(12, 45, 22, 25, 12, 5)]] };
  function gate(name, body, invert, exclusive) {
    const parts = body.parts.slice(), lead = exclusive ? 9.75 : body.back;
    if (exclusive) parts.push(['l', 6, 5, ...quad(6, 5, 16, 25, 6, 45)]);
    parts.push(['l', 0, 15, lead, 15], ['l', 0, 35, lead, 35]);
    if (invert) parts.push(['c', body.tip + 4, 25, 4], ['l', body.tip + 8, 25, 84, 25]);
    else parts.push(['l', body.tip, 25, 84, 25]);
    return { label: name + ' gate', group: 'logic', W: 84, H: 50, parts, pins: { a: [0, 15], b: [0, 35], y: [84, 25] } };
  }
  /* A flip-flop or latch: a box with its inputs down the left (a clock
     drawn as the wedge on the box's edge), Q and Q̄ on the right. */
  function latch(label, ins) {
    const top = ins[0][1], bot = ins[ins.length - 1][1];
    const parts = [['p', 16, 5, 64, 5, 64, 85, 16, 85], ['l', 64, top, 80, top], ['l', 64, bot, 80, bot],
      ['t', 55, top, 'Q'], ['t', 55, bot, 'Q'], ['o', 50.5, bot - 8, 59.5, bot - 8]];
    const pins = {};
    for (const [k, y] of ins) {
      parts.push(['l', 0, y, 16, y]);
      if (k === 'clk') parts.push(['l', 16, y - 6, 24, y, 16, y + 6]);
      else parts.push(['t', 24, y, k]);
      pins[k] = [0, y];
    }
    pins.q = [80, top]; pins.qn = [80, bot];
    return { label, group: 'logic', W: 80, H: 90, parts, pins };
  }

  /* prefix: what an automatic name starts with (R1, C1…); none for parts with no name */
  const SYMBOLS = {
    // ── circuits: two terminals, left and right, unless said ──
    resistor: { label: 'Resistor', group: 'circuit', prefix: 'R', W: 80, H: 24, body: [16, 64],
      parts: [['l', 0, 12, 16, 12], ['l', ...zig(16, 64, 12, 8, 6)], ['l', 64, 12, 80, 12]], pins: { a: [0, 12], b: [80, 12] } },
    resistorBox: { label: 'Resistor (IEC)', group: 'circuit', prefix: 'R', W: 80, H: 24, body: [18, 62],
      parts: [['l', 0, 12, 18, 12], ['p', 18, 4, 62, 4, 62, 20, 18, 20], ['l', 62, 12, 80, 12]], pins: { a: [0, 12], b: [80, 12] } },
    capacitor: { label: 'Capacitor', group: 'circuit', prefix: 'C', W: 60, H: 40, body: [26, 34],
      parts: [['l', 0, 20, 26, 20], ['l', 26, 4, 26, 36], ['l', 34, 4, 34, 36], ['l', 34, 20, 60, 20]], pins: { a: [0, 20], b: [60, 20] } },
    inductor: { label: 'Inductor', group: 'circuit', prefix: 'L', W: 80, H: 20, body: [12, 68],
      parts: [['l', 0, 14, 12, 14], ['a', 19, 14, 7, 180, 360], ['a', 33, 14, 7, 180, 360], ['a', 47, 14, 7, 180, 360], ['a', 61, 14, 7, 180, 360], ['l', 68, 14, 80, 14]], pins: { a: [0, 14], b: [80, 14] } },
    diode: { label: 'Diode', group: 'circuit', prefix: 'D', W: 70, H: 30, body: [22, 46],
      parts: [['l', 0, 15, 22, 15], ['p', 22, 3, 22, 27, 46, 15], ['l', 46, 3, 46, 27], ['l', 46, 15, 70, 15]], pins: { a: [0, 15], k: [70, 15] } },
    dcSource: { label: 'DC source', group: 'circuit', prefix: 'V', W: 70, H: 44, body: [17, 53],
      parts: [['l', 0, 22, 17, 22], ['c', 35, 22, 18], ['l', 53, 22, 70, 22], ['t', 27, 22, '+'], ['t', 43, 22, '−']], pins: { p: [0, 22], n: [70, 22] } },
    acSource: { label: 'AC source', group: 'circuit', prefix: 'V', W: 70, H: 44, body: [17, 53],
      parts: [['l', 0, 22, 17, 22], ['c', 35, 22, 18], ['l', 53, 22, 70, 22], ['l', ...sine(35, 22, 22, 6)]], pins: { a: [0, 22], b: [70, 22] } },
    currentSource: { label: 'Current source', group: 'circuit', prefix: 'I', W: 70, H: 44, body: [17, 53],
      parts: [['l', 0, 22, 17, 22], ['c', 35, 22, 18], ['l', 53, 22, 70, 22], ['l', 25, 22, 45, 22], ['l', 39, 16, 45, 22, 39, 28]], pins: { a: [0, 22], b: [70, 22] } },
    battery: { label: 'Battery', group: 'circuit', prefix: 'B', W: 60, H: 40, body: [26, 36],
      parts: [['l', 0, 20, 26, 20], ['l', 26, 4, 26, 36], ['l', 34, 12, 34, 28], ['l', 35.5, 12, 35.5, 28], ['l', 35.5, 20, 60, 20], ['t', 18, 8, '+']], pins: { p: [0, 20], n: [60, 20] } },
    switch: { label: 'Switch', group: 'circuit', prefix: 'S', W: 80, H: 30, body: [21.5, 58.5],
      parts: [['l', 0, 22, 21.5, 22], ['d', 24, 22, 2.5], ['l', 24, 22, 54, 7], ['d', 56, 22, 2.5], ['l', 58.5, 22, 80, 22]], pins: { a: [0, 22], b: [80, 22] } },
    ground: { label: 'Ground', group: 'circuit', W: 40, H: 32,
      parts: [['l', 20, 0, 20, 14], ['l', 4, 14, 36, 14], ['l', 10, 21, 30, 21], ['l', 16, 28, 24, 28]], pins: { g: [20, 0] } },
    junction: { label: 'Junction', group: 'circuit', W: 10, H: 10,
      parts: [['d', 5, 5, 4]], pins: { j: [5, 5] } },
    opamp: { label: 'Op-amp', group: 'circuit', prefix: 'U', W: 90, H: 80,
      parts: [['p', 15, 5, 15, 75, 80, 40], ['l', 0, 25, 15, 25], ['l', 0, 55, 15, 55], ['l', 80, 40, 90, 40], ['t', 24, 25, '−'], ['t', 24, 55, '+']],
      pins: { inn: [0, 25], inp: [0, 55], out: [90, 40] } },
    // ── logic: inputs on the left, the output on the right ──
    and: gate('AND', andBody, false), nand: gate('NAND', andBody, true),
    or: gate('OR', orBody, false), nor: gate('NOR', orBody, true),
    xor: gate('XOR', orBody, false, true), xnor: gate('XNOR', orBody, true, true),
    buffer: { label: 'Buffer', group: 'logic', W: 80, H: 40, body: [18, 58],
      parts: [['l', 0, 20, 18, 20], ['p', 18, 6, 18, 34, 58, 20], ['l', 58, 20, 80, 20]], pins: { a: [0, 20], y: [80, 20] } },
    not: { label: 'NOT (inverter)', group: 'logic', W: 80, H: 40, body: [18, 62],
      parts: [['l', 0, 20, 18, 20], ['p', 18, 6, 18, 34, 54, 20], ['c', 58, 20, 4], ['l', 62, 20, 80, 20]], pins: { a: [0, 20], y: [80, 20] } },
    dff: latch('D flip-flop', [['D', 25], ['clk', 65]]),
    jkff: latch('JK flip-flop', [['J', 20], ['clk', 45], ['K', 70]]),
    srlatch: latch('SR latch', [['S', 25], ['R', 65]]),
    // ── mechanics ──
    spring: { label: 'Spring', group: 'mech', prefix: 'k', W: 80, H: 24, body: [14, 66],
      parts: [['l', 0, 12, 14, 12], ['l', ...zig(14, 66, 12, 9, 8)], ['l', 66, 12, 80, 12]], pins: { a: [0, 12], b: [80, 12] } },
    damper: { label: 'Damper', group: 'mech', prefix: 'c', W: 80, H: 30, body: [26, 50],
      parts: [['l', 0, 15, 26, 15], ['l', 50, 4, 26, 4, 26, 26, 50, 26], ['l', 40, 8, 40, 22], ['l', 40, 15, 80, 15]], pins: { a: [0, 15], b: [80, 15] } },
    pin: { label: 'Pin support', group: 'mech', W: 50, H: 40,
      parts: [['p', 25, 6, 9, 30, 41, 30], ['c', 25, 6, 4], ['l', 2, 30, 48, 30], ...hatch(6, 46, 30, -6, 8, 8)], pins: { pin: [25, 6] } },
    roller: { label: 'Roller support', group: 'mech', W: 50, H: 48,
      parts: [['p', 25, 6, 11, 27, 39, 27], ['c', 25, 6, 4], ['c', 17, 32.5, 5], ['c', 33, 32.5, 5], ['l', 2, 38, 48, 38], ...hatch(6, 46, 38, -6, 8, 8)], pins: { pin: [25, 6] } },
    fixed: { label: 'Fixed support', group: 'mech', W: 24, H: 70,
      parts: [['l', 18, 0, 18, 70], ...Array.from({ length: 9 }, (_, i) => ['l', 18, 4 + i * 8, 8, 12 + i * 8])], pins: { face: [18, 35] } },
    mass: { label: 'Mass', group: 'mech', prefix: 'm', W: 60, H: 50,
      parts: [['p', 0, 0, 60, 0, 60, 50, 0, 50], ['t', 30, 25, 'm']], pins: { n: [30, 0], e: [60, 25], s: [30, 50], w: [0, 25] } },
    pulley: { label: 'Pulley', group: 'mech', W: 50, H: 50,
      parts: [['c', 25, 25, 22], ['d', 25, 25, 3.5]], pins: { n: [25, 3], e: [47, 25], s: [25, 47], w: [3, 25] } }
  };
  const ORDER = Object.keys(SYMBOLS);
  const two = S => !!S.body;
  const pinY = S => S.pins[Object.keys(S.pins)[0]][1];

  /* ── the parts, placed ─────────────────────────────────────────── */
  /**
   * How a symbol's own coordinates land in its box. A two-terminal part
   * keeps its body in proportion (k, from its height) and gives the rest
   * of the width to its leads; anything else is scaled to the box, with
   * circles kept round.
   */
  function mapper(it) {
    const S = SYMBOLS[it.kind] || SYMBOLS.resistor;
    if (two(S)) {
      const [b0, b1] = S.body, bodyW = b1 - b0;
      const k = Math.min(Math.abs(it.h / S.H), Math.abs(it.w) / bodyW);
      const lead = Math.max(0, (it.w - bodyW * k) / 2);
      const X = v => it.x + (v <= b0 ? (b0 ? v / b0 : 0) * lead : v >= b1 ? it.w - (S.W - b1 ? (S.W - v) / (S.W - b1) : 0) * lead : lead + (v - b0) * k);
      // the body sits on the pins' line, which runs through the middle of the box's height
      const Y = v => it.y + it.h / 2 + (v - pinY(S)) * k;
      return { S, k, X, Y };
    }
    const sx = it.w / S.W, sy = it.h / S.H;
    return { S, k: Math.min(Math.abs(sx), Math.abs(sy)), X: v => it.x + v * sx, Y: v => it.y + v * sy };
  }

  /** the parts in the item's box; without `marks`, no letters or bars over them */
  function placed(it, marks = true) {
    const { S, k, X, Y } = mapper(it);
    return { S, k, parts: (marks ? S.parts : S.parts.filter(p => p[0] !== 't' && p[0] !== 'o')).map(p => {
      const [t, ...a] = p;
      if (t === 'c' || t === 'd') return [t, X(a[0]), Y(a[1]), a[2] * k];
      if (t === 'a') return [t, X(a[0]), Y(a[1]), a[2] * k, a[3], a[4]];
      if (t === 't') return [t, X(a[0]), Y(a[1]), a[2]];
      return [t, ...a.map((v, i) => i % 2 ? Y(v) : X(v))];
    }) };
  }

  function draw(ctx, it) {
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
      // upright whatever the turn: the item's turn undone about where the label sits
      const at = labelAt(it), fs = it.textSize || 14;
      ctx.save();
      ctx.translate(at.x, at.y);
      if (it.rot) ctx.rotate(-it.rot);
      ctx.font = `${fs}px "Segoe UI",system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.label, 0, 0);
      ctx.restore();
    }
  }
  /**
   * Where the label goes, in the symbol's own frame: just clear of its
   * body on the side away from the page's bottom, so a part stood on end
   * has its name beside it rather than through it.
   */
  function labelAt(it) {
    const { S, k, Y } = mapper(it), fs = it.textSize || 14;
    let top = Infinity;
    for (const p of S.parts) for (let i = 2; i < p.length && p[0] !== 't'; i += 2) if (typeof p[i] === 'number') top = Math.min(top, p[i] - (p[0] === 'c' || p[0] === 'a' ? p[3] : 0));
    const cx = it.x + it.w / 2;
    const above = (isFinite(top) ? Y(top) : it.y) - fs * 0.75;
    // turned more than a little past upright, the "top" faces sideways or down: say it beside, the other way up
    const r = it.rot ? Math.atan2(Math.sin(it.rot), Math.cos(it.rot)) : 0;
    if (Math.abs(r) > 3 * Math.PI / 4) return { x: cx, y: it.y + it.h / 2 + (it.y + it.h / 2 - above) };
    return { x: cx, y: above };
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = it => markup(it, true);
  function markup(it, marks) {
    const { k, parts } = placed(it, marks), r = v => U.round(v, 2);
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
      o.push(`<text x="${r(at.x)}" y="${r(at.y)}" font-size="${it.textSize || 14}" font-family="Segoe UI, sans-serif" fill="${col}" text-anchor="middle" dominant-baseline="middle"${deg ? ` transform="rotate(${r(deg)} ${r(at.x)} ${r(at.y)})"` : ''}>${esc(it.label)}</text>`);
    }
    return '<g>' + o.join('') + '</g>';
  }

  /** a symbol's picture for a button */
  function icon(kind, px = 32) {
    const S = SYMBOLS[kind], s = Math.min((px - 2) / Math.max(S.W, S.H), 0.9);   // a dot stays a dot
    const it = { kind, x: (px - S.W * s) / 2, y: (px - S.H * s) / 2, w: S.W * s, h: S.H * s, size: 1.6, color: 'currentColor' };
    /* marks too small to read (a flip-flop's D and Q at button size) are
       only blots: the shape alone says which part it is */
    return `<svg viewBox="0 0 ${px} ${px}" width="${px}" height="${px}">${markup(it, 14 * s >= 6).replace(/stroke-width="[\d.]+"/g, 'stroke-width="1.6"')}</svg>`;
  }

  /* ── the item ──────────────────────────────────────────────────── */
  D.ext.items.symbol = {
    label: 'Symbol',
    bbox(it) {
      const pad = (it.size || 2) / 2 + 1;
      const b = { x: it.x - pad, y: it.y - pad, w: it.w + pad * 2, h: it.h + pad * 2 };
      if (it.label) {
        /* Grown to take the label in, but evenly about the part's own
           middle: a turned box turns about the middle of this box, and a
           label off to one side would swing the part off its terminals. */
        const at = labelAt(it), fs = it.textSize || 14, tw = Math.max(fs * 2, String(it.label).length * fs * 0.6);
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
        const hw = Math.max(b.w / 2, Math.abs(at.x - cx) + tw / 2), hh = Math.max(b.h / 2, Math.abs(at.y - cy) + fs * 0.7);
        return { x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2 };
      }
      return b;
    },
    draw, svg,
    rotate: 'box',
    /** the terminals, to snap and attach to; and the middle */
    snapPoints(it) {
      const { S, X, Y } = mapper(it);
      const out = Object.entries(S.pins).map(([k, [px, py]]) => ({ k, x: X(px), y: Y(py), t: 'end' }));
      if (!S.pins.j) out.push({ k: 'c', x: it.x + it.w / 2, y: it.y + it.h / 2, t: 'centre' });
      return out;
    },
    edit(app, it) { editLabel(app, it); },
    panel(ui, items) {
      const app = ui.app, first = items[0], one = items.length === 1;
      ui.add(
        ui.group(one ? (SYMBOLS[first.kind] || {}).label || 'Symbol' : items.length + ' symbols',
          one ? el('button', { class: 'btn symbol-labelb', type: 'button', onclick: () => editLabel(app, first) }, first.label ? first.label : 'Add a label') : null),
        ui.group('Colour', ui.swatches(ui.palette(), first.color, c => ui.apply(items, it => { it.color = c; }))),
        ui.group('Weight', ui.sizes([1.25, 2, 3, 4.5], first.size || 2, s => ui.apply(items, it => { it.size = s; }), first.color)),
        ui.group('Label size', ui.seg([[11, 'S'], [14, 'M'], [18, 'L'], [24, 'XL']], first.textSize || 14, v => ui.apply(items, it => { it.textSize = v; }))),
        ...(one ? [ui.group('Change to'), ...pickerGroups(ui, first.kind, k => ui.apply([first], it => swap(it, k)))] : [])
      );
    }
  };

  function swap(it, kind) {
    const was = SYMBOLS[it.kind] || SYMBOLS.resistor, now = SYMBOLS[kind];
    if (!now || kind === it.kind) return;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const k = two(was) ? mapper(it).k : it.w / was.W;
    // a two-terminal part changed for another keeps its span; anything else its scale
    const w = two(was) && two(now) ? it.w : now.W * k;
    it.kind = kind; it.w = w; it.h = now.H * k;
    it.x = cx - it.w / 2; it.y = cy - it.h / 2;
    if (it.label && was.prefix !== now.prefix) it.label = '';
  }

  /** the next free name for a kind of part: R3 when R1 and R2 are on the board */
  function nextName(scene, kind) {
    const pre = (SYMBOLS[kind] || {}).prefix;
    if (!pre) return '';
    let n = 0;
    const re = new RegExp('^' + pre + '(\\d+)');
    for (const it of scene.items) if (it.type === 'symbol' && it.label) { const m = re.exec(it.label); if (m) n = Math.max(n, +m[1]); }
    return pre + (n + 1);
  }

  /** a part of `kind`, of its usual size, with its middle at `at` */
  function make(app, kind, at) {
    const S = SYMBOLS[kind] || SYMBOLS.resistor, o = app.opts.symbol, k = o.scale || 1;
    return {
      id: U.uid(), type: 'symbol', kind, x: at.x - S.W * k / 2, y: at.y - S.H * k / 2, w: S.W * k, h: S.H * k,
      color: o.color || 'ink', size: o.size || 2, label: o.names === false ? '' : nextName(app.scene, kind), textSize: 14, alpha: 1
    };
  }

  /**
   * A two-terminal part with its terminals on a and b: its leads take up
   * the length, its body stays its size, and it is turned to lie along
   * a → b. Shorter than its body, it keeps its body's length about the
   * middle.
   */
  function spanning(app, kind, a, b) {
    const S = SYMBOLS[kind], it = make(app, kind, { x: 0, y: 0 });
    const k = it.h / S.H, minW = (S.body[1] - S.body[0]) * k + 12;
    const len = Math.max(Math.hypot(b.x - a.x, b.y - a.y), minW);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    it.w = len; it.x = cx - len / 2; it.y = cy - it.h / 2;
    if (Math.abs(ang) > 1e-6) it.rot = Math.atan2(Math.sin(ang), Math.cos(ang));
    return it;
  }

  /* ── the label, by keys or by pen ──────────────────────────────── */
  let labelPop = null;
  function closeLabel(commit) {
    if (!labelPop) return;
    const { app, it, input, el: box } = labelPop;
    labelPop = null;
    box.remove();
    if (typeof removeEventListener === 'function') removeEventListener('pointerdown', box._away, true);
    if (commit !== false && app.scene.get(it.id) && (input.value.trim() !== (it.label || ''))) {
      app.scene.begin('label'); app.scene.touch(it); it.label = input.value.trim(); app.scene.commit(); app.afterEdit();
    }
  }
  function editLabel(app, it) {
    closeLabel();
    const input = el('input', { class: 'symbol-label', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: (SYMBOLS[it.kind] || {}).prefix ? nextName(app.scene, it.kind) + ' = …' : 'Label' });
    input.value = it.label || '';
    if (D.inkmath) U.penField(input, () => D.inkmath.writePad(app, { title: 'Write the label', start: input.value, near: input, use: t => { input.value = t; closeLabel(); } }));
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); closeLabel(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeLabel(false); }
    });
    const box = el('div', { class: 'symbol-labelpop', role: 'dialog', 'aria-label': 'Label' },
      input,
      D.inkmath && D.inkmath.writePad ? el('button', { class: 'icon', type: 'button', title: 'Write it with the pen', 'aria-label': 'Write it with the pen',
        html: '<svg viewBox="0 0 24 24"><path d="M4 20l4.5-1.2L20 7.3a2 2 0 0 0 0-2.8l-.5-.5a2 2 0 0 0-2.8 0L5.2 15.5z"/><path d="M14.5 6.5l3 3"/></svg>',
        onclick: () => D.inkmath.writePad(app, { title: 'Write the label', start: input.value, near: box, use: t => { input.value = t; closeLabel(); } }) }) : null,
      el('button', { class: 'btn primary', type: 'button', onclick: () => closeLabel() }, 'Done'));
    document.body.appendChild(box);
    const b = app.scene.bbox(it), p = app.camera.toScreen(b.x + b.w / 2, b.y2);
    box.style.left = U.clamp(p.x - 150, 8, Math.max(8, innerWidth - 308)) + 'px';
    box.style.top = U.clamp(p.y + 10, 60, Math.max(60, innerHeight - 70)) + 'px';
    box._away = e => { if (!box.contains(e.target) && !(e.target.closest && e.target.closest('.inkmath-write'))) closeLabel(); };
    setTimeout(() => { if (labelPop && labelPop.el === box && typeof addEventListener === 'function') addEventListener('pointerdown', box._away, true); }, 0);
    labelPop = { app, it, input, el: box };
    if (app.pointerType === 'mouse') setTimeout(() => { try { input.focus(); input.select(); } catch (_) { } }, 20);
    return labelPop;
  }

  /* ── the tool ──────────────────────────────────────────────────── */
  /* Part mode: a tap drops the part picked; a drag lays a two-terminal
     part from where it started to where it ends (anything else is
     dropped where the drag ends). Wire mode: a drag from one terminal to
     another joins them with a square-cornered wire attached at both ends.
     Every end snaps, to terminals first. */
  class SymbolTool {
    constructor(app) { this.app = app; this.a = null; this.b = null; }
    get o() { return this.app.opts.symbol; }
    snap(ev, from) {
      const s = D.cad ? D.cad.snap(this.app, ev.x, ev.y, from ? { from } : {}) : { x: ev.x, y: ev.y, ref: null };
      // a drag that is nearly square to the page lies square to it
      if (from && !s.ref) {
        const dx = s.x - from.x, dy = s.y - from.y, ang = Math.atan2(dy, dx), q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(ang - q) < 0.14) { const l = Math.hypot(dx, dy); return { ...s, x: from.x + Math.cos(q) * l, y: from.y + Math.sin(q) * l }; }
      }
      return s;
    }
    down(ev) { this.a = this.snap(ev); this.b = null; this.moved = false; }
    move(ev) {
      if (!this.a) { this.hover = this.snap(ev); this.app.requestDrawLive(); return; }
      const z = this.app.camera.zoom;
      if (!this.moved && Math.hypot(ev.x - this.a.x, ev.y - this.a.y) * z < 10) return;
      this.moved = true;
      if (!this.dir) this.dir = Math.abs(ev.x - this.a.x) >= Math.abs(ev.y - this.a.y) ? 'h' : 'v';
      this.b = this.snap(ev, this.a);
      this.app.requestDrawLive();
    }
    pending() {
      const app = this.app, o = this.o, a = this.a, b = this.b;
      if (!a) return null;
      if (o.mode === 'wire') {
        if (!b) return null;
        return D.make.shape({ kind: 'line', x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, size: o.size || 2, color: o.color || 'ink',
          head1: 'none', head2: 'none', elbow: this.dir || 'h', wire: true, ...(a.ref ? { bind1: a.ref } : {}), ...(b.ref ? { bind2: b.ref } : {}) });
      }
      const S = SYMBOLS[o.kind] || SYMBOLS.resistor;
      if (b && two(S)) return spanning(app, o.kind, a, b);
      const at = b || a, it = make(app, o.kind, at);
      // a one-terminal part (ground, a support) dropped on a terminal: its terminal goes there
      if (at.ref && !two(S)) {
        const pin = mapper(it).S.pins[Object.keys(S.pins)[0]], m = mapper(it);
        it.x += at.x - m.X(pin[0]); it.y += at.y - m.Y(pin[1]);
      }
      return it;
    }
    up() {
      const app = this.app, it = this.pending();
      this.a = this.b = null; this.dir = null; this.moved = false;
      app.requestDrawLive();
      if (!it) return;
      app.scene.begin(it.type === 'symbol' ? 'symbol' : 'wire');
      app.scene.add(it);
      app.scene.commit();
      app.afterEdit();
    }
    cancel() { this.a = this.b = null; this.dir = null; this.hover = null; }
    paint(r) {
      const it = this.pending();
      if (it) {
        const ctx = r.liveWorld();
        ctx.save(); ctx.globalAlpha = 0.5; r.drawItem(ctx, it); ctx.restore();
      }
      if (D.cad) {
        const s = this.b || (this.a ? this.a : this.hover);
        if (s && s.t) D.cad.paintSnap(r, s, this.b ? this.a : null);
      }
    }
  }

  /* ── junctions ──────────────────────────────────────────────────
     Where three or more conductors meet, a wiring diagram puts a dot:
     three wire ends together, two wires on a part's terminal (its lead is
     the third), or a wire ending on the middle of another (that one runs
     on both ways). Two wires end to end, or one on a terminal, are only a
     corner or a connection, and get none. Worked out from the board once
     each time it changes, and drawn by the wires themselves. */
  const NEAR = 0.75;
  let jmemo = { scene: null, ver: -1, map: new Map() };
  const isWire = it => it.type === 'shape' && D.isLine(it) && (it.wire || it.elbow);
  function junctions(scene) {
    if (jmemo.scene === scene && jmemo.ver === scene.version) return jmemo.map;
    const wires = scene.items.filter(isWire);
    const paths = new Map(wires.map(w => [w, scene.linePath(w)]));
    const terms = [];
    for (const it of scene.items) if (it.type === 'symbol') for (const p of scene.snapPoints(it)) if (p.t === 'end') terms.push(p);
    const ends = [];
    for (const w of wires) { const p = paths.get(w), n = p.length; ends.push({ w, x: p[0], y: p[1] }, { w, x: p[n - 2], y: p[n - 1] }); }
    const map = new Map();
    for (const e of ends) {
      let count = 1;
      for (const o of ends) if (o !== e && Math.abs(o.x - e.x) < NEAR && Math.abs(o.y - e.y) < NEAR) count++;
      for (const t of terms) if (Math.abs(t.x - e.x) < NEAR && Math.abs(t.y - e.y) < NEAR) count++;
      // on the middle of another wire: it carries on both sides
      for (const w of wires) {
        if (w === e.w) continue;
        const p = paths.get(w);
        if (Math.hypot(p[0] - e.x, p[1] - e.y) < NEAR || Math.hypot(p[p.length - 2] - e.x, p[p.length - 1] - e.y) < NEAR) continue;
        if (U.pointNearPolyline(e.x, e.y, p, NEAR)) count += 2;
      }
      if (count >= 3) {
        if (!map.has(e.w)) map.set(e.w, []);
        map.get(e.w).push({ x: e.x, y: e.y });
      }
    }
    jmemo = { scene, ver: scene.version, map };
    return map;
  }
  D.wires = {
    dotsOf: (scene, w) => junctions(scene).get(w) || [],
    dotR: w => Math.max(2.6, (w.size || 2) * 1.7),
    junctions
  };

  /* ── the strip: the parts, along the bottom, while the tool is out ── */
  const STRIP = {
    circuit: ['resistor', 'capacitor', 'inductor', 'dcSource', 'acSource', 'diode', 'switch', 'ground', 'opamp', 'junction'],
    logic: ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buffer', 'dff', 'jkff', 'srlatch', 'junction'],
    mech: ['spring', 'damper', 'mass', 'pin', 'roller', 'fixed', 'pulley']
  };
  const GROUPS = [['circuit', 'Circuit', 'Circuits'], ['logic', 'Logic', 'Logic'], ['mech', 'Mech', 'Mechanics']];
  let strip = null;
  function showStrip(app) {
    const o = app.opts.symbol;
    if (!strip) {
      strip = el('div', { class: 'symbol-strip', role: 'toolbar', 'aria-label': 'Parts' });
      strip.addEventListener('pointerdown', e => e.stopPropagation());
      document.body.appendChild(strip);
    }
    /* the strip shows the group last chosen: the junction is in more than one */
    const group = STRIP[o.group] && STRIP[o.group].includes(o.kind) ? o.group : (SYMBOLS[o.kind] || {}).group || 'circuit';
    const pick = (k, g = group) => { o.kind = k; o.group = g; o.mode = 'part'; app.savePrefs(); showStrip(app); if (app.ui) app.ui.refresh(); };
    strip.replaceChildren(
      el('button', { class: 'symbol-mode' + (o.mode === 'wire' ? ' on' : ''), type: 'button', title: 'Wire: drag from a terminal to a terminal · W',
        html: '<svg viewBox="0 0 32 32" width="32" height="32"><path d="M4 22h10V10h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="22" r="2.6" fill="currentColor"/><circle cx="28" cy="10" r="2.6" fill="currentColor"/></svg><span>Wire</span>',
        onclick: () => { o.mode = o.mode === 'wire' ? 'part' : 'wire'; app.savePrefs(); showStrip(app); } }),
      el('span', { class: 'sep' }),
      ...STRIP[group].map(k => el('button', { class: 'symbol-pick' + (o.mode !== 'wire' && k === o.kind ? ' on' : ''), type: 'button', title: SYMBOLS[k].label, 'aria-label': SYMBOLS[k].label,
        html: icon(k, 30), onclick: () => pick(k) })),
      el('span', { class: 'sep' }),
      el('div', { class: 'symbol-groups', role: 'group', 'aria-label': 'Kind of part' },
        ...GROUPS.map(([g, short, title]) => el('button', { class: 'symbol-group' + (g === group ? ' on' : ''), type: 'button', title: title + ' parts',
          onclick: () => { if (g !== group) pick(STRIP[g][0], g); } }, short))));
    strip.hidden = false;
  }
  function hideStrip() { if (strip) strip.hidden = true; }

  function pickerGroups(ui, now, pick) {
    return GROUPS.map(([g, , title]) => ui.group(title, el('div', { class: 'symbol-grid' },
      ORDER.filter(k => SYMBOLS[k].group === g).map(k => el('button', {
        class: 'symbol-pick' + (k === now ? ' on' : ''), type: 'button', title: SYMBOLS[k].label, 'aria-label': SYMBOLS[k].label,
        html: icon(k), onclick: () => pick(k)
      })))));
  }

  D.ext.opts.symbol = { kind: 'resistor', group: 'circuit', mode: 'part', color: 'ink', size: 2, scale: 1, names: true };

  D.ext.tools.push({
    name: 'symbol',
    create: app => new SymbolTool(app),
    rail: { icon: 'M2.5 12h3|M5.5 12l1.5-5 3 10 3-10 3 10 1.5-5|M18.5 12h3', key: 's', title: 'Circuits, logic and mechanics · S', after: 'graph' },
    panel: ui => {
      const app = ui.app, o = app.opts.symbol;
      ui.add(
        ui.group('Mode', ui.seg([['part', 'Parts'], ['wire', 'Wires']], o.mode || 'part', v => { o.mode = v; app.savePrefs(); showStrip(app); })),
        ...pickerGroups(ui, o.kind, k => { o.kind = k; o.group = SYMBOLS[k].group; o.mode = 'part'; app.savePrefs(); showStrip(app); ui.buildPanel(); }),
        ui.group('Size', ui.seg([[0.75, 'S'], [1, 'M'], [1.5, 'L'], [2, 'XL']], o.scale || 1, v => { o.scale = v; app.savePrefs(); })),
        ui.group('', ui.check('Name parts as they are placed (R1, C1…)', o.names !== false, v => { o.names = v; app.savePrefs(); })),
        ui.group('', el('div', { class: 'rowlbl' }, el('span', { style: 'line-height:1.5' },
          'Drag from one point to another to lay a part between them; tap to drop one. Wires: drag from a terminal to a terminal. Double-tap a part to label it.')))
      );
    }
  });

  D.ext.on('tool', (app, name) => { if (name === 'symbol') showStrip(app); else hideStrip(); });
  D.ext.on('board', () => closeLabel(false));
  // W, while the tool is out: wires and parts
  D.ext.on('key', (app, e) => {
    if (app.toolName !== 'symbol' || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'w' && e.key !== 'W')) return;
    const o = app.opts.symbol; o.mode = o.mode === 'wire' ? 'part' : 'wire'; showStrip(app); if (app.ui) app.ui.refresh();
    return true;
  });

  D.symbols = { SYMBOLS, ORDER, make, spanning, placed, mapper, icon, swap, nextName, editLabel, closeLabel, SymbolTool };
})(window.DPO);

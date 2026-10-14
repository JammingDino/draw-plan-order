/* Handwritten maths (js/inkmath.js): the recogniser, the reading of a
   line, and the answers it leaves on the board.

   The recogniser's templates are synthesised from glyph outlines in
   js/inkmath.js. Testing it against the same outlines would flatter it,
   so the ink here comes from a second, independent hand — every symbol
   drawn differently (a looped 2, an open 4, a 9 with a straight stem, a
   curly x, a 5 with its bar drawn first or last), then slanted, squeezed,
   turned, wobbled, sampled at an uneven pen speed, with strokes drawn in
   either direction and in any order. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { load, fakeApp } from './harness.mjs';

const LIB = readFileSync(new URL('../vendor/mathjs/math.min.js', import.meta.url), 'utf8');
const HOST = ['Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'Map', 'Set', 'RegExp', 'JSON', 'Math', 'Date',
  'Float32Array', 'Uint8Array', 'Uint8ClampedArray', 'Int32Array'];
const mathjs = g => { for (const k of HOST) delete g[k]; vm.runInContext(LIB, g, { filename: 'math.min.js' }); };

/* localStorage, for the personal templates */
const store = new Map();
const storage = g => {
  g.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
};

const D = load('util.js', storage, mathjs, 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js', 'math.js', 'calc.js', 'inkmath.js');
await D.math.ready();
const IM = D.inkmath;

/* ── a second hand ───────────────────────────────────────────────────
   Digit height 1, y down, baseline at 1. Lower-case letters are written
   at x-height (0.62) by `small`, operators centred in the line. */
const arc = (cx, cy, rx, ry, a0, a1, n = 16) => {
  const o = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; o.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
  return o;
};
const fit = (strokes, x0, y0, sx, sy) => strokes.map(s => s.map((v, i) => i % 2 ? y0 + v * sy : x0 + v * sx));
const small = st => fit(st, 0, 0.38, 0.62, 0.62);
const op = st => fit(st, 0, 0.22, 0.6, 0.6);

const HAND = {
  '0': [[arc(0.32, 0.5, 0.3, 0.5, -60, 300)], [arc(0.3, 0.5, 0.25, 0.5, -95, 268)]],
  '1': [[[0.3, 0, 0.27, 1]], [[0.1, 0.24, 0.3, 0, 0.3, 0, 0.29, 1]]],
  '2': [[[0.05, 0.25, 0.25, 0.02, 0.5, 0.05, 0.55, 0.3, 0.35, 0.62, 0.08, 0.92, 0.12, 0.82, 0.22, 0.9, 0.6, 0.97]],
    [[0.08, 0.2, 0.3, 0.0, 0.55, 0.15, 0.48, 0.42, 0.04, 1.0, 0.04, 1.0, 0.6, 1.0]]],
  '3': [[[0.08, 0.12, 0.35, 0.0, 0.55, 0.18, 0.35, 0.45, 0.35, 0.45, 0.58, 0.65, 0.5, 0.92, 0.25, 1.0, 0.05, 0.85]]],
  '4': [[[0.4, 0, 0.05, 0.62, 0.05, 0.62, 0.6, 0.62], [0.42, 0.2, 0.42, 1.0]],
    [[0.1, 0.02, 0.06, 0.58, 0.06, 0.58, 0.62, 0.58], [0.45, 0.0, 0.47, 1.05]]],
  '5': [[[0.55, 0.02, 0.12, 0.02], [0.12, 0.02, 0.1, 0.42, 0.1, 0.42, 0.4, 0.36, 0.58, 0.6, 0.48, 0.92, 0.2, 1.0, 0.03, 0.88]],
    [[0.56, 0.02, 0.14, 0.03, 0.14, 0.03, 0.1, 0.44, 0.1, 0.44, 0.38, 0.38, 0.57, 0.6, 0.5, 0.9, 0.22, 1.0, 0.03, 0.9]]],
  '6': [[[0.48, 0.0, 0.2, 0.25, 0.06, 0.6, 0.15, 0.95, 0.4, 0.98, 0.55, 0.75, 0.4, 0.55, 0.15, 0.6]]],
  '7': [[[0.0, 0.02, 0.58, 0.0, 0.58, 0.0, 0.35, 0.5, 0.25, 1.0]], [[0.0, 0.02, 0.58, 0.0, 0.58, 0.0, 0.3, 1.0], [0.2, 0.5, 0.55, 0.48]]],
  '8': [[[0.48, 0.1, 0.25, 0.0, 0.1, 0.18, 0.25, 0.42, 0.5, 0.6, 0.52, 0.88, 0.28, 1.0, 0.06, 0.85, 0.15, 0.6, 0.4, 0.4, 0.5, 0.18, 0.45, 0.05]]],
  '9': [[[0.5, 0.12, 0.3, 0.0, 0.08, 0.15, 0.12, 0.4, 0.35, 0.45, 0.52, 0.28, 0.52, 0.12, 0.52, 0.12, 0.5, 0.6, 0.45, 1.0]]],
  '+': [op([[0.0, 0.5, 0.95, 0.48], [0.47, 0.03, 0.49, 0.97]])],
  '−': [op([[0.0, 0.5, 0.95, 0.52]])],
  'x': [small([[0, 0.02, 0.9, 1.0], [0.88, 0.0, 0.04, 0.98]]), small([[0.05, 0.0, 0.38, 0.15, 0.45, 0.5, 0.38, 0.85, 0.02, 1.0], [0.9, 0.0, 0.55, 0.15, 0.47, 0.5, 0.55, 0.85, 0.92, 1.0]])],
  '(': [[[0.35, -0.1, 0.1, 0.25, 0.08, 0.6, 0.15, 0.9, 0.38, 1.12]]],
  ')': [[[0.05, -0.1, 0.3, 0.25, 0.32, 0.6, 0.25, 0.9, 0.02, 1.12]]],
  '√': [[[0, 0.55, 0.1, 0.5, 0.1, 0.5, 0.28, 1, 0.28, 1, 0.62, 0.0]]],
  'y': [small([[0.02, 0.0, 0.28, 0.55], [0.55, 0.0, 0.3, 0.7, 0.1, 1.4]])],
  'z': [small([[0.02, 0.05, 0.62, 0.02, 0.62, 0.02, 0.05, 0.95, 0.05, 0.95, 0.65, 0.98]])],
  'a': [small([[0.6, 0.2, 0.35, 0.0, 0.08, 0.25, 0.08, 0.75, 0.3, 0.98, 0.55, 0.75, 0.6, 0.15, 0.6, 0.15, 0.62, 0.9, 0.7, 1.0]])],
  'b': [[[0.08, 0.0, 0.06, 1.0, 0.06, 1.0, 0.1, 0.7, 0.3, 0.45, 0.55, 0.6, 0.52, 0.92, 0.28, 1.0, 0.08, 0.92]]],
  'c': [small([arc(0.35, 0.5, 0.35, 0.5, -50, -300)])],
  'n': [small([[0.05, 0.0, 0.05, 1.0, 0.05, 1.0, 0.1, 0.3, 0.35, 0.0, 0.55, 0.25, 0.58, 1.0]])],
  't': [[[0.28, 0.0, 0.28, 0.85, 0.38, 1.0, 0.55, 0.95], [0.02, 0.32, 0.55, 0.32]]],
  'θ': [[arc(0.3, 0.5, 0.27, 0.5, -100, 262), [0.06, 0.52, 0.55, 0.48]]],
  'π': [small([[0.0, 0.1, 0.95, 0.05], [0.3, 0.08, 0.25, 1.0], [0.68, 0.06, 0.7, 1.0]])]
};

/* a seeded generator, as in the module, so a failure reproduces */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ink as a pen leaves it: a glyph's strokes, slanted, squeezed, turned
 * and wobbled, placed at (x, y) (top-left of a digit-height box) at `size`
 * px, sampled at an uneven speed, each stroke maybe drawn backwards and
 * the strokes in any order.
 */
function pen(strokes, { x = 0, y = 0, size = 40, r, amt = 1, order = true } = {}) {
  const slant = (r() - 0.4) * 0.5 * amt, rot = (r() - 0.5) * 0.14 * amt, sx = 1 + (r() - 0.5) * 0.4 * amt;
  const cs = Math.cos(rot), sn = Math.sin(rot), wob = 0.03 * amt;
  let out = strokes.map(s => {
    const c = s.map(v => v + (r() - 0.5) * 2 * wob);
    let p = IM._spline(c, 10);
    if (r() < 0.5) { const q = []; for (let i = p.length - 2; i >= 0; i -= 2) q.push(p[i], p[i + 1]); p = q; }
    // resample at an uneven pen speed, with a little digitiser noise
    const pts = [];
    let carry = 0;
    for (let i = 0; i < p.length; i += 2) {
      const tx = p[i] * sx - (p[i + 1] - 0.5) * slant, ty = p[i + 1];
      const wx = x + (tx * cs - ty * sn) * size, wy = y + (tx * sn + ty * cs) * size;
      if (i && carry < 1.2 + r() * 2.5) { carry += Math.hypot(wx - pts[pts.length - 3], wy - pts[pts.length - 2]); if (i < p.length - 2) continue; }
      carry = 0;
      pts.push(wx + (r() - 0.5) * 0.6, wy + (r() - 0.5) * 0.6, 0.5);
    }
    return { id: D.util.uid(), type: 'stroke', pts, size: 2.5, color: 'ink', alpha: 1 };
  });
  if (order) out = out.sort(() => r() - 0.5);
  return out;
}

/* ── the recogniser on its own ───────────────────────────────────── */
const SAMPLES = +process.env.INK_SAMPLES || 30;
function accuracy(seed = 1) {
  const r = rng(seed);
  const per = {};
  let right = 0, total = 0;
  const wrong = [];
  for (const ch in HAND) {
    per[ch] = { right: 0, total: 0 };
    for (let k = 0; k < SAMPLES; k++) {
      const shapes = HAND[ch];
      const size = 24 + r() * 50;
      const strokes = pen(shapes[k % shapes.length], { r, size, x: 100, y: 100 });
      const top = IM.classify(strokes, size)[0], got = top.ch;
      const ok = got === ch || (ch === 'x' && got === '×');
      if (process.env.INK_DEBUG) (accuracy.ds || (accuracy.ds = [])).push([ok, top.d, ch]);
      per[ch].total++; total++;
      if (ok) { per[ch].right++; right++; } else wrong.push(ch + '→' + got);
    }
  }
  return { rate: right / total, per, wrong };
}

test('each symbol, in a different hand, jittered: classified', () => {
  const { rate, per, wrong } = accuracy(7);
  const weak = Object.entries(per).filter(([, v]) => v.right / v.total < 0.8).map(([k, v]) => `${k} ${v.right}/${v.total}`);
  console.log(`# symbols: ${(rate * 100).toFixed(1)}% of ${Object.keys(per).length * SAMPLES}; weakest: ${weak.join(', ') || 'none below 80%'}`);
  console.log('# misread: ' + summarise(wrong));
  if (accuracy.ds) {
    const q = (a, f) => a.sort((x, y) => x - y)[Math.floor(a.length * f)];
    const good = accuracy.ds.filter(d => d[0] && d[1] !== 0.6).map(d => d[1]), bad = accuracy.ds.filter(d => !d[0]).map(d => d[1]);
    console.log(`# d right: p50 ${q(good, 0.5)} p90 ${q(good, 0.9)} p98 ${q(good, 0.98)}; wrong: ${bad.map(v => v.toFixed(2)).join(' ')}`);
    const byCh = {};
    for (const [ok, d, ch] of accuracy.ds) if (ok && d !== 0.6) (byCh[ch] || (byCh[ch] = [])).push(d);
    console.log('# p90 by symbol: ' + Object.entries(byCh).map(([k, v]) => k + ' ' + q(v, 0.9).toFixed(2)).join(', '));
  }
  assert.ok(rate > 0.9, `accuracy ${rate}`);
});

function summarise(list) {
  const m = new Map();
  for (const w of list) m.set(w, (m.get(w) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ');
}

/* ── lines ───────────────────────────────────────────────────────────
   A line is written as a list of glyphs and structures:
     '3'                 a symbol from HAND (or one of EXTRA below)
     { sup: [...] }      an exponent on what comes before
     { frac: [[...], [...]] }   a stacked fraction
     { sqrt: [...] }     a root with a roof over its contents
   laid out left to right at `size`, with uneven gaps, the whole line on
   a slight slope, as a hand writes it. */
const EXTRA = {
  '=': [op([[0.02, 0.36, 0.92, 0.34], [0.0, 0.66, 0.94, 0.66]])],
  '.': [[[0.1, 0.96, 0.13, 0.98]]],
  '·': [[[0.1, 0.5, 0.12, 0.52]]],
  '/': [[[0.04, 1.08, 0.52, -0.06]]],
  '÷': [op([[0, 0.5, 0.9, 0.5], [0.44, 0.12, 0.46, 0.14], [0.44, 0.86, 0.46, 0.88]])]
};
const shapeOf = (ch, r) => { const s = HAND[ch] || EXTRA[ch]; return s[Math.floor(r() * s.length)]; };
const xsOf = st => st.flat().filter((_, i) => i % 2 === 0);

function write(line, { size = 36, x = 100, base = 300, r, slope = 0 } = {}) {
  const out = [], glyphs = [];
  out.glyphs = glyphs;
  let cx = x;
  const put = (spec, s, b) => {
    for (const g of spec) {
      if (typeof g === 'string') {
        const st = shapeOf(g, r), xs = xsOf(st), lo = Math.min(...xs);
        const ink = pen(st, { r, size: s, x: cx - lo * s, y: b - s + (cx - x) * slope, amt: 0.8 });
        glyphs.push({ ch: g, ink });
        out.push(...ink);
        cx += (Math.max(...xs) - lo + 0.22 + r() * 0.2) * s;
      } else if (g.sup) {
        cx -= 0.08 * s;
        put(g.sup, s * 0.6, b - s * 0.5);
        cx += 0.1 * s;
      } else if (g.frac) {
        const start = cx, sub = s * 0.85;
        put(g.frac[0], sub, b - s * 0.62);
        const w1 = cx - start; cx = start;
        put(g.frac[1], sub, b + s * 0.62);
        const w = Math.max(w1, cx - start);
        const mid = b - s * 0.42 + (start - x) * slope;
        out.push(stroke(dense([start - 0.1 * s, mid, start + w * 0.5, mid + (r() - 0.5) * 2, start + w, mid + (r() - 0.5) * 2])));
        cx = start + w + 0.3 * s;
      } else if (g.sqrt) {
        const start = cx;
        cx += 0.6 * s;
        const inner = cx;
        put(g.sqrt, s, b);
        const end = cx + 0.05 * s, top = b - s * 1.2;
        out.push(stroke(dense([start, b - 0.45 * s, start + 0.12 * s, b - 0.52 * s, start + 0.3 * s, b + 0.05 * s, inner - 0.05 * s, top, end, top - 1])));
        cx += 0.2 * s;
      }
    }
  };
  put(line, size, base);
  return out;
}
const stroke = pts => ({ id: D.util.uid(), type: 'stroke', pts, size: 2.5, color: 'ink', alpha: 1 });
/** a polyline sampled every couple of px, as a pen would */
function dense(xy) {
  const out = [];
  for (let i = 0; i < xy.length - 2; i += 2) {
    const n = Math.max(1, Math.ceil(Math.hypot(xy[i + 2] - xy[i], xy[i + 3] - xy[i + 1]) / 2));
    for (let k = 0; k < n; k++) out.push(xy[i] + (xy[i + 2] - xy[i]) * k / n, xy[i + 1] + (xy[i + 3] - xy[i + 1]) * k / n, 0.5);
  }
  out.push(xy[xy.length - 2], xy[xy.length - 1], 0.5);
  return out;
}

const LINES = [
  [['1', '2', '+', '3', '0', '='], '12+30', 'end'],
  [['3', 'x', { sup: ['2'] }, '+', '2', '='], '3x^2+2', 'end'],
  [[{ frac: [['1'], ['4']] }, '+', { frac: [['1'], ['2']] }, '='], '1/4+1/2', 'end'],
  [['x', '=', '5'], 'x=5', 'mid'],
  [[{ sqrt: ['1', '6'] }, '+', '2', '='], '√(16)+2', 'end'],
  [['2', '(', '3', '+', '4', ')', '='], '2(3+4)', 'end'],
  [['6', '÷', '3', '='], '6÷3', 'end'],
  [['2', 'x', '3', '='], '2×3', 'end'],
  [['0', '.', '5', '+', '4', '='], '0.5+4', 'end'],
  [['x', { sup: ['2'] }, '−', '1', '='], 'x^2−1', 'end'],
  [['7', '/', '2', '='], '7/2', 'end'],
  [['2', 'π', 'b', '='], '2π·b', 'end'],
  [['a', 'b', '+', 'c', '='], 'a·b+c', 'end'],
  [['y', '=', '2', 'x', '+', '1'], 'y=2x+1', 'mid'],
  [['4', '5', '−', '1', '8', '='], '45−18', 'end'],
  [['9', 'x', '8', '='], '9×8', 'end']
];
const textOf = r => r.eq === 'mid' ? r.lhs + '=' + r.rhs : r.expr;

function lineRate(seeds) {
  let right = 0, total = 0;
  const wrong = [];
  for (const [line, want] of LINES) {
    for (let k = 0; k < seeds; k++) {
      const r = rng(1000 + k * 31 + want.length);
      const ink = write(line, { r, size: 26 + r() * 30, slope: (r() - 0.5) * 0.06 });
      const got = IM.read(ink);
      total++;
      if (textOf(got) === want && got.ok) right++; else wrong.push(`${want}→${textOf(got)}${got.ok ? '' : '?'}`);
    }
  }
  return { rate: right / total, total, wrong };
}

test('look-alikes: 1, a slanted 1 and /; 5 in one stroke or two; + either way round', () => {
  const H = 40;
  /** a straight stroke rising at `deg` from the horizontal, `h` tall, drawn up or down */
  const line = (deg, h = H, down = false) => {
    const dx = h / Math.tan(deg * Math.PI / 180) * (deg > 90 ? -1 : 1), x0 = 100, y0 = 140;
    const a = [x0, y0], b = [x0 + Math.abs(dx) * Math.sign(deg > 90 ? -1 : 1), y0 - h];
    return [stroke(dense(down ? [...b, ...a] : [...a, ...b]))];
  };
  const read1 = st => IM.classify(st, H)[0].ch;
  assert.equal(read1(line(90)), '1', 'upright');
  assert.equal(read1(line(90, H, true)), '1', 'drawn downwards');
  assert.equal(read1(line(78)), '1', 'a 1 slanted as handwriting slants');
  assert.equal(read1(line(100)), '1', 'a 1 leaning back');
  assert.equal(read1(line(55)), '/', 'a slash');
  assert.equal(read1(line(55, H, true)), '/', 'a slash drawn downwards');
  assert.equal(read1(line(67, H * 1.25)), '/', 'a steep slash, taller than the digits');
  assert.equal(read1(line(4).map(s => s)), '−');

  const r = rng(5);
  let fives = 0, pluses = 0, n = 40;
  for (let k = 0; k < n; k++) {
    const shape = HAND['5'][k % 2];
    if (IM.classify(pen(shape, { r, size: 30 + r() * 30 }), 40)[0].ch === '5') fives++;
    if (IM.classify(pen(HAND['+'][0], { r, size: 30 + r() * 30 }), 40)[0].ch === '+') pluses++;
  }
  console.log(`# 5 (one stroke or two, any order and direction): ${fives}/${n}; + (either order): ${pluses}/${n}`);
  assert.ok(fives >= n * 0.9);
  assert.equal(pluses, n);
});

test('x and ×, a minus and a fraction bar, are told apart by where they are', () => {
  const r = rng(41);
  const text = line => { const g = IM.read(write(line, { r, size: 40 })); return g.eq === 'mid' ? g.lhs + '=' + g.rhs : g.expr; };
  assert.equal(text(['2', 'x', '3', '=']), '2×3', 'between numbers, times');
  assert.equal(text(['2', 'x', '=']), '2x', 'after a number, a variable');
  assert.equal(text(['x', { sup: ['2'] }, '+', '1', '=']), 'x^2+1', 'raised, an x');
  assert.equal(text(['x', '+', '3', '=']), 'x+3');
  assert.equal(text(['1', '−', '2', '=']), '1−2', 'a dash between: minus');
  assert.equal(text([{ frac: [['1'], ['2']] }, '=']), '1/2', 'with ink over and under: a fraction');
  assert.equal(text(['2', '−', { frac: [['1'], ['3']] }, '=']), '2−1/3', 'both on one line');
  assert.equal(text(['x', { sup: ['2'] }, '−', '1', '=']), 'x^2−1', 'a minus after an exponent stays on the line');
});

test('lines of working, in that hand: read whole', () => {
  const { rate, total, wrong } = lineRate(+process.env.INK_LINES || 12);
  console.log(`# lines: ${(rate * 100).toFixed(1)}% of ${total} read exactly and confidently`);
  console.log('# misread: ' + summarise(wrong));
  assert.ok(rate > 0.8, `line accuracy ${rate}`);
});

/* ── on the board ────────────────────────────────────────────────────
   A stand-in App with a real Scene: edits go through begin/commit and
   afterEdit as the pen tool's do, and 'change' then 'stroke' are emitted
   in the order the core emits them. */
function board() {
  const app = fakeApp(D, {
    opts: { inkmath: { auto: true, places: 'auto', color: 'accent' }, general: {} },
    selection: [], camera: new D.Camera(), pointerType: 'pen',
    afterEdit() { D.ext.emit('change', this); },
    requestDraw() {}, markDirty() { this.dirtied = (this.dirtied || 0) + 1; }, toast(m) { this.toasted = m; },
    undo() { const op = this.scene.undo(); this.afterEdit(); return op; },
    redo() { const op = this.scene.redo(); this.afterEdit(); return op; }
  });
  IM.reset(app);
  return app;
}
function draw(app, strokes) {
  for (const it of strokes) {
    app.scene.begin('draw'); app.scene.add(it); app.scene.commit();
    app.afterEdit();
    D.ext.emit('stroke', app, it);
  }
}
function erase(app, items) {
  app.scene.begin('erase'); app.scene.removeMany(items); app.scene.commit();
  app.afterEdit();
}
const answers = app => app.scene.items.filter(i => i.type === 'inkresult');
const inkOf = (line, seed, o = {}) => write(line, { r: rng(seed), size: 40, ...o });
const historyHasAnswers = app => app.scene.undoStack.concat(app.scene.redoStack)
  .some(op => op.adds.concat(op.removes.map(r => r.item), op.updates.map(u => u.after)).some(i => i.type === 'inkresult'));

test('the registry: an answer item, a press action and a settings section', () => {
  const t = D.ext.items.inkresult;
  assert.ok(t && t.bbox && t.draw && t.svg && t.erasable, 'erasable, drawn and exported');
  const a = D.ext.pressActions.find(p => p.id === 'inkmath-solve');
  assert.ok(a, 'Solve this ink');
  const s = { id: 's', type: 'stroke', pts: [0, 0, 0.5, 10, 10, 0.5] };
  assert.equal(a.when({ selection: [s], source: 'bar' }), true);
  assert.equal(a.when({ selection: [], source: 'menu' }), false, 'nothing selected');
  assert.equal(a.when({ selection: [s, { id: 'n', type: 'note' }], source: 'bar' }), false, 'not with a note in it');
  assert.ok(D.ext.settings.some(x => x.id === 'inkmath'));
  assert.deepEqual(JSON.parse(JSON.stringify(D.ext.opts.inkmath)), { auto: true, places: 'auto', color: 'accent', explain: false });
});

test('12 + 30 = answers 42 beside the "=", without an undo step of its own', async () => {
  const app = board();
  const ink = inkOf(['1', '2', '+', '3', '0', '='], 11);
  draw(app, ink);
  assert.equal(answers(app).length, 0, 'nothing until the pen rests');
  await IM.flush(app);
  const [a] = answers(app);
  assert.ok(a, 'an answer');
  assert.equal(a.text, '42');
  assert.equal(a.expr, '12+30');
  const eqBox = D.util.unionBox(app.scene.bbox(ink[ink.length - 2]), app.scene.bbox(ink[ink.length - 1]));
  assert.ok(a.x > eqBox.x2 && a.x < eqBox.x2 + 40, 'just after the "="');
  assert.ok(a.y > eqBox.y && a.y < eqBox.y2 + 30, 'on the line');
  assert.equal(app.scene.undoStack.length, ink.length, 'one step per stroke, none for the answer');
  assert.equal(historyHasAnswers(app), false);
});

test('undo the last stroke of the "=" and the answer goes; redo and it comes back', async () => {
  const app = board();
  const ink = inkOf(['7', '+', '5', '='], 23);
  draw(app, ink);
  await IM.flush(app);
  assert.equal(answers(app)[0].text, '12');
  const steps = app.scene.undoStack.length;
  app.undo();
  assert.equal(answers(app).length, 0, 'gone with the stroke');
  assert.equal(app.scene.undoStack.length, steps - 1, 'one undo, one step');
  app.redo();
  assert.equal(answers(app).length, 1, 'back with it');
  assert.equal(answers(app)[0].text, '12');
  app.undo(); app.undo();
  assert.equal(answers(app).length, 0);
  app.redo(); app.redo();
  assert.equal(answers(app).length, 1, 'and again');
  assert.equal(app.scene.undoStack.length, steps);
  assert.equal(historyHasAnswers(app), false, 'the history never holds an answer');
  await IM.flush(app);
  assert.equal(answers(app).length, 1, 'reading again finds the same answer, and does not add another');
});

test('erasing part of the sum works it out again; erasing the "=" takes the answer away', async () => {
  const app = board();
  const ink = inkOf(['1', '2', '+', '3', '0', '='], 11);
  draw(app, ink);
  await IM.flush(app);
  assert.equal(answers(app)[0].text, '42');
  const zero = ink.glyphs.find(g => g.ch === '0').ink;
  erase(app, zero);
  await IM.flush(app);
  assert.equal(IM.read(ink.filter(s => !zero.includes(s))).expr, '12+3');
  assert.equal(answers(app).length, 1);
  assert.equal(answers(app)[0].text, '15', '12 + 3');
  erase(app, ink.glyphs.find(g => g.ch === '=').ink);
  assert.equal(answers(app).length, 0, 'no "=", no answer');
  app.undo();
  assert.equal(answers(app).length, 1, 'undoing the erase brings it back');
});

test('moving the line takes its answer along; moving both does not move it twice', async () => {
  const app = board();
  const ink = inkOf(['4', 'x', '6', '='], 5);
  draw(app, ink);
  await IM.flush(app);
  const a = answers(app)[0];
  assert.equal(a.text, '24', '4 × 6');
  const x0 = a.x, y0 = a.y;
  app.scene.begin('move');
  for (const it of ink) { app.scene.touchMoved(it); app.scene.translate(it, 50, 20); }
  app.scene.commit(); app.afterEdit();
  assert.deepEqual([answers(app)[0].x, answers(app)[0].y].map(v => Math.round(v)), [Math.round(x0 + 50), Math.round(y0 + 20)]);
  app.scene.begin('move');
  for (const it of [...ink, answers(app)[0]]) { app.scene.touchMoved(it); app.scene.translate(it, -50, 0); }
  app.scene.commit(); app.afterEdit();
  assert.deepEqual([answers(app)[0].x, answers(app)[0].y].map(v => Math.round(v)), [Math.round(x0), Math.round(y0 + 20)]);
});

test('variables: x = 2 above, 3x² + 2 = below gives 14; rewriting x updates it', async () => {
  const app = board();
  const def = inkOf(['x', '=', '2'], 3, { base: 200 });
  draw(app, def);
  const sum = inkOf(['3', 'x', { sup: ['2'] }, '+', '2', '='], 9, { base: 320 });
  draw(app, sum);
  await IM.flush(app);
  const a = answers(app);
  assert.equal(a.length, 1, 'the definition has no answer of its own');
  assert.equal(a[0].text, '14');
  assert.deepEqual([...a[0].uses], ['x']);
  // rub out the 2, write a 3
  erase(app, def.glyphs.find(g => g.ch === '2').ink);
  const three = inkOf(['x', '=', '3'], 3, { base: 200 }).glyphs.find(g => g.ch === '3').ink;
  draw(app, three);
  await IM.flush(app);
  assert.equal(answers(app)[0].text, '29', '3·3² + 2');
});

test('a variable nobody defined, scribbles and a bare number get no answer, silently', async () => {
  const app = board();
  draw(app, inkOf(['2', 'y', '+', '1', '='], 4));
  draw(app, inkOf(['7', '='], 8, { base: 400 }));
  // a scrawl ending in two dashes
  const r = rng(99);
  const scrawl = [];
  for (let k = 0; k < 6; k++) {
    const xy = [];
    for (let i = 0; i < 30; i++) xy.push(100 + k * 30 + r() * 30, 500 + r() * 40);
    scrawl.push(stroke(dense(xy)));
  }
  draw(app, [...scrawl, ...pen(EXTRA['='][0], { r, x: 300, y: 500, size: 40 })]);
  await IM.flush(app);
  assert.deepEqual(Array.from(answers(app), a => a.expr), []);
  assert.equal(app.toasted, undefined, 'and nothing said about it');
});

test('ordinary writing costs a box test: nothing is queued for ink that is not an "="', () => {
  const app = board();
  draw(app, inkOf(['3', '4', 'a', 'b', '+', 'c'], 12));
  assert.equal(IM.state.jobs.size, 0);
  assert.equal(IM.state.eqs.size, 0);
});

test('fractions, roots and decimals on the board', async () => {
  const app = board();
  draw(app, inkOf([{ frac: [['1'], ['4']] }, '+', { frac: [['1'], ['2']] }, '='], 2, { base: 200 }));
  draw(app, inkOf([{ sqrt: ['1', '6'] }, '+', '2', '='], 6, { base: 400 }));
  draw(app, inkOf(['0', '.', '5', 'x', '4', '='], 8, { base: 600 }));
  await IM.flush(app);
  const got = answers(app).sort((a, b) => a.y - b.y).map(a => a.text);
  assert.deepEqual(Array.from(got), ['0.75', '6', '2']);
});

test('answers draw in a handwriting face, export, and are erasable like ink', async () => {
  const app = board();
  draw(app, inkOf(['9', '−', '4', '='], 7));
  await IM.flush(app);
  const a = answers(app)[0];
  assert.equal(a.text, '5');
  const t = D.ext.items.inkresult, L = a._lines || (t.bbox(a), a._lines);
  const b = t.bbox(a);
  assert.ok(b.w > 0 && b.h > 0 && b.y < a.y && b.y + b.h > a.y, 'a box round the baseline');
  assert.match(L.font, /Segoe Print/);
  const r = new D.Renderer ? null : null;
  const ctx = D.util.el('canvas').getContext('2d');
  t.draw(ctx, a, { tokens: () => ({ accent: '#4f6bff', dark: false }), paintZoom: 1 });
  assert.ok(ctx.calls.includes('fillText'));
  assert.equal(ctx.fillStyle, '#4f6bff', 'the accent colour');
  const svg = t.svg(a, { tokens: () => ({ accent: '#4f6bff', dark: false }) });
  assert.match(svg, /<text [^>]*fill="#4f6bff"[^>]*>5<\/text>/);
  assert.equal(D.erasable(a), true);
});

test('Solve this ink: the reading in a field, Insert as one undo step, Teach remembers a correction', async () => {
  const app = board();
  app.opts.inkmath.auto = false;
  const ink = inkOf(['8', '+', '1', '='], 31);
  draw(app, ink);
  await IM.flush(app);
  assert.equal(answers(app).length, 0, 'auto-solve off');
  const p = IM.solve(app, ink, { sx: 100, sy: 100 });
  await D.math.ready();
  p.work();
  assert.equal(p.field.value, '8+1');
  assert.equal(p.result().pretty, '9');
  const steps = app.scene.undoStack.length;
  p.insert();
  assert.equal(answers(app).length, 1);
  assert.equal(answers(app)[0].text, '9');
  assert.equal(app.scene.undoStack.length, steps + 1, 'inserting is an edit');
  app.undo();
  assert.equal(answers(app).length, 0);

  // a correction: say the 1 was a 7
  const before = IM.learned();
  const q = IM.solve(app, ink, {});
  q.field.value = '8+7';
  q.work();
  assert.equal(q.result().pretty, '15');
  q.teach();
  assert.equal(IM.learned(), before + 1, 'one symbol learnt');
  assert.match(app.toasted, /Learnt 1 symbol/);
  assert.ok(store.get('dpo:inkmath-learned').includes('"ch":"7"'), 'kept in localStorage');
  assert.equal(IM.read(ink).expr, '8+7', 'read that way from now on');
  IM.forget();
  assert.equal(IM.learned(), 0);
  assert.equal(IM.read(ink).expr, '8+1', 'and forgotten');

  // ink with no "=": the answer is inserted as "= …" after it
  const bare = inkOf(['6', '+', '3'], 17, { base: 500 });
  draw(app, bare);
  const b = IM.solve(app, bare, {});
  b.work();
  b.insert();
  const a = answers(app).find(x => x.expr === '6+3');
  assert.ok(a && a.lead && a.text === '9', 'drawn as "= 9"');
  assert.equal(D.ext.items.inkresult.bbox(a).w > D.ext.items.inkresult.bbox({ ...a, lead: false, _lines: null }).w, true);
  const ax = a.x;
  app.scene.begin('move');
  for (const it of bare) { app.scene.touchMoved(it); app.scene.translate(it, 30, 0); }
  app.scene.commit(); app.afterEdit();
  assert.equal(Math.round(answers(app).find(x => x.expr === '6+3').x), Math.round(ax + 30), 'it follows its ink');
  erase(app, bare);
  assert.equal(answers(app).filter(x => x.expr === '6+3').length, 0, 'and goes with it');
});

/* ── a real pen (issue #14) ──────────────────────────────────────────
   Measured on a real board of lecture notes written on a Surface: the
   second bar of an "=" is bowed or hooked where the pen lifts (its ink
   strays a fifth of its length from the chord, against a ruled line's
   twentieth); small handwriting makes bars a few pixels long; a 1 bows
   like a bracket; a 2 is drawn with a flat top like a Z. Each case
   below is built from those measurements — no real ink is kept here. */
const bar = (x, y, w, { bow = 0, hook = 0, tilt = 0 } = {}) => {
  const xy = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; xy.push(x + t * w, y + tilt * w * t + bow * w * Math.sin(Math.PI * t)); }
  if (hook) xy.push(x + w * 1.04, y + tilt * w - hook * w);
  return stroke(dense(xy));
};
const sumThen = (line, seed, o = {}) => {
  const ink = inkOf(line, seed, o);
  let b = null;
  for (const it of ink) b = D.util.unionBox(b, D.util.boxFromPoints(it.pts, 3));
  return { ink, b };
};

test('real "=" bars — bowed, hooked, uneven — are found and read as an "="', async () => {
  const app = board();
  const { ink, b } = sumThen(['1', '2', '+', '3', '0'], 11);
  const H = 40, x = b.x2 + 0.35 * H, y = 300 - 0.62 * H;
  const top = bar(x, y, 0.6 * H, { tilt: 0.05 }), low = bar(x + 2, y + 0.3 * H, 0.52 * H, { bow: 0.12, hook: 0.25 });
  const f = IM.feature(low);
  assert.ok(f.dev > 0.16 && f.len > 1.18 * f.chord, 'as bowed and hooked as the bars measured (dev ' + f.dev.toFixed(2) + ')');
  assert.ok(f.dash, 'and still a dash');
  draw(app, [...ink, top, low]);
  await IM.flush(app);
  assert.deepEqual(Array.from(answers(app), a => a.text), ['42']);
});

test('a small "=" in small writing: the scene box\'s pixel of padding is taken off', async () => {
  const app = board();
  const { ink, b } = sumThen(['1', '2', '+', '3', '0'], 11, { size: 13 });
  const x = b.x2 + 4, y = 300 - 8;
  // 4.5 wide, 1.2 tall on the slant: half as tall as wide once the box is padded
  draw(app, [...ink, bar(x, y, 5, { tilt: 0.1 }), bar(x, y + 4, 4.5, { tilt: 0.25 })]);
  assert.equal(IM.state.eqs.size, 1, 'the "=" is found');
  await IM.flush(app);
  assert.deepEqual(Array.from(answers(app), a => a.text), ['42']);
});

test('zoomed in, a short "=" is judged by its size on the screen', async () => {
  const app = board();
  app.camera.zoom = 6;
  const { ink, b } = sumThen(['1', '2', '+', '3', '0'], 11, { size: 4 });
  const x = b.x2 + 1.2, y = 300 - 2.5;
  draw(app, [...ink, bar(x, y, 2.4), bar(x, y + 1.3, 2.2, { bow: 0.1 })]);
  assert.equal(IM.state.eqs.size, 1);
  await IM.flush(app);
  assert.deepEqual(Array.from(answers(app), a => a.text), ['42']);
});

test('the arms of an F are two dashes one over the other, but not an "="', () => {
  const app = board();
  draw(app, [stroke(dense([100, 100, 100, 140])), bar(100, 100, 22), bar(100, 118, 16)]);
  assert.equal(IM.state.eqs.size, 0);
});

test('a shape no template comes near in proportion is an unknown, not a thrown line', async () => {
  const xy = [];
  for (let i = 0; i <= 60; i++) xy.push(100 + i * 4, 300 + 6 * Math.sin(i / 3));
  assert.ok(IM.classify([stroke(dense(xy))]).length > 0, 'something to go on');
  const app = board();
  const errors = [];
  const was = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const { ink, b } = sumThen(['1', '2', '+', '3', '0'], 11);
    // a long wavy underline-ish stroke on the line, then the "="
    draw(app, [stroke(dense([b.x - 90, 290, b.x - 70, 284, b.x - 50, 292, b.x - 30, 286, b.x - 10, 291])), ...ink]);
    draw(app, pen(EXTRA['='][0], { r: rng(5), x: b.x2 + 14, y: 260, size: 40 }));
    await IM.flush(app);
  } finally { console.error = was; }
  assert.deepEqual(errors, []);
});

test('read as a sum of numbers: a flat-topped 2, and a bowed 1 with no bracket to pair with', async () => {
  EXTRA['2z'] = [[[0.0, 0.1, 0.12, 0.0, 0.66, 0.0, 0.66, 0.0, 0.02, 0.98, 0.02, 0.98, 0.7, 1.0]]];
  EXTRA['1('] = [[[0.34, 0.0, 0.16, 0.5, 0.32, 1.0]]];
  const app = board();
  draw(app, inkOf(['2z', '+', '1', '='], 3));
  draw(app, inkOf(['1(', '2', '+', '3', '='], 3, { base: 420 }));
  await IM.flush(app);
  const got = Array.from(answers(app), a => a.expr + '=' + a.text);
  assert.ok(got.includes('12+3=15'), 'the bowed 1 is a 1');
  // the z-like 2 is read as a 2 — answered, or offered with a "?" when a 1 runs it close
  const guesses = Array.from(IM.state.marks.values(), m => m.reading.expr);
  assert.ok(got.includes('2+1=3') || guesses.includes('2+1'), got.join() + ' / ' + guesses.join());
});

test('not sure enough to answer: a "?" with its best guess; "Show why" says why for any "="', async () => {
  // the flat-topped 2 above, which a 1 runs close: seen, not answered, offered
  const asked = board();
  draw(asked, inkOf(['2z', '+', '1', '='], 3));
  await IM.flush(asked);
  const [m] = IM.state.marks.values();
  assert.ok(m && m.guess, 'a "?"');
  assert.equal(m.reading.expr, '2+1', 'with the best guess for Solve this ink');
  assert.equal(answers(asked).length, 0, 'and no answer beside it');
  const app = board();
  app.opts.inkmath.explain = true;
  draw(app, inkOf(['7', '='], 8));
  await IM.flush(app);
  assert.deepEqual([...IM.state.marks.values()].map(m => m.why), ['not-a-sum']);
  IM.reset(app);
  assert.equal(IM.state.marks.size, 0, 'and the notes go with the board');
});


/* ── a hand of its own ───────────────────────────────────────────────
   Shapes the built-in templates and rules get wrong, written the same
   way each time: a 1 leaning like a slash, a 9 with a curled tail, a z
   with a bar through it. Taught a few times, they are read as taught —
   even where a rule, not the matcher, had the say — and the ordinary
   hand is hardly touched. */
const QUIRK = {
  '1': [[0.62, 0, 0.05, 1]],
  '9': [[0.5, 0.2, 0.3, 0.0, 0.08, 0.15, 0.1, 0.4, 0.3, 0.5, 0.5, 0.35, 0.5, 0.15, 0.5, 0.15, 0.5, 0.8, 0.35, 1.0, 0.1, 0.9]],
  'z': small([[0.0, 0.0, 0.6, 0.0, 0.0, 1.0, 0.6, 1.0], [0.1, 0.5, 0.5, 0.5]])
};
function quirkRate(seed, n = 20) {
  const r = rng(seed), out = {};
  for (const ch in QUIRK) {
    let ok = 0;
    for (let k = 0; k < n; k++) { const size = 24 + r() * 50; if (IM.classify(pen(QUIRK[ch], { r, size, x: 100, y: 100 }), size)[0].ch === ch) ok++; }
    out[ch] = ok / n;
  }
  return out;
}

test('taught symbols are read as taught, ahead of the rules, and the ordinary hand barely moves', () => {
  IM.forget();
  const before = quirkRate(3);
  assert.ok(before['1'] < 0.5, `a slanted 1 reads as a / untaught (${before['1']})`);
  const r = rng(99);
  for (const ch in QUIRK) for (let k = 0; k < 4; k++) IM.teach(pen(QUIRK[ch], { r, size: 30 + r() * 40 }).map(IM.feature), ch);
  const after = quirkRate(5);
  for (const ch in QUIRK) assert.ok(after[ch] >= 0.85, `${ch}: ${after[ch]} once taught`);
  assert.ok(accuracy(7).rate > 0.97, 'the ordinary hand still reads');
  IM.forget();
});

test('the training pad teaches each symbol from what is written on it, and Try it reads it back', () => {
  IM.forget();
  const app = board();
  const t = IM.train(app, ['1', '9']);
  const r = rng(12);
  for (let k = 0; k < 3; k++) { t.write(pen(QUIRK['1'], { r, size: 120, x: 40, y: 30 })); t.take(); }
  assert.equal(IM.learned(), 3, 'three samples of the 1');
  assert.equal(t.st.i, 1, 'then on to the 9');
  t.st.k = 2;
  t.write(pen(QUIRK['9'], { r, size: 120, x: 40, y: 30 })); t.take();
  assert.equal(t.st.mode, 'try', 'the end of the list: over to Try it');
  // Try it: a misreading is put right by tapping what it really is
  t.write(pen(QUIRK['z'], { r, size: 80, x: 40, y: 70 }));
  t.pickSym('z');
  assert.equal(IM.learned(), 5);
  IM.closeTrainer();
  IM.forget();
});

test('Solve this ink: a symbol chip is taught by picking what it really is', async () => {
  IM.forget();
  const app = board();
  app.opts.inkmath.auto = false;
  const ink = inkOf(['8', '+', '1', '='], 31);
  draw(app, ink);
  const p = IM.solve(app, ink, { sx: 100, sy: 100 });
  await D.math.ready();
  p.work();
  const chips = p.el.children.find(c => c.className === 'inkmath-chips');
  assert.ok(chips && chips.children.length >= 3, 'a chip for each symbol');
  chips.children[2].onclick();
  const pick = p.el.children.find(c => c.className === 'inkmath-pick');
  assert.equal(pick.hidden, false, 'tapping a chip offers every symbol');
  assert.equal(pick.children.length, IM.TEACHABLE.length);
  assert.ok(IM.TEACHABLE.includes('/'), 'a slash can be taught, though only a rule reads one');
  IM.forget();
});

test('taking teaching back: the last thing taught, one sample, one symbol, or everything', () => {
  IM.forget();
  const r = rng(41);
  const one = ch => IM.teach(pen(QUIRK[ch], { r, size: 40 }).map(IM.feature), ch);
  one('1'); one('1'); one('9');
  assert.equal(IM.learned(), 3);
  const gone = IM.undoTeach();
  assert.equal(gone.length, 1); assert.equal(gone[0].ch, '9', 'the last thing taught');
  assert.equal(IM.samplesOf('1').length, 2);
  // a Teach that put two symbols right is one step
  const strokes = pen(QUIRK['z'], { r, size: 40 }).map(IM.feature);
  const b = Date.now() + 1e6;
  IM.teach(strokes, 'z', b); IM.teach(strokes, '2', b);
  assert.equal(IM.undoTeach().length, 2, 'both, as they were taught together');
  assert.ok(IM.forgetSample(IM.samplesOf('1')[0]));
  assert.equal(IM.samplesOf('1').length, 1, 'one sample');
  one('9');
  assert.equal(IM.forgetSymbol('1'), 1, 'one symbol');
  assert.equal(IM.samplesOf('9').length, 1, 'the others kept');
  assert.ok(store.get('dpo:inkmath-learned').includes('"s":'), 'samples keep a sketch to be shown by');
  IM.forget();
  assert.equal(IM.learned(), 0, 'everything');
});

test('the trainer: Undo takes back the last sample and asks for it again; Start again needs two taps', () => {
  IM.forget();
  const app = board();
  const t = IM.train(app, ['1', '9']);
  const r = rng(13);
  t.write(pen(QUIRK['1'], { r, size: 120, x: 40, y: 30 })); t.take();
  t.write(pen(QUIRK['1'], { r, size: 120, x: 40, y: 30 })); t.take();
  assert.equal(t.st.k, 2);
  t.undo();
  assert.equal(IM.learned(), 1); assert.equal(t.st.k, 1, 'asks for the second one again');
  t.write(pen(QUIRK['1'], { r, size: 120, x: 40, y: 30 })); t.take();
  t.write(pen(QUIRK['1'], { r, size: 120, x: 40, y: 30 })); t.take();
  assert.equal(t.st.i, 1, 'on to the 9');
  t.undo();
  assert.equal(t.st.i, 0, 'back to the third 1'); assert.equal(t.st.k, 2);
  t.reset();
  assert.equal(IM.learned(), 0);
  IM.closeTrainer();
});

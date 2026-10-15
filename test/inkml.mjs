/* ── inkml.mjs ── handwriting datasets, for measuring the maths reader ──
   Reads InkML (the W3C format CROHME and Google's MathWriting use), turns
   a LaTeX label into what a person writes for it, and scores a reading
   against it. Used by bench-ink.mjs; tested by inkml.test.mjs.

   Only labels the reader could get right are kept: those written with
   the symbols it knows (js/inkmath.js LABELS, and the rules: − = . · /
   ÷ ×) and the structures it reads (fractions, roots, powers). The rest —
   subscripts, Greek beyond θ and π, \sum, matrices — are out of scope,
   and the bench says how many that leaves out. */

/** an InkML file → { id, label, split, strokes: [[x, y, …]] } (y down, as written) */
export function parseInkml(text) {
  const ann = type => {
    const m = new RegExp(`<annotation type="${type}">([^<]*)</annotation>`).exec(text);
    return m ? unescape(m[1]) : null;
  };
  const strokes = [];
  for (const m of text.matchAll(/<trace[^>]*>([^<]*)<\/trace>/g)) {
    const xy = [];
    for (const pt of m[1].split(',')) {
      const v = pt.trim().split(/\s+/).map(Number);
      if (v.length >= 2 && isFinite(v[0]) && isFinite(v[1])) xy.push(v[0], v[1]);
    }
    if (xy.length >= 2) strokes.push(xy);
  }
  return {
    id: ann('sampleId'), split: ann('splitTagOriginal'),
    label: ann('normalizedLabel') ?? ann('label') ?? ann('truth'),
    strokes
  };
}
const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/**
 * Strokes as the board's items would carry them: [x, y, pressure, …],
 * scaled so a typical symbol is `size` units tall, whatever the device
 * the ink came from (MathWriting's coordinates are not normalised).
 */
export function toPts(strokes, size = 40) {
  const hs = strokes.map(xy => {
    let y1 = Infinity, y2 = -Infinity, x1 = Infinity, x2 = -Infinity;
    for (let i = 0; i < xy.length; i += 2) { x1 = Math.min(x1, xy[i]); x2 = Math.max(x2, xy[i]); y1 = Math.min(y1, xy[i + 1]); y2 = Math.max(y2, xy[i + 1]); }
    return Math.max(y2 - y1, (x2 - x1) * 0.5);
  }).sort((a, b) => a - b);
  // the taller strokes are the symbols; dots and bars are not a guide to size
  const ref = hs[Math.floor(hs.length * 0.75)] || 1;
  const k = size / ref;
  return strokes.map(xy => {
    const pts = [];
    for (let i = 0; i < xy.length; i += 2) pts.push(xy[i] * k, xy[i + 1] * k, 0.5);
    return pts;
  });
}

/* ── LaTeX → what is written ─────────────────────────────────────────── */

const LETTERS = new Set(['x', 'y', 'z', 'a', 'b', 'c', 'n', 't']);
const COMMANDS = { '\\pi': 'π', '\\theta': 'θ', '\\times': '×', '\\cdot': '·', '\\div': '÷' };

/**
 * A LaTeX label as a tree the reader could produce, or null when it is
 * out of scope. Nodes: { s: ch } a symbol, { frac: [num, den] },
 * { sqrt: body }, { sup: [base?, exp] } (an exponent on what precedes it).
 */
export function parseLatex(src) {
  let i = 0;
  // spaces end a command (\cdot t is not \cdott) and are otherwise nothing
  const s = String(src);
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function group() {
    skip();
    if (s[i] === '{') { i++; const g = seq('}'); if (s[i] !== '}') throw 0; i++; return g; }
    const one = atom(); if (!one) throw 0; return [one];
  }
  function atom() {
    skip();
    const c = s[i];
    if (c === undefined) return null;
    if (c === '\\') {
      const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
      if (!m) throw 0;
      i += m[0].length;
      if (m[0] === '\\frac') { const a = group(), b = group(); return { frac: [a, b] }; }
      if (m[0] === '\\sqrt') { if (s[i] === '[') throw 0; return { sqrt: group() }; }
      if (COMMANDS[m[0]]) return { s: COMMANDS[m[0]] };
      throw 0;
    }
    if (/[0-9]/.test(c) || LETTERS.has(c) || '+=().'.includes(c)) { i++; return { s: c }; }
    if (c === '-') { i++; return { s: '−' }; }
    if (c === '/') { i++; return { s: '/' }; }
    if (c === '*') { i++; return { s: '×' }; }
    throw 0;
  }
  function seq(end) {
    const out = [];
    for (skip(); i < s.length && s[i] !== end; skip()) {
      if (s[i] === '^') { i++; out.push({ sup: group() }); continue; }
      const a = atom(); if (!a) break; out.push(a);
    }
    return out;
  }
  try {
    const t = seq(undefined);
    skip();
    return i === s.length && t.length ? t : null;
  } catch (_) { return null; }
}

/** the symbols written, in reading order: a fraction's bar as "/" between its parts, a root's tick as "√" */
export function written(tree) {
  const out = [];
  const walk = nodes => {
    for (const n of nodes) {
      if (n.s) out.push(n.s);
      else if (n.frac) { walk(n.frac[0]); out.push('/'); walk(n.frac[1]); }
      else if (n.sqrt) { out.push('√'); walk(n.sqrt); }
      else if (n.sup) walk(n.sup);
    }
  };
  walk(tree);
  return out;
}

/** the tree as something math.js evaluates, with every product written out */
export function mathOf(tree) {
  const sym = c => ({ '−': '-', '×': '*', '·': '*', '÷': '/', 'π': 'pi', 'θ': 'theta' }[c] || c);
  const parts = [];
  const walk = nodes => {
    let s = '';
    for (const n of nodes) {
      if (n.s) s += ' ' + sym(n.s) + ' ';
      else if (n.frac) s += ` ((${walk(n.frac[0])})/(${walk(n.frac[1])})) `;
      else if (n.sqrt) s += ` sqrt(${walk(n.sqrt)}) `;
      else if (n.sup) s += ` ^(${walk(n.sup)}) `;
    }
    return s;
  };
  parts.push(walk(tree));
  return implicit(parts[0]);
}

/** the reader's expression (inkmath's text) as math.js input */
export function mathOfReading(text) {
  const s = String(text)
    .replace(/−/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/')
    .replace(/√/g, ' sqrt').replace(/π/g, ' pi ').replace(/θ/g, ' theta ');
  return implicit(s);
}

/* "2 x", "x y", ") (" → products, written out, so math.js does not read
   "xy" as one name; function names keep their bracket */
function implicit(s) {
  const toks = s.match(/sqrt|pi|theta|[a-z]|\d+(?:\.\d*)?|\.\d+|\S/g) || [];
  let out = '';
  for (let k = 0; k < toks.length; k++) {
    const a = toks[k - 1], b = toks[k];
    const endsValue = a && (/^[\d.]/.test(a) || /^[a-z]$/.test(a) || a === 'pi' || a === 'theta' || a === ')');
    const startsValue = /^[\d.]/.test(b) || /^[a-z]$/.test(b) || b === 'pi' || b === 'theta' || b === 'sqrt' || b === '(';
    if (endsValue && startsValue) out += '*';
    out += b;
  }
  return out;
}

/* ── scoring ─────────────────────────────────────────────────────────── */

/** edits (insert, delete, change) to turn one sequence into the other */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** the symbols a reading wrote, in its order, as `written` lists them */
export function readSymbols(reading) {
  return (reading.syms || []).map(s => s.frac ? '/' : s.ch);
}

const VALUES = { x: 1.37, y: 0.61, z: 2.3, a: 1.9, b: 0.47, c: 3.1, n: 2, t: 0.83, theta: 0.7 };
/**
 * Does the reading work out to what was written? Each side of an "="
 * is compared on its own, with the letters given fixed values. `ev` is
 * math.js's evaluate.
 */
export function sameValue(ev, truth, reading) {
  const sides = s => s.split('=');
  const a = sides(truth), b = sides(reading);
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (!a[k].trim() && !b[k].trim()) continue;
    let x, y;
    try { x = ev(a[k], { ...VALUES }); y = ev(b[k], { ...VALUES }); } catch (_) { return false; }
    x = +x; y = +y;
    if (!isFinite(x) || !isFinite(y)) { if (x !== y) return false; continue; }
    if (Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x))) return false;
  }
  return true;
}

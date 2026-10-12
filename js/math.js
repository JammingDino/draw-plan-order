/* ── math.js ── the maths engine, D.math ──────────────────────────────
   A wrapper round math.js (vendored under vendor/mathjs, Apache-2.0)
   tuned for what an engineering undergraduate types in a tutorial:
   units that come out the way a textbook writes them, phasors, matrices,
   derivatives, integrals, roots, and numbers in engineering notation.

   math.js is 650 KB of script the app does not need to start, so it is
   not linked from index.html: the first call to ready() injects it, and
   until then nothing here costs anything. Under node the tests load it
   into the realm first and ready() finds it already there.

   ── The API ──────────────────────────────────────────────────────────

   D.math.ready() → Promise<math>
       Loads the library once; later calls get the same promise. Rejects
       only if the script cannot be fetched. D.math.loaded says whether
       it is in yet.

   D.math.evaluate(src, scope?, opts?) → result                (never throws)
       One expression. src may use the friendly notation the calculator
       keypad types: × ÷ − π √ ² ³ ° Ω µ ∠ (10∠30° is a phasor), d/dx(…),
       A \ b (a linear system), and an equation with one unknown
       ("2x + 3 = 11") is solved for it. scope is a D.math.scope(), a Map
       or a plain object of variables; assignments land in it. Without
       one the expression gets a fresh scope of its own. opts overrides
       D.math.config for this call.
         { ok, value, text, pretty, alt?, rows?, tex?, name?, error?, pending? }
       text    plain ASCII that parses back ("6 kN m", "1.2e-3")
       pretty  for display: "6 kN·m", "1.2×10⁻³", "−2, 2"
       alt     a second form where one helps (a phasor's rectangular form)
       rows    a matrix as rows of pretty cells, for a grid
       tex     TeX of the expression and its result, where math.js can
       name    the variable assigned, if the line assigned one
       pending true when the library is still loading (call ready() first)

   D.math.evaluateLines(text, opts?) → result[]
       A worksheet: one result per line, variables flowing down. Blank
       lines and # or // comments give { kind: 'empty' | 'comment' };
       "Label: expr" evaluates expr; a line saying just "total" or "sum"
       adds up the results since the last blank line. Each result also
       has kind 'ok' or 'err'. What the calc blocks on the board run.

   D.math.scope() → a scope: constants (g, c, G, R, kB, NA, qe, hP, me,
       mp, ε0, μ0, σSB, ρw, …) under the variables you assign, which
       shadow them. Keep one to carry variables between calls.
   D.math.format(value, opts?) → { text, pretty, alt?, rows? }
   D.math.formatNumber(x, opts?) → { text, pretty }
   D.math.config  { angle: 'deg'|'rad', format: 'auto'|'fixed'|'sci'|'eng',
                    sig: significant figures (decimals for 'fixed'),
                    exact: fractions and multiples of π where they fit }
   D.math.hint(name) → a one-line usage note for a function, or null
   D.math.constants  [{ name, label, value, desc }] for a keypad

   Calculus (diff, int, lim, taylor) runs in radians whatever the angle
   mode — d/dx sin x = cos x only holds there, and a student checking a
   textbook integral expects the textbook's answer. solve() and plain
   arithmetic follow the mode, so solve(sin(x) = 0.5, x) is 30 in degrees. */
(function (D) {
  'use strict';

  const SRC = 'vendor/mathjs/math.min.js';
  let M = null;               // our own math.js instance, once loaded
  let loading = null;

  const config = { angle: 'deg', format: 'auto', sig: 5, exact: false };

  /* ── loading ─────────────────────────────────────────────────────── */
  function ready() {
    if (M) return Promise.resolve(M);
    const g = typeof window !== 'undefined' ? window : globalThis;
    if (g.math && g.math.create) { install(g.math); return Promise.resolve(M); }
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL(SRC, document.baseURI).href;
      s.async = true;
      s.onload = () => {
        try { install(g.math); resolve(M); }
        catch (err) { loading = null; reject(err); }
      };
      s.onerror = () => { loading = null; s.remove(); reject(new Error('Could not load the maths library')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /* A private instance rather than the global one: the functions added
     below (diff, int, solve…) replace or add to math.js's own, and
     whatever else on the page might use window.math should not find them
     changed underneath it. */
  function install(lib) {
    if (M) return;
    M = lib.create();
    M.import(EXTRA(), { override: true });
    for (const c of CONSTANTS) c.value = c.unit ? M.unit(c.unit) : c.num;
    BASE = baseScope();
    NAMED = NAMED_UNITS.map(([s, name, prefix]) => ({ unit: M.unit(s), name, prefix }));
    COMPOUND = COMPOUND_UNITS.map(s => ({ unit: M.unit(s), parts: partsOf(M.unit(s).units) }));
    FORCE = M.unit('N'); LENGTH = M.unit('m'); ENERGY = M.unit('J');
  }

  /* ── constants ───────────────────────────────────────────────────── */
  /* Short names, chosen not to collide with a unit math.js already has:
     `h` is the hour (so Planck is hP), `k` is left free for a spring
     constant (Boltzmann is kB), `e` is Euler's number (the charge is qe).
     `g` is gravity rather than the gram, because a statics tutorial says
     "m g" a hundred times for every gram — write grams as `gram` or kg. */
  const CONSTANTS = [
    { name: 'g', label: 'g', unit: '9.80665 m/s^2', desc: 'standard gravity' },
    { name: 'c', label: 'c', unit: '299792458 m/s', desc: 'speed of light' },
    { name: 'G', label: 'G', unit: '6.67430e-11 N m^2/kg^2', desc: 'gravitational constant' },
    { name: 'R', label: 'R', unit: '8.314462618 J/(mol K)', desc: 'gas constant' },
    { name: 'kB', label: 'k_B', unit: '1.380649e-23 J/K', desc: 'Boltzmann constant' },
    { name: 'NA', label: 'N_A', unit: '6.02214076e23 mol^-1', desc: 'Avogadro constant' },
    { name: 'qe', label: 'q_e', unit: '1.602176634e-19 C', desc: 'elementary charge' },
    { name: 'hP', label: 'h', unit: '6.62607015e-34 J s', desc: 'Planck constant' },
    { name: 'me', label: 'm_e', unit: '9.1093837015e-31 kg', desc: 'electron mass' },
    { name: 'mp', label: 'm_p', unit: '1.67262192369e-27 kg', desc: 'proton mass' },
    { name: 'ε0', label: 'ε₀', unit: '8.8541878128e-12 F/m', desc: 'permittivity of free space' },
    { name: 'μ0', label: 'μ₀', unit: '1.25663706212e-6 H/m', desc: 'permeability of free space' },
    { name: 'σSB', label: 'σ', unit: '5.670374419e-8 W/(m^2 K^4)', desc: 'Stefan–Boltzmann constant' },
    { name: 'ρw', label: 'ρ_w', unit: '1000 kg/m^3', desc: 'density of water' },
    { name: 'patm', label: 'p_atm', unit: '101325 Pa', desc: 'standard atmosphere' }
  ];
  const ALIASES = { eps0: 'ε0', mu0: 'μ0', sigmaSB: 'σSB', rhow: 'ρw' };

  let BASE = null;
  const EMPTY = new Map();

  /* The base layer every scope sits on: the constants, and the trig
     functions for the angle mode. They are scope entries rather than
     replacements inside math.js so that symbolic work — derivative,
     simplify — keeps the real sin and cos, which are in radians. */
  function baseScope() {
    const b = new Map();
    for (const c of CONSTANTS) b.set(c.name, c.value);
    for (const a in ALIASES) b.set(a, b.get(ALIASES[a]));
    b.set('π', Math.PI);
    b.set('∞', Infinity);
    b.set('inf', Infinity);
    const DEG = Math.PI / 180;
    const deg = () => config.angle === 'deg';
    const plain = x => typeof x === 'number';
    /* exact at the angles a tutorial uses, so cos(90) is 0 and not 6e-17 */
    const exactSin = d => {
      const r = ((d % 360) + 360) % 360;
      return { 0: 0, 30: 0.5, 90: 1, 150: 0.5, 180: 0, 210: -0.5, 270: -1, 330: -0.5 }[r];
    };
    /* sin(π) is 1.2e-16 in floating point; a calculator says 0. Only an
       answer that small from an argument that is not small is chopped —
       sin(1e-20) really is 1e-20. */
    const chop = (y, x) => (typeof y === 'number' && Math.abs(y) < 1e-15 && Math.abs(x) > 1e-6) ? 0 : y;
    const fwd = (name, ex) => function (x) {
      if (!plain(x)) return M[name](x);
      if (deg()) {
        const e = ex(x);
        if (e !== undefined) return e;
        return chop(M[name](x * DEG), x);
      }
      return chop(M[name](x), x);
    };
    b.set('sin', fwd('sin', x => exactSin(x)));
    b.set('cos', fwd('cos', x => exactSin(x + 90)));
    b.set('tan', fwd('tan', x => {
      const s = exactSin(x), c = exactSin(x + 90);
      if (s === undefined || c === undefined) return undefined;
      return c === 0 ? (s > 0 ? Infinity : -Infinity) : s / c;
    }));
    for (const n of ['sec', 'csc', 'cot']) b.set(n, fwd(n, () => undefined));
    const inv = name => function (...a) {
      const y = M[name](...a);
      return deg() && typeof y === 'number' && a.every(plain) ? y / DEG : y;
    };
    for (const n of ['asin', 'acos', 'atan', 'atan2', 'asec', 'acsc', 'acot']) b.set(n, inv(n));
    return b;
  }

  /**
   * Variables over a parent: reads fall through, writes stay here. The
   * board's calculator keeps one per board; a preview while typing runs in
   * a throwaway child of it, so "x = 3" half-typed assigns nothing.
   */
  class Scope {
    constructor(parent, vars) {
      this._parent = parent || null;
      this.vars = vars || new Map();
    }
    /* the constants, unless made with a parent of its own — looked up
       late, so a scope made before the library loaded still finds them */
    get parent() { return this._parent || BASE || EMPTY; }
    get(k) { return this.vars.has(k) ? this.vars.get(k) : this.parent.get(k); }
    has(k) { return this.vars.has(k) || this.parent.has(k); }
    set(k, v) { this.vars.set(k, v); return this; }
    delete(k) { return this.vars.delete(k); }
    clear() { this.vars.clear(); }
    keys() { return new Set([...this.parent.keys(), ...this.vars.keys()]).values(); }
    forEach(fn) { for (const k of this.keys()) fn(this.get(k), k, this); }
    /** just the variables assigned here, not the constants underneath */
    own() { return [...this.vars.keys()]; }
    child() { return new Scope(this); }
  }

  /* ── reading the friendly notation ──────────────────────────────── */
  const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };

  /** index of the bracket that closes the one opening at i, or -1 */
  function closing(s, i) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') { depth--; if (!depth) return j; }
    }
    return -1;
  }
  function opening(s, i) {
    let depth = 0;
    for (let j = i; j >= 0; j--) {
      const ch = s[j];
      if (ch === ')' || ch === ']') depth++;
      else if (ch === '(' || ch === '[') { depth--; if (!depth) return j; }
    }
    return -1;
  }
  /** the top-level pieces of s split on ch (not inside brackets) */
  function splitTop(s, ch) {
    const out = []; let depth = 0, from = 0;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ch && !depth) { out.push(s.slice(from, j)); from = j + 1; }
    }
    out.push(s.slice(from));
    return out;
  }
  /* A lone "=", not part of ==, <=, >= or != */
  const LONE_EQ = /(^|[^=<>!])=(?!=)/;

  /** the operand ending just before i: a number, a name, or a bracketed group with its function */
  function operandBefore(s, i) {
    let j = i - 1;
    while (j >= 0 && s[j] === ' ') j--;
    let start;
    if (s[j] === ')' || s[j] === ']') {
      start = opening(s, j);
      if (start < 0) return null;
      while (start > 0 && /[\w.]/.test(s[start - 1])) start--;
    } else {
      start = j + 1;
      while (start > 0 && /[\w.]/.test(s[start - 1])) start--;
      if (start > j) return null;
    }
    return { start, end: j + 1 };
  }
  /** the operand starting at i: an optional sign, then a number, name or group, then an angle unit */
  function operandAfter(s, i) {
    let j = i;
    while (s[j] === ' ') j++;
    const start = j;
    if (s[j] === '-' || s[j] === '+') j++;
    while (s[j] === ' ') j++;
    if (s[j] === '(' || s[j] === '[') { j = closing(s, j); if (j < 0) return null; j++; }
    else {
      const from = j;
      while (j < s.length && /[\w.]/.test(s[j])) j++;
      if (j === from) return null;
      if (s[j] === '(') { const k = closing(s, j); if (k < 0) return null; j = k + 1; }
    }
    const unit = /^\s*(deg|rad)\b/.exec(s.slice(j));
    if (unit) j += unit[0].length;
    return { start, end: j };
  }

  /**
   * The keypad's notation, and the bits of a textbook's, into math.js's.
   * Only what math.js cannot read is touched.
   */
  const PREFIX = { T: 12, G: 9, M: 6, k: 3, u: -6, n: -9, p: -12 };

  function preprocess(src) {
    let s = String(src);
    s = s.replace(/[×✕⋅·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-')
      .replace(/[µμ](?=[A-Za-zΩ])/g, 'u')      // µF, µs: the micro prefix; μ0 alone is the constant
      .replace(/Ω/g, 'ohm')
      .replace(/°\s*([CF])\b/g, 'deg$1').replace(/°/g, ' deg')
      .replace(/π/g, 'pi').replace(/∞/g, 'Infinity')
      .replace(/ᵀ/g, "'")
      .replace(/[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, m => '^(' + [...m].map(c => SUP[c]).join('') + ')')
      .replace(/([√∛])\s*(\d+\.?\d*|[A-Za-z_]\w*(?!\s*\())/g, '$1($2)')
      .replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt')
      .replace(/∫/g, 'int')
      /* 4.7k, 10M, 100n, 22p: the way a resistor or a capacitor is
         written on a schematic. A bare number with one prefix letter and
         nothing after it; 5m is left alone because it already means five
         metres, and 10uF, 2kN are units math.js reads for itself. */
      .replace(/(^|[^\w.])(\d+(?:\.\d+)?)([kMGTunp])(?![\w(])/g, (m, pre, n, p) => `${pre}(${n}e${PREFIX[p]})`);

    // d/dx(f) → diff(f, x)
    for (let m; (m = /\bd\/d([A-Za-z]\w*)\s*\(/.exec(s));) {
      const open = m.index + m[0].length - 1, close = closing(s, open);
      if (close < 0) { s = s.slice(0, m.index) + 'diff(' + s.slice(open + 1); break; }
      s = s.slice(0, m.index) + 'diff(' + s.slice(open + 1, close) + ', ' + m[1] + ')' + s.slice(close + 1);
    }

    // r∠θ → phasor(r, θ)
    for (let i; (i = s.indexOf('∠')) >= 0;) {
      const a = operandBefore(s, i), b = operandAfter(s, i + 1);
      if (!a || !b) { s = s.slice(0, i) + ' angle ' + s.slice(i + 1); break; }   // leaves a clear parse error
      s = s.slice(0, a.start) + 'phasor(' + s.slice(a.start, a.end) + ', ' + s.slice(b.start, b.end) + ')' + s.slice(b.end);
    }

    // solve(lhs = rhs, …): the equation is a comparison to math.js
    for (let at = 0, m; (m = /\bsolve\s*\(/g), (m.lastIndex = at), (m = m.exec(s));) {
      const open = m.index + m[0].length - 1, close = closing(s, open);
      if (close < 0) break;
      const args = splitTop(s.slice(open + 1, close), ',');
      args[0] = args[0].replace(LONE_EQ, '$1==');
      const inner = args.join(',');
      s = s.slice(0, open + 1) + inner + s.slice(close);
      at = open + 1 + inner.length;
    }

    // A \ b, a linear system, at the top level of the line (after any assignment)
    if (s.includes('\\')) {
      const asg = /^\s*[A-Za-z_]\w*\s*=(?!=)/.exec(s);
      const head = asg ? asg[0] : '', body = s.slice(head.length);
      const parts = splitTop(body, '\\');
      if (parts.length === 2 && parts[0].trim() && parts[1].trim())
        s = head + ' lusolve(' + parts[0].trim() + ', ' + parts[1].trim() + ')';
    }
    return s;
  }

  /* ── the functions math.js lacks ─────────────────────────────────── */
  const isNode = x => x && x.isNode;
  const toNum = v => {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    if (v.isUnit) return v.value == null ? NaN : (typeof v.value === 'number' ? v.value : NaN);
    if (v.isComplex) return Math.abs(v.im) <= 1e-12 * (1 + Math.abs(v.re)) ? v.re : NaN;
    if (v.isBigNumber || v.isFraction) return Number(v);
    if (typeof v === 'boolean') return +v;
    return NaN;
  };

  /** f(t) for the expression `node` in variable `name`, evaluated in a child of `scope` */
  function fnOf(node, name, scope, rad) {
    const code = node.compile();
    const sub = new Scope(scope);
    return t => {
      sub.vars.set(name, t);
      const was = config.angle;
      if (rad) config.angle = 'rad';
      try { return code.evaluate(sub); } finally { config.angle = was; }
    };
  }

  /** the variable a calculus function works in: named, or the one free symbol, or x */
  function variableOf(node, scope, given) {
    if (given) {
      if (given.isSymbolNode) return given.name;
      if (given.isAssignmentNode) return given.object ? given.object.name : given.name;
      throw new Error('Expected a variable name, like x');
    }
    const free = unknowns(node, scope);
    if (free.length === 1) return free[0];
    if (free.includes('x')) return 'x';
    if (!free.length) return 'x';
    throw new Error('Which variable? Give it as the second argument: ' + free.join(', '));
  }

  /** symbols in the expression that are not defined anywhere: the unknowns */
  function unknowns(node, scope) {
    const seen = new Set();
    node.traverse((n, path, parent) => {
      if (!n.isSymbolNode) return;
      if (parent && parent.isFunctionNode && parent.fn === n) return;
      const name = n.name;
      if (scope && scope.has(name)) return;
      if (name in M) return;
      try { if (M.Unit.isValuelessUnit(name)) return; } catch (_) { }
      seen.add(name);
    });
    return [...seen];
  }

  /** symbols in the expression that were assigned by the user rather than built in */
  function mine(node, scope) {
    const out = new Set();
    node.traverse((n, path, parent) => {
      if (!n.isSymbolNode || (parent && parent.isFunctionNode && parent.fn === n)) return;
      for (let s = scope; s instanceof Scope; s = s._parent) if (s.vars.has(n.name)) { out.add(n.name); break; }
    });
    out.delete('ans');
    return [...out];
  }

  /** user functions (f(x) = …) written out, so derivative() can see inside them */
  function inline(node, scope, depth = 0) {
    if (depth > 8) return node;
    return node.transform(n => {
      if (!n.isFunctionNode || !n.fn || !n.fn.isSymbolNode) return n;
      const f = scope.has(n.fn.name) ? scope.get(n.fn.name) : null;
      if (!f || !f._def || f._def.params.length !== n.args.length) return n;
      const map = new Map(f._def.params.map((p, i) => [p, n.args[i]]));
      const body = f._def.expr.transform(m => m.isSymbolNode && map.has(m.name) ? map.get(m.name) : m);
      return new M.ParenthesisNode(inline(body, scope, depth + 1));
    });
  }

  /**
   * The unit an unknown must carry for an equation to balance: 2 kN · d =
   * 6 kN·m needs d in metres. Each side is evaluated with the unknown as
   * a plain 1, and the unit is whichever of their ratio, its inverse or
   * their square roots lets the equation evaluate. One SI unit of it
   * comes back (1 m), so the search can run on plain numbers.
   */
  function unitFor(sides, name, scope, f) {
    let l, r;
    try {
      const one = n => fnOf(inline(n, scope), name, scope, false)(1);
      l = one(sides[0]); r = one(sides[1]);
    } catch (_) { return null; }
    const tries = [];
    const add = q => {
      if (!q || !q.isUnit || !q.value) return;
      tries.push(M.divide(q, q.value));
    };
    try { add(M.divide(r, l)); add(M.divide(l, r)); add(M.sqrt(M.divide(r, l))); add(M.sqrt(M.divide(l, r))); } catch (_) { }
    for (const u of tries) {
      try { f(M.multiply(1, u)); return u; } catch (_) { }
    }
    return null;
  }

  /* Adaptive Gauss–Kronrod (7/15 points). The Kronrod rule is the answer,
     its difference from the embedded Gauss rule is the error estimate,
     and an interval whose estimate is too big is halved. Neither rule
     evaluates the endpoints, so 1/sqrt(x) from 0 still integrates. */
  const XGK = [0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440,
    0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0];
  const WGK = [0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919,
    0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828];
  const WG = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];

  function gk15(f, a, b) {
    const c = (a + b) / 2, h = (b - a) / 2;
    const fc = f(c);
    let k = fc * WGK[7], g = fc * WG[3];
    for (let i = 0; i < 7; i++) {
      const dx = h * XGK[i];
      const s = f(c - dx) + f(c + dx);
      k += WGK[i] * s;
      if (i % 2 === 1) g += WG[(i - 1) / 2] * s;
    }
    return [k * h, Math.abs((k - g) * h)];
  }

  function integrate(f, a, b) {
    if (a === b) return 0;
    if (a > b) return -integrate(f, b, a);
    // infinite ends: x = a + t/(1-t), or x = t/(1-t²) both ways
    if (!isFinite(a) && !isFinite(b)) return integrate(t => { const d = 1 - t * t; return f(t / d) * (1 + t * t) / (d * d); }, -1, 1);
    if (!isFinite(b)) return integrate(t => f(a + t / (1 - t)) / ((1 - t) * (1 - t)), 0, 1);
    if (!isFinite(a)) return -integrate(t => f(b - t / (1 - t)) / ((1 - t) * (1 - t)), 0, 1);
    let evals = 0;
    const g = x => {
      if (++evals > 60000) throw new Error('The integral did not settle — is it finite over that range?');
      const y = toNum(f(x));
      if (!isFinite(y)) throw new Error('The integrand is not finite at x = ' + fmtNum(x, config).pretty);
      return y;
    };
    const rec = (lo, hi, whole, err, tol, depth) => {
      if (err <= tol || depth > 40) return whole;
      const m = (lo + hi) / 2;
      const [l, el] = gk15(g, lo, m), [r, er] = gk15(g, m, hi);
      return rec(lo, m, l, el, tol / 2, depth + 1) + rec(m, hi, r, er, tol / 2, depth + 1);
    };
    const [whole, err] = gk15(g, a, b);
    return rec(a, b, whole, err, Math.max(1e-13, 1e-11 * Math.abs(whole)), 0);
  }

  /* Brent's method: bisection's guarantee, secant speed. */
  function brent(f, a, b, fa, fb) {
    if (fa === 0) return a;
    if (fb === 0) return b;
    let c = a, fc = fa, d = b - a, e = d;
    for (let i = 0; i < 200; i++) {
      if (fb * fc > 0) { c = a; fc = fa; d = e = b - a; }
      if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
      const tol = 2e-16 * Math.abs(b) + 1e-300, m = (c - b) / 2;
      if (Math.abs(m) <= tol || fb === 0) return b;
      if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
        const s = fb / fa;
        let p, q;
        if (a === c) { p = 2 * m * s; q = 1 - s; }
        else {
          const qq = fa / fc, r = fb / fc;
          p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
          q = (qq - 1) * (r - 1) * (s - 1);
        }
        if (p > 0) q = -q; else p = -p;
        if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; }
        else { d = m; e = d; }
      } else { d = m; e = d; }
      a = b; fa = fb;
      b += Math.abs(d) > tol ? d : (m > 0 ? tol : -tol);
      fb = f(b);
    }
    return b;
  }

  /**
   * Every real root of f in [lo, hi]. Sampled on a linear grid and, when
   * the range spans zero, on a logarithmic one too (so roots at 1e-4 and
   * at 1e3 are both seen); each sign change is closed in on with Brent,
   * and each dip of |f| that does not change sign — a double root, like
   * (x−1)² — is polished with Newton. Poles (tan at 90°) change sign too,
   * and are thrown out because f is not small there.
   */
  function rootsIn(f, lo, hi) {
    const xs = [];
    const N = 1200;
    for (let i = 0; i <= N; i++) xs.push(lo + (hi - lo) * i / N);
    for (const sgn of [-1, 1]) for (let k = -8; k <= 7; k += 0.125) {
      const x = sgn * 10 ** k;
      if (x > lo && x < hi) xs.push(x);
    }
    xs.sort((p, q) => p - q);
    const ys = xs.map(x => { const y = toNum(f(x)); return isFinite(y) ? y : NaN; });
    let scale = 0;
    for (const y of ys) if (isFinite(y)) scale = Math.max(scale, Math.abs(y));
    const small = 1e-9 * (scale || 1);
    const out = [];
    const keep = x => {
      const y = Math.abs(toNum(f(x)));
      if (!(y <= Math.max(1e-7 * (scale || 1), 1e-12))) return;
      if (!out.some(r => Math.abs(r - x) <= 1e-7 * (1 + Math.abs(x)))) out.push(x);
    };
    for (let i = 0; i < xs.length - 1; i++) {
      const y0 = ys[i], y1 = ys[i + 1];
      if (!isFinite(y0) || !isFinite(y1)) continue;
      if (y0 === 0) { keep(xs[i]); continue; }
      if (y0 * y1 < 0) keep(brent(x => toNum(f(x)), xs[i], xs[i + 1], y0, y1));
      else if (i > 0 && Math.abs(y0) < small * 1e3 && Math.abs(y0) <= Math.abs(ys[i - 1]) && Math.abs(y0) <= Math.abs(y1)) {
        // a touch: Newton on f from the dip
        let x = xs[i];
        for (let n = 0; n < 60; n++) {
          const h = 1e-7 * (1 + Math.abs(x));
          const fx = toNum(f(x)), d = (toNum(f(x + h)) - toNum(f(x - h))) / (2 * h);
          if (!d || !isFinite(d)) break;
          const nx = x - fx / d;
          if (Math.abs(nx - x) < 1e-14 * (1 + Math.abs(x))) { x = nx; break; }
          x = nx;
        }
        keep(x);
      }
    }
    if (ys[ys.length - 1] === 0) keep(xs[xs.length - 1]);
    return out.sort((p, q) => p - q);
  }

  /** the limit of f at a (±Infinity allowed), from both sides */
  function limit(f, a) {
    const val = x => toNum(f(x));
    const settle = seq => {
      // Aitken's Δ² on the tail of a sequence that converges
      const v = seq.map(val).filter(isFinite);
      if (v.length < 3) return NaN;
      const [p, q, r] = v.slice(-3);
      const den = r - 2 * q + p;
      const acc = Math.abs(den) > 1e-300 ? r - (r - q) * (r - q) / den : r;
      if (Math.abs(r) > 1e12 && Math.abs(r) > Math.abs(q) * 5) return r > 0 ? Infinity : -Infinity;
      return isFinite(acc) && Math.abs(acc - r) <= 1e-4 * (1 + Math.abs(r)) ? acc : r;
    };
    if (!isFinite(a)) return settle([2, 4, 6, 8, 10, 12].map(k => (a > 0 ? 1 : -1) * 10 ** k));
    const hs = [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7];
    const s = 1 + Math.abs(a);
    const right = settle(hs.map(h => a + h * s)), left = settle(hs.map(h => a - h * s));
    const close = (p, q) => p === q || Math.abs(p - q) <= 1e-5 * (1 + Math.abs(p) + Math.abs(q));
    if (close(left, right)) return isFinite(left) ? (left + right) / 2 : left;
    throw new Error(`The limit differs from each side: ${fmtNum(left, config).pretty} from below, ${fmtNum(right, config).pretty} from above`);
  }

  /* Durand–Kerner: all roots of a polynomial at once, complex ones too.
     coeffs ascending: c0 + c1 x + c2 x² + … */
  function polyRoots(coeffs) {
    let c = coeffs.slice();
    while (c.length > 1 && Math.abs(c[c.length - 1]) < 1e-300) c.pop();
    const n = c.length - 1;
    if (n < 1) throw new Error('That is a constant — it has no roots to find');
    const lead = c[n];
    c = c.map(v => v / lead);
    const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    const evalP = z => { let r = [1, 0]; for (let k = n - 1; k >= 0; k--) { r = mul(r, z); r[0] += c[k]; } return r; };
    // a radius from the coefficients (Cauchy's bound) keeps the start sane
    const R = 1 + Math.max(...c.slice(0, n).map(Math.abs));
    let z = Array.from({ length: n }, (_, k) => {
      const t = 2 * Math.PI * k / n + 0.4;
      return [R * 0.5 * Math.cos(t), R * 0.5 * Math.sin(t)];
    });
    for (let it = 0; it < 800; it++) {
      let moved = 0;
      z = z.map((zi, i) => {
        let den = [1, 0];
        for (let j = 0; j < n; j++) if (j !== i) den = mul(den, [zi[0] - z[j][0], zi[1] - z[j][1]]);
        const step = div(evalP(zi), den);
        moved = Math.max(moved, Math.hypot(step[0], step[1]));
        return [zi[0] - step[0], zi[1] - step[1]];
      });
      if (moved < 1e-15 * R) break;
    }
    const out = z.map(([re, im]) => Math.abs(im) <= 1e-9 * (1 + Math.abs(re)) ? round12(re) : M.complex(round12(re), round12(im)));
    return out.sort((p, q) => {
      const pr = typeof p === 'number', qr = typeof q === 'number';
      if (pr !== qr) return pr ? -1 : 1;
      return pr ? p - q : (p.re - q.re) || (p.im - q.im);
    });
  }
  const round12 = x => { const r = Math.round(x); return Math.abs(x - r) < 1e-10 * (1 + Math.abs(x)) ? r : x; };

  /** a list of roots, shown as "x = −2, 2" */
  class Roots {
    constructor(name, list, note) { this.name = name; this.list = list; this.note = note || ''; }
    toArray() { return this.list.slice(); }
  }
  /** a straight-line fit, shown as "y = 2x + 1 (R² = 0.99)" */
  class Fit {
    constructor(slope, intercept, r2) { this.slope = slope; this.intercept = intercept; this.r2 = r2; }
  }

  const numArg = (node, scope, what) => {
    const v = node.compile().evaluate(scope);
    const n = toNum(v);
    if (!isFinite(n) && !(n === Infinity || n === -Infinity)) throw new Error(what + ' must be a number');
    return n;
  };

  /* The functions the calculator adds. rawArgs means math.js hands over
     the expressions unevaluated, which is how diff(x^2, x) can see "x^2"
     rather than whatever x happens to be. */
  function EXTRA() {
    const orig = M.diff;          // math.js's own diff() is the difference between neighbours in a list

    function diff(args, math, scope) {
      if (!args.length) throw new Error('diff(f, x) — the derivative of f');
      const first = args[0];
      if (first.isArrayNode || (args.length === 1 && !unknowns(first, scope).length && !first.isSymbolNode))
        return orig(...args.map(a => a.compile().evaluate(scope)));
      const at = args[1] && args[1].isAssignmentNode ? args[1] : null;
      const name = variableOf(first, scope, args[1]);
      let order = 1;
      if (args[2]) order = numArg(args[2], scope, 'The order');
      if (!(order >= 1 && order <= 12 && order % 1 === 0)) throw new Error('The order of a derivative is a whole number, 1 to 12');
      let d = inline(first, scope);
      for (let i = 0; i < order; i++) d = M.simplify(M.derivative(d, name));
      if (!at) return d;
      return fnOf(d, name, scope, true)(at.value.compile().evaluate(scope));
    }
    diff.rawArgs = true;

    function int(args, math, scope) {
      if (args.length < 4) throw new Error('int(f, x, a, b) — the integral of f from x = a to b');
      const name = variableOf(args[0], scope, args[1]);
      const a = numArg(args[2], scope, 'The lower limit'), b = numArg(args[3], scope, 'The upper limit');
      const f = fnOf(inline(args[0], scope), name, scope, true);
      return integrate(f, a, b);
    }
    int.rawArgs = true;

    function lim(args, math, scope) {
      if (args.length < 2) throw new Error('lim(f, x = a) — the limit of f as x goes to a');
      const name = variableOf(args[0], scope, args[1]);
      const at = args[1].isAssignmentNode ? args[1].value : args[2];
      if (!at) throw new Error('lim(f, x = a) — where should x go?');
      const a = numArg(at, scope, 'The limit point');
      const f = fnOf(inline(args[0], scope), name, scope, true);
      const v = limit(f, a);
      return round12(v);
    }
    lim.rawArgs = true;

    function solve(args, math, scope) {
      if (!args.length) throw new Error('solve(f = g, x) — the values of x that make it true');
      let node = args[0], sides = null;
      if (node.isOperatorNode && node.fn === 'equal') {
        sides = node.args;
        node = new M.OperatorNode('-', 'subtract', [sides[0], new M.ParenthesisNode(sides[1])]);
      }
      const name = variableOf(node, scope, args[1]);
      let lo = -1000, hi = 1000;
      if (args.length >= 4) { lo = numArg(args[2], scope, 'The range start'); hi = numArg(args[3], scope, 'The range end'); }
      if (lo > hi) [lo, hi] = [hi, lo];
      let f = fnOf(inline(node, scope), name, scope, false);
      const trial = lo + (hi - lo) * 0.37;
      let unit = null;
      try { f(trial); }                    // let an error (an undefined symbol) out before the search hides it
      catch (err) {
        unit = sides && /match|Unexpected type/i.test(err.message) ? unitFor(sides, name, scope, f) : null;
        if (!unit) throw err;
        const g = f;
        f = t => g(M.multiply(t, unit));
      }
      let found = rootsIn(f, lo, hi);
      if (!found.length) throw new Error(`No real ${name} between ${fmtNum(lo, config).pretty} and ${fmtNum(hi, config).pretty} makes it true`);
      found = found.map(round12);
      if (unit) found = found.map(t => M.multiply(t, unit));
      if (found.length === 1) return found[0];
      let note = '';
      if (found.length > 8) {
        note = `+${found.length - 8} more`;
        found = found.slice().sort((p, q) => Math.abs(p) - Math.abs(q)).slice(0, 8).sort((p, q) => p - q);
      }
      return new Roots(name, found, note);
    }
    solve.rawArgs = true;

    function roots(args, math, scope) {
      if (!args.length) throw new Error('roots(p) — every root of a polynomial, complex ones too');
      if (args.length > 1 && !args[1].isSymbolNode) {
        // roots(c0, c1, c2…) — coefficients, highest power last, as polynomialRoot takes them
        return asRoots('x', polyRoots(args.map(a => numArg(a, scope, 'A coefficient'))));
      }
      const name = variableOf(args[0], scope, args[1]);
      let detail;
      try { detail = M.rationalize(inline(args[0], scope), {}, true); }
      catch (_) { throw new Error('That is not a polynomial in ' + name + ' — try solve() instead'); }
      if (detail.variables.length > 1 || (detail.variables.length === 1 && detail.variables[0] !== name))
        throw new Error('roots() needs a polynomial in ' + name + ' alone');
      if (!detail.coefficients || detail.coefficients.length < 2) throw new Error('That is a constant — it has no roots to find');
      return asRoots(name, polyRoots(detail.coefficients.map(Number)));
    }
    roots.rawArgs = true;
    const asRoots = (name, list) => list.length === 1 ? list[0] : new Roots(name, list);

    function taylor(args, math, scope) {
      if (!args.length) throw new Error('taylor(f, x, a, n) — the series of f about x = a, to xⁿ');
      const name = variableOf(args[0], scope, args[1]);
      const a = args[2] ? numArg(args[2], scope, 'The point') : 0;
      const n = args[3] ? numArg(args[3], scope, 'The number of terms') : 5;
      if (!(n >= 0 && n <= 12 && n % 1 === 0)) throw new Error('Up to 12 terms');
      let d = inline(args[0], scope);
      const terms = [];
      let fact = 1;
      for (let k = 0; k <= n; k++) {
        if (k) { d = M.simplify(M.derivative(d, name)); fact *= k; }
        const v = toNum(fnOf(d, name, scope, true)(a)) / fact;
        if (!isFinite(v)) throw new Error('The series does not exist there');
        if (Math.abs(v) > 1e-14) terms.push([k, v]);
      }
      if (!terms.length) return M.parse('0');
      const xa = a === 0 ? name : `(${name} - ${a})`;
      const str = terms.map(([k, v], i) => {
        const r = rational(Math.abs(v), 100000);
        const mag = r ? (r[1] === 1 ? String(r[0]) : `${r[0]}/${r[1]}`) : String(+Math.abs(v).toPrecision(config.sig));
        const sign = v < 0 ? (i ? ' - ' : '-') : (i ? ' + ' : '');
        if (!k) return sign + mag;
        const pow = k === 1 ? xa : `${xa}^${k}`;
        if (r && r[0] === 1 && r[1] !== 1) return `${sign}${pow}/${r[1]}`;
        if (mag === '1') return sign + pow;
        return `${sign}${mag} ${pow}`;
      }).join('');
      return M.parse(str);
    }
    taylor.rawArgs = true;

    return {
      diff, int, lim, solve, roots, taylor,
      integral: int, limit: lim,
      /** a phasor: magnitude r at angle θ (degrees or radians by the mode, or a unit) */
      phasor(r, theta) {
        const t = theta && theta.isUnit ? theta.toNumber('rad') : toNum(theta) * (config.angle === 'deg' ? Math.PI / 180 : 1);
        return M.multiply(r, M.complex({ r: 1, phi: t }));
      },
      polar: z => z,
      rect: z => z,
      linsolve: (A, b) => M.lusolve(A, b),
      linreg(xs, ys) {
        const x = M.flatten(M.matrix(xs)).toArray().map(toNum), y = M.flatten(M.matrix(ys)).toArray().map(toNum);
        if (x.length !== y.length || x.length < 2) throw new Error('linreg(xs, ys) needs two lists of the same length');
        const n = x.length, mx = x.reduce((p, q) => p + q) / n, my = y.reduce((p, q) => p + q) / n;
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
        if (!sxx) throw new Error('The x values are all the same');
        const m = sxy / sxx;
        return new Fit(m, my - m * mx, syy ? (sxy * sxy) / (sxx * syy) : 1);
      }
    };
  }

  /* ── formatting ──────────────────────────────────────────────────── */
  const SUPS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '+': '⁺' };
  const sup = n => String(n).split('').map(c => SUPS[c] || c).join('');
  const minus = s => s.replace(/-/g, '−');
  const SI = { '-15': 'f', '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T' };

  /** the nearest fraction n/d with d ≤ maxDen, if x is that fraction to 12 figures */
  function rational(x, maxDen) {
    if (!isFinite(x)) return null;
    const sign = x < 0 ? -1 : 1;
    let v = Math.abs(x);
    let h0 = 1, h1 = 0, k0 = 0, k1 = 1;
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(v);
      [h0, h1] = [a * h0 + h1, h0];
      [k0, k1] = [a * k0 + k1, k0];
      if (k0 > maxDen) return null;
      if (Math.abs(Math.abs(x) - h0 / k0) <= 1e-12 * Math.max(1, Math.abs(x))) return h0 > 1e9 ? null : [sign * h0, k0];
      const f = v - a;
      if (f < 1e-15) return null;
      v = 1 / f;
    }
    return null;
  }

  /** 1/3, 3π/4, √3/2 — or null if x is none of those */
  function exactForm(x) {
    if (Number.isInteger(x)) return null;
    const r = rational(x, 1000);
    if (r) return { text: `${r[0]}/${r[1]}`, pretty: minus(`${r[0]}/${r[1]}`) };
    const p = rational(x / Math.PI, 360);
    if (p) {
      const n = p[0] === 1 ? '' : p[0] === -1 ? '-' : String(p[0]);
      return { text: `${n || ''}${n && n !== '-' ? '*' : ''}pi${p[1] === 1 ? '' : '/' + p[1]}`, pretty: minus(`${n}π${p[1] === 1 ? '' : '/' + p[1]}`) };
    }
    const q = rational(x * x, 100);
    if (q && q[0] > 0 && q[0] < 1e6) {
      // √(n/d) = √(n·d)/d, then square factors out of the root
      let inside = q[0] * q[1], out = 1;
      for (let f = 2; f * f <= inside; f++) while (inside % (f * f) === 0) { inside /= f * f; out *= f; }
      if (inside === 1) return null;
      const g = gcd(out, q[1]), num = out / g, den = q[1] / g;
      const sgn = x < 0 ? '-' : '';
      const pre = num === 1 ? '' : String(num);
      return {
        text: `${sgn}${pre}${pre ? '*' : ''}sqrt(${inside})${den === 1 ? '' : '/' + den}`,
        pretty: minus(`${sgn}${pre}√${inside}${den === 1 ? '' : '/' + den}`)
      };
    }
    return null;
  }
  const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);

  /* thin spaces between thousands, SI style, once a number is long enough to need them */
  function group(s) {
    const m = /^(-?)(\d+)(\.\d+)?$/.exec(s);
    if (!m || m[2].length < 5) return s;
    return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (m[3] || '');
  }

  /**
   * A number as the settings ask: { text, pretty }. text parses back;
   * pretty is for reading (×10ⁿ, a real minus sign, grouped digits).
   * `letter` false keeps engineering mode from writing 4.7k, for a
   * number that has a unit after it.
   */
  function fmtNum(x, c = config, letter = true) {
    if (typeof x !== 'number') x = toNum(x);
    if (!isFinite(x)) {
      if (isNaN(x)) return { text: 'NaN', pretty: 'undefined' };
      return x > 0 ? { text: 'Infinity', pretty: '∞' } : { text: '-Infinity', pretty: '−∞' };
    }
    if (c.exact) { const ex = exactForm(x); if (ex) return ex; }
    if (x === 0) return { text: '0', pretty: '0' };
    const sig = Math.max(1, Math.min(15, c.sig | 0 || 5));
    if (c.format === 'fixed') {
      const t = x.toFixed(Math.min(12, Math.max(0, c.sig | 0)));
      return { text: t, pretty: minus(group(t)) };
    }
    let e = Math.floor(Math.log10(Math.abs(x)));
    const sci = () => {
      let m = +(x / 10 ** e).toPrecision(sig);
      if (Math.abs(m) >= 10) { m /= 10; e++; }
      m = +m.toPrecision(sig);
      return { text: `${m}e${e}`, pretty: minus(`${m}×10${sup(e)}`) };
    };
    if (c.format === 'sci') return sci();
    if (c.format === 'eng') {
      let e3 = Math.floor(e / 3) * 3;
      let m = +(x / 10 ** e3).toPrecision(sig);
      if (Math.abs(m) >= 1000) { e3 += 3; m = +(m / 1000).toPrecision(sig); }
      if (!e3) return { text: String(m), pretty: minus(String(m)) };
      if (letter && SI[e3] !== undefined) return { text: `${m}e${e3}`, pretty: minus(`${m}${SI[e3]}`) };
      return { text: `${m}e${e3}`, pretty: minus(`${m}×10${sup(e3)}`) };
    }
    /* auto: whole numbers in full up to ten digits; otherwise plain for
       everyday sizes and scientific beyond */
    if (Number.isInteger(x) && e < 10) return { text: String(x), pretty: minus(group(String(x))) };
    if (e < -4 || e >= 6) return sci();
    const v = +x.toPrecision(sig);
    let t = String(v);
    if (/e/.test(t)) return sci();
    return { text: t, pretty: minus(group(t)) };
  }

  /* ── units ───────────────────────────────────────────────────────── */
  /* A result's unit is chosen the way a textbook would write it, which is
     not always math.js's choice: it calls kN·m "kJ" (a moment is not an
     energy, whatever the dimensions say), N/mm² "bar" (an engineer says
     MPa), and anything without a named unit falls back to base units
     ("6000 kg/s²" for 6 kN/m). In order:
       1. a conversion asked for ("to kJ") is left exactly as asked;
       2. a single unit as carried (mm⁴, km) is kept;
       3. force × length stays force·length;
       4. a named SI unit with the same dimension (N, Pa, W, V, Ω…);
       5. two units of different kinds as typed (km/h, kN/m, kg/m³);
       6. a familiar compound (m/s², N·s, J/(kg·K)…);
       7. whatever math.js simplifies it to.
     The first unit then takes the SI prefix that puts the number between
     1 and 1000 — 0.0012 A is 1.2 mA, 4700 Ω is 4.7 kΩ — from the prefixes
     that unit is actually written with (mm but not Mm; kg but not Mg). */
  const NAMED_UNITS = [
    ['N', 'N', ''], ['J', 'J', ''], ['W', 'W', ''], ['Pa', 'Pa', ''], ['V', 'V', ''], ['A', 'A', ''],
    ['ohm', 'ohm', ''], ['F', 'F', ''], ['H', 'H', ''], ['C', 'C', ''], ['Hz', 'Hz', ''], ['Wb', 'Wb', ''],
    ['T', 'T', ''], ['S', 'S', ''], ['m', 'm', ''], ['kg', 'g', 'k'], ['s', 's', ''], ['K', 'K', ''], ['mol', 'mol', '']
  ];
  const COMPOUND_UNITS = ['m^2', 'm^3', 'm^4', 'm/s', 'm/s^2', 'N/m', 'N s', 'N/m^3', 'kg/m^3', 'kg/s', 'm^3/s',
    'kg m^2', 'J/kg', 'J/K', 'J/(kg K)', 'W/m^2', 'W/(m K)', 'W/(m^2 K)', 'Pa s', 'V/m', 'A/m', 'C/m^2', 'ohm m', 'rad/s'];
  let NAMED = [], COMPOUND = [], FORCE, LENGTH, ENERGY;

  const PV = { '': 1, da: 1e1, h: 1e2, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
  const ENG = ['p', 'n', 'u', 'm', '', 'k', 'M', 'G', 'T'];
  const PREFIX_OK = {
    m: ['n', 'u', 'm', '', 'k'], g: ['m', '', 'k'], s: ['p', 'n', 'u', 'm', ''], Hz: ['', 'k', 'M', 'G'],
    L: ['m', ''], l: ['m', ''], bar: ['m', ''], mol: ['m', ''], rad: ['m', ''], K: [''], deg: [''], degC: [''], degF: [''],
    cd: [''], b: [''], B: [''], t: [''], tonne: ['']
  };
  const SHOW = { ohm: 'Ω', deg: '°', degC: '°C', degF: '°F' };

  const partsOf = units => units.map(u => ({ name: u.unit.name, prefix: u.prefix.name, power: u.power, base: u.unit.base.key, prefixes: u.unit.prefixes }));

  /** like units multiplied together: mm·mm³ → mm⁴, kN·m⁻¹·m → kN */
  function merge(parts) {
    const out = [];
    for (const p of parts) {
      const same = out.find(q => q.name === p.name);
      if (same) same.power += p.power; else out.push({ ...p });
    }
    return out.filter(p => Math.abs(p.power) > 1e-12);
  }

  function displayParts(u) {
    const carried = merge(partsOf(u.units));
    if (u.fixPrefix) return carried;
    const whole = carried.every(p => Number.isInteger(p.power));     // √(J/kg) is not how anyone writes m/s
    if (carried.length === 1 && whole) return carried;
    if (carried.length === 2 && u.equalBase(ENERGY)) {
      const f = carried.find(p => p.base === 'FORCE' && p.power === 1), l = carried.find(p => p.base === 'LENGTH' && p.power === 1);
      if (f && l) return [f, l];
    }
    const named = NAMED.find(n => u.equalBase(n.unit));
    if (named) {
      const src = named.unit.units[0];
      return [{ name: named.name, prefix: named.prefix, power: 1, base: src.unit.base.key, prefixes: src.unit.prefixes }];
    }
    if (whole && carried.length <= 2 && new Set(carried.map(p => p.base)).size === carried.length) return carried;
    const comp = COMPOUND.find(c => u.equalBase(c.unit));
    if (comp) return comp.parts.map(p => ({ ...p }));
    try { return merge(partsOf(u.simplify().units)); } catch (_) { return carried; }
  }

  const partText = p => p.prefix + p.name;
  function unitText(parts) {
    const num = parts.filter(p => p.power > 0), den = parts.filter(p => p.power < 0);
    const one = (p, pw) => partText(p) + (pw === 1 ? '' : '^' + pw);
    let s = num.map(p => one(p, p.power)).join(' ');
    if (den.length) {
      const d = den.map(p => one(p, -p.power)).join(' ');
      s = (s || '1') + ' / ' + (den.length > 1 ? `(${d})` : d);
    }
    return s;
  }
  function unitPretty(parts) {
    const show = p => (p.prefix === 'u' ? 'µ' : p.prefix) + (SHOW[p.name] || p.name);
    const pw = n => Number.isInteger(n) ? (n === 1 ? '' : sup(n)) : '^' + +n.toPrecision(3);
    const num = parts.filter(p => p.power > 0), den = parts.filter(p => p.power < 0);
    if (!num.length) return parts.map(p => show(p) + pw(p.power)).join('·');
    let s = num.map(p => show(p) + pw(p.power)).join('·');
    if (den.length) {
      const d = den.map(p => show(p) + pw(-p.power)).join('·');
      s += '/' + (den.length > 1 ? `(${d})` : d);
    }
    return s;
  }

  /** the prefix on the first unit that brings the number into 1…1000 */
  function reprefix(parts, val) {
    const p = parts[0];
    if (!p || Math.abs(p.power) !== 1 || !val || !isFinite(val)) return val;
    const list = PREFIX_OK[p.name] || (p.prefixes && p.prefixes.k && p.prefixes.m ? ENG : null);
    if (!list || !(p.prefix in PV)) return val;
    const baseVal = val * PV[p.prefix] ** p.power;
    let best = p.prefix, bestScore = Infinity;
    for (const pf of list) {
      const a = Math.abs(baseVal / PV[pf] ** p.power);
      const score = a >= 1 && a < 1000 ? 0 : a < 1 ? -Math.log10(a) : Math.log10(a / 999.9999);
      if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && pf === p.prefix)) { best = pf; bestScore = score; }
    }
    /* nothing brings it into range (1.6×10⁻¹⁹ C): leave the unit bare,
       or kg for a mass, and let the number carry the exponent */
    if (bestScore > 0) best = p.name === 'g' ? 'k' : list.includes('') ? '' : best;
    p.prefix = best;
    return baseVal / PV[best] ** p.power;
  }

  function fmtUnit(u, c) {
    if (u.value == null) {
      const parts = merge(partsOf(u.units));
      return { text: unitText(parts), pretty: unitPretty(parts) };
    }
    if (typeof u.value !== 'number') {
      const t = M.format(u, { precision: c.sig });
      return { text: t, pretty: t };
    }
    const parts = displayParts(u);
    let str = unitText(parts), val;
    try { val = u.toNumber(str); }
    catch (_) { const t = M.format(u, { precision: c.sig }); return { text: t, pretty: t }; }
    const before = parts[0] && parts[0].prefix;
    if (!u.fixPrefix && c.format !== 'sci') val = reprefix(parts, val);
    if (parts[0] && parts[0].prefix !== before) str = unitText(parts);
    const prefixed = parts[0] && Math.abs(parts[0].power) === 1 && (PREFIX_OK[parts[0].name] || ENG).length > 1;
    const n = fmtNum(val, c.format === 'eng' && prefixed ? { ...c, format: 'auto' } : c, false);
    const up = unitPretty(parts);
    const tight = parts.length === 1 && parts[0].name === 'deg' && parts[0].power === 1;
    return { text: `${n.text} ${str}`, pretty: n.pretty + (tight ? '' : ' ') + up };
  }

  /* ── complex numbers ────────────────────────────────────────────── */
  function fmtComplex(z, c, polarFirst) {
    const re = z.re, im = z.im;
    const tiny = v => Math.abs(v) <= 1e-12 * (Math.abs(re) + Math.abs(im));
    if (tiny(im)) return fmtNum(re, c);
    const rect = () => {
      const a = fmtNum(Math.abs(im), c);
      const coef = a.text === '1' ? '' : a.pretty;
      if (tiny(re)) return { text: `${im < 0 ? '-' : ''}${a.text}i`, pretty: `${im < 0 ? '−' : ''}${coef}i` };
      const r = fmtNum(re, c);
      return { text: `${r.text} ${im < 0 ? '-' : '+'} ${a.text}i`, pretty: `${r.pretty} ${im < 0 ? '−' : '+'} ${coef}i` };
    };
    const polar = () => {
      const r = Math.hypot(re, im), phi = Math.atan2(im, re);
      const deg = c.angle === 'deg';
      const ang = fmtNum(deg ? phi * 180 / Math.PI : phi, { ...c, exact: false, format: c.format === 'fixed' ? 'fixed' : 'auto' });
      const mag = fmtNum(r, { ...c, exact: false });
      return {
        text: `phasor(${mag.text}, ${ang.text}${deg ? ' deg' : ''})`,
        pretty: `${mag.pretty}∠${ang.pretty}${deg ? '°' : ' rad'}`
      };
    };
    const [p, q] = polarFirst ? [polar(), rect()] : [rect(), polar()];
    return { text: p.text, pretty: p.pretty, alt: q.pretty };
  }

  /* ── everything else ────────────────────────────────────────────── */
  function nodePretty(s) {
    return minus(s.replace(/\s*\^\s*/g, '^').replace(/\^\((-?\d+)\)/g, (m, n) => sup(n)).replace(/\^(\d+)\b/g, (m, n) => sup(n))
      .replace(/(^|[^\w.])(\d+(?:\.\d+)?) \* (?=[A-Za-z(])/g, '$1$2')      // 2 * x → 2x
      .replace(/\s\*\s/g, '·').replace(/ \/ /g, '/').replace(/\bpi\b/g, 'π').replace(/\bsqrt\(/g, '√('));
  }

  /**
   * Any value math.js can produce, as { text, pretty, alt?, rows? }.
   * hint.polar puts a complex number's polar form first.
   */
  function format(v, c = config, hint = {}) {
    c = { ...config, ...c };
    if (v === undefined || v === null) return { text: '', pretty: '' };
    if (typeof v === 'number') return fmtNum(v, c);
    if (typeof v === 'boolean') return { text: String(v), pretty: v ? 'true' : 'false' };
    if (typeof v === 'string') return { text: JSON.stringify(v), pretty: v };
    if (typeof v === 'function') {
      const d = v._def;
      const sig = v.syntax || 'function';
      return { text: sig, pretty: d ? nodePretty(`${sig} = ${d.expr.toString({ implicit: 'show' })}`) : sig };
    }
    if (v instanceof Roots) {
      const list = v.list.map(x => format(x, c).pretty);
      return {
        text: '[' + v.list.map(x => format(x, c).text).join(', ') + ']',
        pretty: `${v.name} = ${list.join(', ')}${v.note ? ' (' + v.note + ')' : ''}`
      };
    }
    if (v instanceof Fit) {
      const m = fmtNum(v.slope, c), b = fmtNum(Math.abs(v.intercept), c), r = fmtNum(v.r2, { ...c, exact: false, format: 'auto', sig: 4 });
      return {
        text: `${m.text} * x ${v.intercept < 0 ? '-' : '+'} ${b.text}`,
        pretty: `y = ${m.pretty}x ${v.intercept < 0 ? '−' : '+'} ${b.pretty}`, alt: `R² = ${r.pretty}`
      };
    }
    if (!M) return { text: String(v), pretty: String(v) };
    if (v.isUnit) return fmtUnit(v, c);
    if (v.isComplex) return fmtComplex(v, c, hint.polar);
    if (v.isBigNumber || v.isFraction) return fmtNum(Number(v), c);
    if (v.isNode) return { text: v.toString({ implicit: 'hide' }), pretty: nodePretty(v.toString({ implicit: 'show' })) };
    if (v.isResultSet) return format(v.entries[v.entries.length - 1], c, hint);
    if (v.isMatrix || Array.isArray(v)) {
      const a = v.isMatrix ? v.toArray() : v;
      const cell = x => format(x, c, hint);
      if (!a.length) return { text: '[]', pretty: '[ ]', rows: [] };
      if (!Array.isArray(a[0])) {
        const cells = a.map(cell);
        return { text: '[' + cells.map(x => x.text).join(', ') + ']', pretty: '[' + cells.map(x => x.pretty).join(', ') + ']', rows: [cells.map(x => x.pretty)] };
      }
      const rows = a.map(r => r.map(cell));
      return {
        text: '[' + rows.map(r => '[' + r.map(x => x.text).join(', ') + ']').join(', ') + ']',
        pretty: '[' + rows.map(r => r.map(x => x.pretty).join(', ')).join('; ') + ']',
        rows: rows.map(r => r.map(x => x.pretty))
      };
    }
    if (v.values && v.eigenvectors) {
      const vals = v.values.isMatrix ? v.values.toArray() : v.values;
      return {
        text: '[' + vals.map(x => format(x, c).text).join(', ') + ']',
        pretty: 'λ = ' + vals.map(x => format(x, c).pretty).join(', '),
        alt: v.eigenvectors.map((e, i) => `v${sup(i + 1).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, d => '₀₁₂₃₄₅₆₇₈₉'['⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(d)])} = ${format(e.vector, c).pretty}`).join('   ')
      };
    }
    try { const t = M.format(v, { precision: c.sig }); return { text: t, pretty: t }; }
    catch (_) { return { text: String(v), pretty: String(v) }; }
  }

  /* ── evaluating ──────────────────────────────────────────────────── */
  /* math.js's messages, said the way a person would */
  function friendly(err) {
    let m = String(err && err.message || err).replace(/^Error:\s*/, '');
    let k;
    if ((k = /^Undefined symbol (.+)$/.exec(m))) return `${k[1]} is not defined`;
    if ((k = /^Undefined function (.+)$/.exec(m))) return `There is no function called ${k[1]}`;
    if (/Unexpected end of expression/.test(m)) return 'The expression is not finished';
    if ((k = /Parenthesis \) expected/.exec(m))) return 'A closing ) is missing';
    if (/Units do not match|do not match|Cannot convert/.test(m)) return m.replace(/^Units do not match.*/, 'Those units do not match');
    if (/Value missing in assignment/.test(m)) return 'Nothing to assign after =';
    if (/Unexpected type of argument in function (add|subtract)/.test(m) && /Unit/.test(m)) return 'Cannot add a plain number to a quantity with units';
    m = m.replace(/\s*\(char \d+\)$/, '');
    return m;
  }

  const asScope = scope => {
    if (scope instanceof Scope) return scope;
    if (!scope) return new Scope();
    if (scope instanceof Map) return new Scope(BASE, scope);
    // a plain object: read from it, and write assignments back to it
    const s = new Scope(BASE, new Map(Object.entries(scope)));
    const set = s.set.bind(s);
    s.set = (k, v) => { scope[k] = v; return set(k, v); };
    return s;
  };

  /** "2x + 3 = 11" → solve it for x; null if it is not an equation with one unknown */
  function asEquation(src, scope) {
    const sides = splitTop(src, '=');
    if (sides.length !== 2 || /[<>!]$/.test(sides[0]) || !sides[1].trim() || !sides[0].trim()) return null;
    let lhs, rhs;
    try { lhs = M.parse(sides[0]); rhs = M.parse(sides[1]); } catch (_) { return null; }
    let free = [...new Set([...unknowns(lhs, scope), ...unknowns(rhs, scope)])];
    /* every symbol known: if exactly one of them is a variable you set
       (x from an earlier equation), the equation is about that one */
    if (!free.length) free = [...new Set([...mine(lhs, scope), ...mine(rhs, scope)])];
    if (free.length !== 1) return free.length > 1 ? { error: 'Too many unknowns to solve for: ' + free.join(', ') } : null;
    return { name: free[0], node: M.parse(`solve(${sides[0]} == ${sides[1]}, ${free[0]})`) };
  }

  function evaluate(src, scope, opts) {
    if (!M) {
      ready().catch(() => { });
      return { ok: false, pending: true, error: 'The maths engine is still loading', text: '', pretty: '' };
    }
    const c = { ...config, ...(opts || {}) };
    const was = config.angle;
    config.angle = c.angle;          // the angle mode is read by the scope's trig while it runs
    try { return run(src, asScope(scope), c); }
    finally { config.angle = was; }
  }

  function run(src, scope, c) {
    const raw = String(src == null ? '' : src).replace(/\s+(#|\/\/).*$/, '').trim();
    if (!raw || /^(#|\/\/)/.test(raw)) return { ok: true, empty: true, text: '', pretty: '' };
    const pre = preprocess(raw);
    const polar = /∠|\bpolar\s*\(/.test(raw);
    let node, eq = null;
    try { node = M.parse(pre); }
    catch (err) {
      if (!LONE_EQ.test(pre)) return fail(err);
      eq = asEquation(pre, scope);
      if (!eq) return fail(err);
      if (eq.error) return { ok: false, error: eq.error, text: '', pretty: '' };
      node = eq.node;
    }
    let value;
    try { value = node.compile().evaluate(scope); }
    catch (err) {
      /* "x = 2x - 4": an assignment that uses what it assigns is an equation */
      const u = /^Undefined symbol (.+)$/.exec(err && err.message);
      if (u && node.isAssignmentNode && node.name === u[1] && !eq) {
        eq = asEquation(pre, scope);
        if (eq && !eq.error) {
          try { node = eq.node; value = node.compile().evaluate(scope); }
          catch (e2) { return fail(e2); }
        } else return fail(err);
      } else return fail(err);
    }
    if (value && value.isResultSet) value = value.entries[value.entries.length - 1];

    let name = null;
    if (node.isAssignmentNode && node.object && node.object.isSymbolNode) name = node.object.name;
    else if (node.isAssignmentNode && node.name) name = node.name;
    if (node.isFunctionAssignmentNode) {
      name = node.name;
      const fn = scope.get(node.name);
      if (typeof fn === 'function') fn._def = { params: node.params, expr: node.expr };
    }
    const single = eq && (typeof value === 'number' || (value && value.isUnit));
    if (single) { scope.set(eq.name, value); name = eq.name; }
    if (value !== undefined && typeof value !== 'function') scope.set('ans', value);

    const out = format(value, c, { polar });
    let pretty = out.pretty;
    if (single) pretty = `${eq.name} = ${pretty}`;
    let tex;
    try {
      const left = node.toTex({ implicit: 'hide', parenthesis: 'auto' });
      const right = out.text && !/^\[|^phasor/.test(out.text) ? M.parse(out.text).toTex() : null;
      tex = right && right !== left ? `${left} = ${right}` : left;
    } catch (_) { tex = undefined; }
    return { ok: true, value, text: out.text, pretty, alt: out.alt, rows: out.rows, tex, name, kind: 'ok' };
  }

  function fail(err) {
    return { ok: false, error: friendly(err), text: '', pretty: '' };
  }

  /* ── a worksheet ─────────────────────────────────────────────────── */
  const LABEL = /^([A-Za-z][A-Za-z0-9 '_-]*):\s+(.+)$/;
  const TOTAL = /^(total|sum)$/i;

  function evaluateLines(text, opts) {
    const lines = String(text == null ? '' : text).split('\n');
    if (!M) return lines.map(() => ({ kind: 'empty', pending: true }));
    const scope = new Scope();
    const out = [];
    let run = [];              // values since the last blank line, for "total"
    let prev;
    for (const line of lines) {
      const t = line.trim();
      if (!t) { out.push({ kind: 'empty' }); run = []; continue; }
      if (/^(#|\/\/)/.test(t)) { out.push({ kind: 'comment' }); run = []; continue; }
      if (TOTAL.test(t)) {
        let sum = null, error = null;
        try { for (const v of run) sum = sum === null ? v : M.add(sum, v); }
        catch (err) { error = friendly(err); }
        if (error || sum === null) { out.push({ kind: 'err', ok: false, error: error || 'Nothing above to add up' }); continue; }
        const f = format(sum, { ...config, ...(opts || {}) });
        out.push({ kind: 'ok', ok: true, value: sum, text: f.text, pretty: f.pretty });
        scope.set('ans', sum); prev = sum;
        continue;
      }
      const m = LABEL.exec(t);
      const expr = m ? m[2] : t;
      if (prev !== undefined) scope.set('ans', prev);
      const r = evaluate(expr, scope, opts);
      if (r.empty) { out.push({ kind: 'empty' }); continue; }
      if (!r.ok) { out.push({ ...r, kind: 'err' }); continue; }
      out.push({ ...r, kind: 'ok' });
      prev = r.value;
      const v = r.value;
      if (typeof v === 'number' || (v && (v.isUnit || v.isComplex))) run.push(v);
    }
    return out;
  }

  /* ── usage notes, for the keypad and the line being typed ──────── */
  const HINTS = {
    diff: 'diff(f, x) the derivative · diff(f, x = 2) its value at 2 · diff(f, x, 2) the second',
    int: 'int(f, x, a, b) — the integral of f from x = a to b (inf for ∞)',
    integral: 'integral(f, x, a, b) — the integral of f from x = a to b',
    lim: 'lim(f, x = a) — the limit of f as x → a (inf for ∞)',
    solve: 'solve(f = g, x) — every x in −1000…1000 · solve(f = g, x, a, b) in a…b',
    roots: 'roots(p) — every root of a polynomial in x, complex ones too',
    taylor: 'taylor(f, x, a, n) — the series of f about x = a, up to xⁿ',
    phasor: 'phasor(r, θ) — r∠θ, θ in the angle mode (or 30 deg)',
    linreg: 'linreg(xs, ys) — the straight line through the points, and R²',
    lusolve: 'A \\ b, or lusolve(A, b) — solves A x = b',
    linsolve: 'linsolve(A, b) — solves A x = b',
    det: 'det(A) — the determinant', inv: 'inv(A) — the inverse', transpose: "transpose(A), or A'",
    eigs: 'eigs(A) — eigenvalues and eigenvectors', dot: 'dot(a, b)', cross: 'cross(a, b) — 3-vectors',
    norm: 'norm(v) — the length of a vector', identity: 'identity(n) — the n×n identity',
    zeros: 'zeros(m, n)', trace: 'trace(A)', rank: 'rank(A)',
    nthRoot: 'nthRoot(x, n) — the nth root', log: 'log(x) is ln · log(x, b) in base b', log10: 'log10(x)',
    combinations: 'combinations(n, k) — n choose k', permutations: 'permutations(n, k)',
    round: 'round(x, n) — to n decimal places', mod: 'mod(a, b) — the remainder',
    atan2: 'atan2(y, x) — the angle of the point (x, y)',
    mean: 'mean(a, b, …) or mean([…])', std: 'std([…]) — sample standard deviation', median: 'median([…])',
    sum: 'sum([…])', max: 'max(a, b, …)', min: 'min(a, b, …)',
    to: 'value to unit — 3 in to mm'
  };

  D.math = {
    get loaded() { return !!M; },
    get lib() { return M; },
    config,
    constants: CONSTANTS,
    ready,
    evaluate,
    evaluateLines,
    format: (v, opts) => format(v, { ...config, ...(opts || {}) }),
    formatNumber: (x, opts) => fmtNum(x, { ...config, ...(opts || {}) }),
    scope: () => new Scope(),
    hint: name => HINTS[name] || null,
    preprocess,
    /* the numerical methods on their own, for tests and for anything that
       has a JavaScript function rather than an expression */
    numeric: { integrate, rootsIn, limit, polyRoots }
  };
})(window.DPO);

/* The maths engine (js/math.js): what an engineering student types, and
   what comes back. Results are asserted on their `pretty` form — the one
   a person reads — and, where the number matters to more figures than
   that shows, on the value itself. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { load } from './harness.mjs';

/* The vendored library, run in the realm the way the <script> that
   D.math.ready() injects would run it.

   The harness hands its realm the host's Object, Array, Map and the rest,
   which the app's own files never notice. math.js does: it recognises a
   plain object by `x.constructor === Object`, and an object literal is
   always made by the realm's own Object, so with the host's in its place
   every options object it is given — its own included — fails the test.
   In a page there is one realm and nothing to notice, so before the
   library runs the realm gets its own built-ins back. */
const LIB = readFileSync(new URL('../vendor/mathjs/math.min.js', import.meta.url), 'utf8');
const HOST = ['Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'Map', 'Set', 'RegExp', 'JSON', 'Math', 'Date',
  'Float32Array', 'Uint8Array', 'Uint8ClampedArray', 'Int32Array'];
const mathjs = g => { for (const k of HOST) delete g[k]; vm.runInContext(LIB, g, { filename: 'math.min.js' }); };
async function withMath(...more) {
  const X = load('util.js', mathjs, 'math.js', ...more);
  await X.math.ready();
  return X;
}

const D = await withMath();
const M = D.math;
const ev = (src, scope, opts) => M.evaluate(src, scope, opts);
const pretty = (src, opts) => { const r = ev(src, null, opts); assert.ok(r.ok, `${src}: ${r.error}`); return r.pretty; };
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * (1 + Math.abs(b)), `${a} ≉ ${b}`);
const plain = v => JSON.parse(JSON.stringify(v));

test('the app boots without the library: evaluate says it is loading and never throws', async () => {
  const bare = load('util.js', 'math.js');
  assert.equal(bare.math.loaded, false);
  const r = bare.math.evaluate('1 + 1');
  assert.equal(r.ok, false);
  assert.equal(r.pending, true);
  const lines = bare.math.evaluateLines('a = 1\na + 1');
  assert.equal(lines.length, 2, 'one placeholder per line');
});

test('units come out the way a textbook writes them', () => {
  assert.equal(pretty('2 kN * 3 m'), '6 kN·m', 'a moment, not an energy');
  assert.equal(pretty('5 kN * 2 m to kJ'), '10 kJ', 'unless an energy is asked for');
  assert.equal(pretty('3 in to mm'), '76.2 mm');
  assert.equal(pretty('10 kN / (20 mm * 50 mm)'), '10 MPa', 'stress in MPa, not bar');
  assert.equal(pretty('1 N/mm^2'), '1 MPa');
  assert.equal(pretty('2 kN*3 m/(1 m^2)'), '6 kN/m', 'not 6000 kg/s²');
  assert.equal(pretty('75 kg * g'), '735.5 N');
  assert.equal(pretty('230 V * 10 A'), '2.3 kW');
  assert.equal(pretty('100 km/h'), '100 km/h', 'what was typed, when it is already tidy');
  assert.equal(pretty('2 kN/m * 3 m'), '6 kN', 'lengths cancel');
  assert.equal(pretty('100 mm * (200 mm)^3 / 12'), '6.6667×10⁷ mm⁴', 'second moment of area stays in mm⁴');
  assert.equal(pretty('20 °C to °F'), '68 °F');
});

test('SI prefixes put the number between 1 and 1000', () => {
  assert.equal(pretty('1.2e-3 A'), '1.2 mA');
  assert.equal(pretty('4700 Ω'), '4.7 kΩ');
  assert.equal(pretty('10 V / 4.7 kΩ'), '2.1277 mA');
  assert.equal(pretty('1/(2 pi * 50 Hz * 10 µF)'), '318.31 Ω', 'µ and Ω as typed on the keypad');
  assert.equal(pretty('0.05 m'), '50 mm');
  assert.equal(pretty('qe'), '1.6022×10⁻¹⁹ C', 'no prefix gets this into range: the unit is left bare');
  assert.equal(pretty('1500 kg'), '1500 kg', 'kilograms do not become megagrams');
});

test('schematic shorthand: 4.7k, 10M, 100n, without touching units', () => {
  close(ev('4.7k').value, 4700);
  close(ev('sqrt(2)*4.7k').value, Math.SQRT2 * 4700);
  close(ev('1/(2*pi*10k*100n)').value, 1 / (2 * Math.PI * 1e4 * 1e-7));
  close(ev('22p + 10M').value, 22e-12 + 1e7);
  assert.equal(pretty('5m'), '5 m');                 // metres, not milli
  assert.equal(pretty('2 kN * 3 m'), '6 kN·m');
  assert.equal(pretty('k2 = 3'), '3');               // an identifier is not a number
});

test('number formats: auto, engineering, scientific, fixed and exact', () => {
  assert.equal(pretty('4700'), '4700');
  assert.equal(pretty('123456789'), '123\u2009456\u2009789', 'whole numbers in full, grouped with thin spaces');
  assert.equal(pretty('0.000012345'), '1.2345×10⁻⁵');
  assert.equal(pretty('1/3'), '0.33333');
  assert.equal(pretty('4700', { format: 'eng' }), '4.7k');
  assert.equal(pretty('0.0047', { format: 'eng' }), '4.7m');
  assert.equal(pretty('0.0012 A', { format: 'eng' }), '1.2 mA', 'the prefix goes on the unit');
  assert.equal(pretty('123456', { format: 'sci', sig: 3 }), '1.23×10⁵');
  assert.equal(pretty('2/3', { format: 'fixed', sig: 3 }), '0.667');
  assert.equal(pretty('1/3', { exact: true }), '1/3');
  assert.equal(pretty('3 pi / 4', { exact: true }), '3π/4');
  assert.equal(pretty('sqrt(3)/2', { exact: true }), '√3/2');
  assert.equal(pretty('0.1 + 0.2', { exact: true }), '3/10');
  assert.equal(pretty('-2.5'), '−2.5', 'a real minus sign');
  const n = M.formatNumber(1234.5678, { sig: 6 });
  assert.equal(n.text, '1234.57');
});

test('degrees and radians', () => {
  assert.equal(pretty('sin(30)', { angle: 'deg' }), '0.5');
  assert.equal(pretty('cos(90)', { angle: 'deg' }), '0', 'exactly, not 6e-17');
  assert.equal(pretty('tan(45)', { angle: 'deg' }), '1');
  assert.equal(pretty('asin(0.5)', { angle: 'deg' }), '30');
  assert.equal(pretty('sin(pi/6)', { angle: 'rad' }), '0.5');
  assert.equal(pretty('sin(pi)', { angle: 'rad' }), '0', 'chopped, as a calculator would');
  assert.equal(pretty('sin(90 deg)', { angle: 'rad' }), '1', 'an explicit unit wins over the mode');
  assert.equal(M.config.angle, 'deg', 'a per-call mode does not stick');
});

test('complex numbers and phasors for AC circuits', () => {
  const r = ev('10∠30°', null, { angle: 'deg' });
  assert.equal(r.pretty, '10∠30°', 'a phasor is shown as one');
  assert.equal(r.alt, '8.6603 + 5i', 'with its rectangular form alongside');
  assert.equal(ev('10∠30° + 5∠-45°', null, { angle: 'deg' }).pretty, '12.283∠6.8473°');
  const z = ev('(3 + 4i)');
  assert.equal(z.pretty, '3 + 4i');
  assert.equal(z.alt, '5∠53.13°');
  assert.equal(pretty('sqrt(-4)'), '2i');
  const zl = ev('Z = 50 Ω + 2 pi * 50 * 0.1 i * 1 Ω');
  assert.ok(zl.ok, zl.error);
});

test('matrices and vectors', () => {
  assert.equal(pretty('det([1,2;3,4])'), '−2');
  const inv = ev('inv([1,2;3,4])');
  assert.equal(inv.pretty, '[−2, 1; 1.5, −0.5]');
  assert.deepEqual(plain(inv.rows), [['−2', '1'], ['1.5', '−0.5']], 'rows for a grid');
  assert.equal(pretty('[2,1;1,3] \\ [3;5]'), '[0.8; 1.4]', 'A \\ b solves the system');
  const s = M.scope();
  ev('A = [4, -2; 1, 1]', s); ev('b = [2; 3]', s);
  assert.equal(ev('x = A \\ b', s).pretty, '[1.3333; 1.6667]');
  assert.equal(pretty('cross([1,0,0],[0,1,0])'), '[0, 0, 1]');
  assert.equal(pretty('dot([1,2,3],[4,5,6])'), '32');
  assert.equal(pretty('norm([3,4])'), '5');
  assert.equal(pretty('eigs([2,1;1,2])'), 'λ = 1, 3');
  assert.equal(pretty("[1,2;3,4]ᵀ"), '[1, 3; 2, 4]');
});

test('derivatives, symbolic and at a point', () => {
  assert.equal(pretty('d/dx(x^2 sin(x))'), '2x·sin(x) + x²·cos(x)');
  assert.equal(pretty('diff(x^4, x, 2)'), '12x²');
  assert.equal(pretty('diff(x^3, x = 2)'), '12');
  close(ev('diff(sin(x), x = 1)', null, { angle: 'deg' }).value, Math.cos(1), 1e-12);
  const s = M.scope();
  ev('f(x) = x^2 + 3x', s);
  assert.equal(ev('diff(f(x), x)', s).pretty, '2x + 3', 'through a function you defined');
  assert.equal(pretty('taylor(sin(x), x, 0, 7)'), 'x − x³/6 + x⁵/120 − x⁷/5040');
});

test('integrals and limits, numerically', () => {
  close(ev('int(x^2, x, 0, 3)').value, 9);
  close(ev('int(exp(-x^2), x, -inf, inf)').value, Math.sqrt(Math.PI));
  close(ev('int(1/sqrt(x), x, 0, 1)').value, 2, 1e-7);
  close(ev('∫(sin(x), x, 0, pi)').value, 2, 1e-12);
  // a beam's deflection integral, with variables from the scope
  const s = M.scope();
  ev('L = 4', s); ev('w = 3', s);
  close(ev('int(w * x * (L - x) / 2, x, 0, L)', s).value, 3 * 64 / 12);
  close(ev('lim(sin(x)/x, x = 0)').value, 1, 1e-9);
  close(ev('lim((1 + 1/n)^n, n = inf)').value, Math.E, 1e-6);
  const r = ev('lim(1/x, x = 0)');
  assert.equal(r.ok, false);
  assert.match(r.error, /differs from each side/);
});

test('solving: equations, ranges, polynomials', () => {
  assert.equal(pretty('solve(x^2 = 4, x)'), 'x = −2, 2');
  const s = M.scope();
  const r = ev('2x + 3 = 11', s);
  assert.equal(r.pretty, 'x = 4', 'an equation with one unknown is solved for it');
  assert.equal(ev('x * 10', s).pretty, '40', 'and the answer is kept');
  const again = ev('x^3 - 2x - 5 = 0', s);
  assert.equal(again.pretty, 'x = 2.0946', 'x is known now, but the equation is still about x');
  close(again.value, 2.0945514815423265);
  assert.equal(pretty('solve(sin(x) = 0.5, x, 0, 180)', { angle: 'deg' }), 'x = 30, 150');
  assert.equal(pretty('solve((x - 1)^2, x)'), '1', 'a double root, which never changes sign');
  assert.equal(pretty('roots(x^3 - 6x^2 + 11x - 6)'), 'x = 1, 2, 3');
  assert.equal(pretty('roots(x^2 + 1)'), 'x = −i, i');
  assert.equal(pretty('solve(2 kN * d = 6 kN m, d)'), '3 m', 'the unknown takes the unit the equation needs');
  assert.equal(pretty('40 kN/m * x = 2 kN'), 'x = 50 mm', "Hooke's law, in tidy units");
  assert.equal(pretty('0.5 * 2 kg * v^2 = 9 J'), 'v = −3 m/s, 3 m/s', 'and through a square');
  const none = ev('solve(x^2 + 1 = 0, x)');
  assert.equal(none.ok, false);
  assert.match(none.error, /No real x/);
});

test('statistics and constants', () => {
  assert.equal(pretty('mean([1,2,3,4])'), '2.5');
  assert.equal(pretty('std([1,2,3,4])'), '1.291');
  const fit = ev('linreg([1,2,3,4],[2.1,3.9,6.2,7.8])');
  assert.equal(fit.pretty, 'y = 1.94x + 0.15');
  assert.equal(fit.alt, 'R² = 0.9957');
  assert.equal(pretty('g'), '9.8066 m/s²');
  assert.equal(pretty('ε0'), '8.8542 pF/m');
  assert.equal(pretty('μ0'), '1.2566 µH/m', 'μ0 alone is the constant, µF is a microfarad');
  assert.equal(pretty('c'), '299\u2009792\u2009458 m/s', 'exact, so in full');
  const s = M.scope();
  ev('g = 9.81', s);
  assert.equal(ev('g', s).pretty, '9.81', 'a variable you set shadows a constant');
  assert.equal(ev('g').pretty, '9.8066 m/s²', 'only in that scope');
});

test('variables, ans and the friendly errors', () => {
  const s = M.scope();
  assert.equal(ev('F = 2 kN', s).name, 'F');
  ev('L = 3 m', s);
  const m = ev('M = F * L', s);
  assert.equal(m.pretty, '6 kN·m');
  assert.equal(m.name, 'M');
  assert.equal(ev('ans / 2', s).pretty, '3 kN·m', 'ans is the last answer');
  assert.deepEqual(plain(s.own().sort()), ['F', 'L', 'M', 'ans']);
  const child = s.child();
  ev('F = 10 kN', child);
  assert.equal(ev('F', s).pretty, '2 kN', 'a child scope (a preview) assigns nothing upstairs');
  assert.equal(ev('y + 1', s).error, 'y is not defined');
  assert.equal(ev('3 +', s).error, 'The expression is not finished');
  assert.equal(ev('2 kN + 3 m', s).ok, false);
  assert.equal(ev('', s).empty, true);
  assert.equal(ev('# a note', s).empty, true);
  const obj = {};
  ev('q = 5', obj);
  assert.equal(obj.q, 5, 'a plain object for a scope gets the assignments');
});

test('TeX for the expression and its answer', () => {
  assert.equal(ev('2 kN * 3 m').tex, '2~\\mathrm{kN}\\cdot3~\\mathrm{m} = 6~\\mathrm{kN}~\\mathrm{m}');
  assert.match(ev('d/dx(x^2)').tex, /frac|x/);
});

test('a worksheet: variables flow down the lines', () => {
  const out = M.evaluateLines([
    'F = 2 kN', 'L = 3 m', 'M = F*L', '', '# loads', 'Moment: M * 2', 'oops +', '5 kN', '6 kN', 'total'
  ].join('\n'));
  const got = out.map(r => [r.kind, r.pretty || r.error || '']);
  assert.deepEqual(plain(got), [
    ['ok', '2 kN'], ['ok', '3 m'], ['ok', '6 kN·m'], ['empty', ''], ['comment', ''],
    ['ok', '12 kN·m'], ['err', 'The expression is not finished'], ['ok', '5 kN'], ['ok', '6 kN'],
    ['err', 'Those units do not match']
  ]);
  assert.equal(M.evaluateLines('2 kN\n3\ntotal')[2].error, 'Cannot add a plain number to a quantity with units');
  const sums = M.evaluateLines('a = 2\nb = 3\n\n4\n5\ntotal\nans * 2');
  assert.deepEqual(plain(sums.map(r => r.pretty || '')), ['2', '3', '', '4', '5', '9', '18'], 'total adds up since the blank line; ans is the line above');
  const scoped = M.evaluateLines('x = 4\ny = x^2');
  assert.equal(scoped[1].pretty, '16');
  assert.equal(M.evaluateLines('y')[0].kind, 'err', 'each worksheet has a scope of its own');
});

test('the numerical methods stand on their own', () => {
  const { integrate, rootsIn, polyRoots } = M.numeric;
  close(integrate(x => 1 / (1 + x * x), 0, Infinity), Math.PI / 2, 1e-9);
  const roots = rootsIn(x => Math.cos(x), 0, 10);
  assert.equal(roots.length, 3);
  close(roots[0], Math.PI / 2);
  const tanRoots = rootsIn(x => Math.tan(x), 1, 5);
  assert.equal(tanRoots.length, 1, 'the pole at π/2 is a sign change, not a root');
  close(tanRoots[0], Math.PI);
  assert.deepEqual(plain(polyRoots([-6, 11, -6, 1])), [1, 2, 3]);
});

test('preprocess: only what math.js cannot read is touched', () => {
  const p = M.preprocess;
  assert.equal(p('2×3÷4−1'), '2*3/4-1');
  assert.equal(p('√2 + √(x+1)'), 'sqrt(2) + sqrt(x+1)');
  assert.equal(p('x² + x³'), 'x^(2) + x^(3)');
  assert.equal(p('5 µF'), '5 uF');
  assert.equal(p('μ0'), 'μ0');
  assert.equal(p('10∠30°'), 'phasor(10, 30 deg)');
  assert.equal(p('d/dx(x^2)'), 'diff(x^2, x)');
  assert.equal(p('solve(x^2 = 4, x)'), 'solve(x^2 == 4, x)');
  assert.equal(p('x = A \\ b'), 'x = lusolve(A, b)');
  assert.equal(M.hint('int'), 'int(f, x, a, b) — the integral of f from x = a to b (inf for ∞)');
});

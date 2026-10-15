/* Typeset maths (js/tex.js): which dollars are maths, how a line of words
   and maths is laid out, and LaTeX out of calc blocks and answers. The
   typesetter itself (MathJax) runs in the browser; here a stand-in gives
   every piece of maths a known size. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { load, fakeApp } from './harness.mjs';

// math.js for toTex, in the realm, as test/calc.test.mjs loads it
const LIB = readFileSync(new URL('../vendor/mathjs/math.min.js', import.meta.url), 'utf8');
const HOST = ['Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'Map', 'Set', 'RegExp', 'JSON', 'Math', 'Date', 'Float32Array', 'Uint8Array', 'Uint8ClampedArray', 'Int32Array'];
const mathjs = g => { for (const k of HOST) delete g[k]; vm.runInContext(LIB, g, { filename: 'math.min.js' }); };
const D = load('util.js', mathjs, 'tex.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js',
  'math.js', 'calc.js', 'inkmath.js', 'graph.js');
const T = D.tex;
const plain = o => JSON.parse(JSON.stringify(o));

/* each piece of maths 6ex wide and 2ex tall, 0.5ex below the line */
function standIn() {
  T._reset();
  T.engine = {
    tex2svg: (tex) => {
      const svg = {
        outerHTML: `<svg width="6ex" height="2ex" style="vertical-align: -0.5ex" viewBox="0 0 10 10"><path fill="currentColor" d="M0 0h10v10z"/></svg>`,
        getAttribute: k => ({ width: '6ex', height: '2ex', style: 'vertical-align: -0.5ex' })[k],
        querySelector: () => tex.includes('\\bad') ? {} : null
      };
      return { querySelector: () => svg };
    }
  };
}

test('which dollars are maths', () => {
  const kinds = s => plain(T.split(s)).map(p => p.tex != null ? (p.display ? 'D:' : 'M:') + p.tex : 'T:' + p.s);
  assert.deepEqual(kinds('Stress is $\\sigma = F/A$ here'), ['T:Stress is ', 'M:\\sigma = F/A', 'T: here']);
  assert.deepEqual(kinds('$$x^2$$'), ['D:x^2']);
  assert.deepEqual(kinds('costs $5 and $10'), ['T:costs $5 and $10'], 'money stays money');
  assert.deepEqual(kinds('a \\$ sign'), ['T:a $ sign']);
  assert.deepEqual(kinds('$ x$ no'), ['T:$ x$ no'], 'a space after the opening $ is not maths');
  assert.equal(T.has('no maths'), false);
  assert.equal(T.has('$5'), false);
  assert.equal(T.has('$x$'), true);
});

test('a line of words and maths: the maths takes its own size, and the line grows to fit', () => {
  standIn();
  const measure = s => s.length * 10;
  const R = T.layout('Area $\\pi r^2$ of a disc', 20, 1000, false, measure, 27, 20);
  assert.equal(R.lines.length, 1);
  const runs = plain(R.lines[0].runs);
  assert.equal(runs[0].s, 'Area');
  assert.equal(runs[1].tex, '\\pi r^2');
  assert.equal(runs[1].w, 60, '6ex at 20px is 60px');
  assert.equal(runs[1].x, 40 + 10, 'after the word and a space');
  assert.equal(runs[2].s, 'of a disc');
  assert.equal(runs[2].x, 40 + 10 + 60 + 10);
  // 2ex tall, 0.5ex below: 15 above the baseline, 5 below — inside a 27px line, so it stays 27
  assert.equal(R.lines[0].h, 27);
  const tall = T.layout('$\\frac{a}{b}$', 60, 1000, false, measure, 27, 20);
  assert.ok(tall.lines[0].h > 27, 'a big piece of maths makes its line taller');
});

test('before the typesetter has done a piece, it is laid out as its source, and asks for it', () => {
  T._reset(); T.engine = null;
  const R = T.layout('Hi $x$', 20, 1000, false, s => s.length * 10, 27, 20);
  assert.deepEqual(plain(R.lines[0].runs.map(r => r.s)), ['Hi $x$']);
  standIn();
});

test('maths too wide for the box wraps to the next line as a whole', () => {
  standIn();
  const R = T.layout('one two $a$ $b$', 20, 100, false, s => s.length * 10, 27, 20);
  assert.ok(R.lines.length >= 2);
  for (const ln of R.lines) for (const r of ln.runs) assert.ok(r.x + r.w <= 100 || ln.runs.length === 1);
});

test('a text box with maths lays out, draws and exports through the core', async () => {
  standIn();
  const app = fakeApp(D, { requestDraw() {} });
  const it = D.make.text({ x: 0, y: 0, w: 400, text: 'Stress $\\sigma = F/A$', size: 20 });
  app.scene.add(it);
  const L = app.scene.layout(it);
  assert.ok(L.rich, 'laid out as words and maths');
  assert.equal(plain(L.lines).join(''), 'Stress $\\sigma = F/A$', 'the source, line by line');
  const r = new D.Renderer(app);
  const svg = await r.toSVG(app.scene, app.scene.bbox(it), 'light');
  assert.match(svg, /<text[^>]*>Stress<\/text>/);
  assert.match(svg, /<svg x="[\d.]+" y="[\d.-]+" width="60"/, 'the maths as its own SVG, placed and sized');
});

test('LaTeX out of a calc block, a handwritten answer and a graph', async () => {
  const calc = { type: 'calc', text: 'F = 2 kN\nL = 3 m\nM = F*L', res: [{ t: '2 kN' }, { t: '3 m' }, { t: '6 kN·m' }] };
  const tex = await T.latexOf(calc);
  assert.match(tex, /^\\begin\{aligned\}/);
  // F and L are the block's variables, not farads and litres; \cdot L stays valid TeX
  assert.ok(tex.includes(String.raw`M &= F\cdot L = 6~\mathrm{kN}\cdot\mathrm{m}`), tex);
  // metres stay a unit, and a value that is set is not said twice
  assert.ok(tex.includes(String.raw`L &= 3~\mathrm{m} \\`), tex);
  assert.equal(await T.latexOf({ type: 'inkresult', expr: '3x^2+2', text: '14' }), '3~{x}^{2}+2 = 14');
  assert.match(await T.latexOf({ type: 'graph', fns: ['sin(x)', 'x^2'] }), /^y = \\sin\\left\(x\\right\),\\quad y = \{x\}\^\{2\}$/);
});

test('$$…$$ may run over several lines, and is set as one piece', () => {
  standIn();
  const R = T.layout('Working:\n$$\begin{aligned}\na &= 1 \\\nb &= 2\n\end{aligned}$$\ndone', 20, 1000, false, s => s.length * 10, 27, 20);
  const kinds = R.lines.map(l => l.runs.map(r => r.tex != null ? 'M' : 'T:' + r.s).join(','));
  assert.deepEqual([...kinds], ['T:Working:', 'M', 'T:done']);
});

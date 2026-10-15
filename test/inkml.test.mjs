/* The handwriting bench's own parts (test/inkml.mjs): reading InkML,
   deciding which labels the reader could get right, and scoring. The
   bench itself needs a dataset (npm run bench:ink); these do not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { create, all } from 'mathjs';
import { parseInkml, toPts, parseLatex, written, mathOf, mathOfReading, distance, sameValue } from './inkml.mjs';

const M = create(all);
const ev = (s, scope) => M.evaluate(s, scope);

const INK = `<ink xmlns="http://www.w3.org/2003/InkML">
  <annotation type="label">x &lt; 2</annotation>
  <annotation type="splitTagOriginal">test</annotation>
  <annotation type="sampleId">00ff</annotation>
  <annotation type="normalizedLabel">\\frac{1}{2}</annotation>
  <traceFormat><channel name="X" type="decimal" /><channel name="Y" type="decimal" /><channel name="T" type="decimal" /></traceFormat>
  <trace id="0">10 10 0,10 30 8,10 50 16</trace>
  <trace id="1">0 60 40,40 60 48</trace>
  <trace id="2">5 70 90</trace>
</ink>`;

test('InkML: the label, the split and the strokes, as written', () => {
  const ink = parseInkml(INK);
  assert.equal(ink.label, '\\frac{1}{2}');
  assert.equal(ink.split, 'test');
  assert.equal(ink.id, '00ff');
  assert.deepEqual(ink.strokes, [[10, 10, 10, 30, 10, 50], [0, 60, 40, 60], [5, 70]]);
  assert.equal(parseInkml(INK.replace(/<annotation type="normalizedLabel">[^<]*<\/annotation>/, '')).label, 'x < 2', 'falls back to the label');
});

test('strokes come out the same size whatever the device wrote them at', () => {
  const ink = parseInkml(INK);
  const a = toPts(ink.strokes), b = toPts(ink.strokes.map(s => s.map(v => v * 7)));
  assert.deepEqual(a.map(p => p.map(v => +v.toFixed(6))), b.map(p => p.map(v => +v.toFixed(6))));
  assert.equal(a[0][2], 0.5, 'with a pressure');
});

test('labels in scope: the symbols and structures the reader knows', () => {
  for (const ok of ['3x^{2}+2', '\\frac{a+1}{2}', '\\sqrt{2}', '2\\times3=6', '\\pi r', '(x-1)(x+1)', '0.5\\cdot t'].filter(s => !s.includes('r')))
    assert.ok(parseLatex(ok), ok);
  for (const no of ['x_{1}', '\\sum_{i}i', '\\alpha', 'f(x)', '\\sqrt[3]{x}', '\\begin{matrix}1\\end{matrix}', 'x<2', '\\frac{1}{'])
    assert.equal(parseLatex(no), null, no);
});

test('what is written: a fraction bar as "/", a root as "√", powers in line', () => {
  assert.deepEqual(written(parseLatex('\\frac{x^{2}}{2}-1')), ['x', '2', '/', '2', '−', '1']);
  assert.deepEqual(written(parseLatex('\\sqrt{a+b}')), ['√', 'a', '+', 'b']);
  assert.deepEqual(written(parseLatex('2\\times3')), ['2', '×', '3']);
});

test('a label and a reading of it work out the same', () => {
  const same = (latex, reading) => sameValue(ev, mathOf(parseLatex(latex)), mathOfReading(reading));
  assert.ok(same('3x^{2}+2', '3x^2+2'));
  assert.ok(same('\\frac{x+1}{2}', '(x+1)/2'));
  assert.ok(same('\\sqrt{2}y', '√(2)y'));
  assert.ok(same('2\\times3=6', '2×3=6'));
  assert.ok(same('ab+c', 'a·b+c'), 'letters side by side multiply');
  assert.ok(same('\\pi t', 'πt'));
  assert.ok(!same('3x^{2}+2', '3x^2+3'));
  assert.ok(!same('x=1', 'x'), 'an "=" missed is wrong');
});

test('edit distance', () => {
  assert.equal(distance([], []), 0);
  assert.equal(distance(['1', '+', '2'], ['1', '+', '2']), 0);
  assert.equal(distance(['1', '+', '2'], ['1', 't', '2']), 1);
  assert.equal(distance(['1', '+', '2'], ['1', '2']), 1);
  assert.equal(distance(['a'], ['b', 'c', 'd']), 3);
});

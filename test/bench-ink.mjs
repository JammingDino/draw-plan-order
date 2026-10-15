/* ── bench-ink.mjs ── how well the handwritten-maths reader reads ────────
   npm run bench:ink -- <folder of .inkml>  [--limit N] [--json file] [--show N]

   Runs js/inkmath.js's reader over a set of real handwriting and says how
   often it is right. Point it at a folder of InkML files — Google's
   MathWriting (github.com/google-research/google-research/tree/master/
   mathwriting; its `test/` or `valid/` folder) or CROHME's — or a folder
   holding several. The data is not in this repository: MathWriting is
   CC BY-NC-SA, and either set is far too big. Download it somewhere and
   pass the path, or set INKML_DIR.

   Only expressions the reader could get right count (see inkml.mjs):
   written with the symbols it knows, in the structures it reads. The bench
   says how many of the set that is. For those:

     symbols   how many of the written symbols it read right: 1 − the edit
               distance between what was written and what it read, over
               the length of what was written (symbol error rate, inverted)
     all       expressions with every symbol right
     value     of the expressions that work out to a number at all,
               those whose reading works out to the same one (letters
               fixed): what the answer beside an "=" depends on
     trusted   how many it was sure enough of to answer (reading.ok), and
               how many of those were right (by value where there is one,
               else every symbol) — a wrong answer it was sure of is the
               worst outcome
     confused  the symbols most often read as something else

   Ink is read exactly as the app reads it, with no personal templates
   (those live in a browser's storage), so it measures the reader before
   anyone has taught it their hand.                                       */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from './harness.mjs';
import { parseInkml, toPts, parseLatex, written, mathOf, mathOfReading, readSymbols, distance, sameValue } from './inkml.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const dir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || process.env.INKML_DIR;
if (!dir) { console.error('usage: npm run bench:ink -- <folder of .inkml> [--limit N] [--json file] [--show N]'); process.exit(1); }
const LIMIT = +opt('limit', Infinity), SHOW = +opt('show', 0), JSON_OUT = opt('json', null);

function files(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (name.endsWith('.inkml')) out.push(p);
  }
  return out.sort();
}

const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js', 'tools.js', 'inkmath.js');
const { create, all: everything } = await import('mathjs');
const M = create(everything);
const ev = (s, scope) => M.evaluate(s, scope);
const IM = D.inkmath;
const VALUES = { x: 1.37, y: 0.61, z: 2.3, a: 1.9, b: 0.47, c: 3.1, n: 2, t: 0.83, theta: 0.7 };
const evaluates = s => s.split('=').every(side => {
  if (!side.trim()) return true;
  try { return isFinite(+ev(side, { ...VALUES })); } catch (_) { return false; }
});

const all = files(dir);
let seen = 0, scoped = 0, symTotal = 0, symErr = 0, allRight = 0, evaluable = 0, valueRight = 0, trusted = 0, trustedRight = 0, ms = 0;
const confused = new Map(), misses = [];
for (const f of all) {
  if (scoped >= LIMIT) break;
  const ink = parseInkml(readFileSync(f, 'utf8'));
  seen++;
  const tree = ink.label && parseLatex(ink.label);
  if (!tree || !ink.strokes.length) continue;
  const want = written(tree);
  if (!want.length) continue;
  scoped++;
  const strokes = toPts(ink.strokes).map((pts, k) => ({ id: 's' + k, type: 'stroke', pts, size: 3 }));
  const t0 = performance.now();
  const r = IM.read(strokes);
  ms += performance.now() - t0;
  const got = readSymbols(r);
  const d = distance(want, got);
  symTotal += want.length; symErr += Math.min(d, want.length);
  if (d === 0) allRight++;
  const text = r.text || '';
  /* "works out right" only means something for a label that works out:
     one like (++++) is scored on its symbols alone */
  const truth = mathOf(tree), worksOut = evaluates(truth);
  const value = worksOut && sameValue(ev, truth, mathOfReading(text));
  if (worksOut) { evaluable++; if (value) valueRight++; }
  const right = worksOut ? value : d === 0;
  if (r.ok) { trusted++; if (right) trustedRight++; }
  // which symbols went wrong, where the two line up one for one
  if (want.length === got.length) for (let k = 0; k < want.length; k++) if (want[k] !== got[k]) {
    const key = `${want[k]} → ${got[k]}`;
    confused.set(key, (confused.get(key) || 0) + 1);
  }
  if (!right && misses.length < SHOW) misses.push({ id: ink.id, label: ink.label, read: text, want: want.join(' '), got: got.join(' ') });
}

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
const top = [...confused].sort((a, b) => b[1] - a[1]).slice(0, 12);
const result = {
  folder: dir, files: seen, inScope: scoped,
  symbols: +(100 * (1 - symErr / (symTotal || 1))).toFixed(2),
  allSymbolsRight: +(100 * allRight / (scoped || 1)).toFixed(2),
  evaluable, sameValue: +(100 * valueRight / (evaluable || 1)).toFixed(2),
  trusted: +(100 * trusted / (scoped || 1)).toFixed(2),
  trustedRight: +(100 * trustedRight / (trusted || 1)).toFixed(2),
  msPerExpression: +(ms / (scoped || 1)).toFixed(2),
  confused: Object.fromEntries(top)
};
console.log(`\n${dir}`);
console.log(`  ${seen} inks, ${scoped} in scope (${pct(scoped, seen)}) — the rest use symbols or structures the reader does not read`);
console.log(`  symbols   ${result.symbols}% read right`);
console.log(`  all       ${pct(allRight, scoped)} of expressions with every symbol right`);
console.log(`  value     ${pct(valueRight, evaluable)} work out to the right value (of the ${evaluable} that work out at all)`);
console.log(`  trusted   ${pct(trusted, scoped)} answered; ${pct(trustedRight, trusted)} of those right`);
console.log(`  time      ${result.msPerExpression} ms an expression`);
if (top.length) console.log('  confused  ' + top.map(([k, n]) => `${k} ×${n}`).join(', '));
for (const m of misses) console.log(`  miss ${m.id}  ${m.label}\n       wrote ${m.want}\n       read  ${m.got}   (${m.read})`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));

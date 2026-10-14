/* Pen smoothing (freehand.js F.relax, F.liveAmount): a shaky slow line
   comes out steady, corners and ends stay where the pen put them, and
   Off leaves the stroke as it was. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const D = load('util.js', 'freehand.js');
const F = D.freehand;

/** a line along x, sampled every px, with a hand's tremor on it: a few px
    of wobble every 6–14 px, as 4–12 Hz shows at a slow writing speed */
function shaky(len = 300, amp = 2.5, wave = 14) {
  const o = [];
  for (let x = 0; x <= len; x++) o.push(x, 100 + amp * Math.sin(x / wave * Math.PI * 2) + amp * 0.4 * Math.sin(x / 6 * Math.PI * 2), 0.5);
  return o;
}
const rms = pts => { let s = 0, n = 0; for (let i = 1; i < pts.length; i += 3) { s += (pts[i] - 100) ** 2; n++; } return Math.sqrt(s / n); };

test('a shaky line: the default steadies it by more than half, and more smoothing steadies it more', () => {
  const raw = shaky();
  const a = F.relax(raw, 1.5 + 0.35 * F.RELAX_PX), b = F.relax(raw, 1.5 + 1 * F.RELAX_PX);
  assert.ok(rms(a) < rms(raw) * 0.5, `default: ${rms(raw).toFixed(2)} → ${rms(a).toFixed(2)}`);
  assert.ok(rms(b) < rms(a), `full: ${rms(b).toFixed(2)}`);
});

test('the ends stay where the pen started and stopped', () => {
  const raw = shaky();
  const out = F.relax(raw, 20);
  assert.deepEqual([out[0], out[1]], [raw[0], raw[1]]);
  assert.deepEqual(out.slice(-3, -1), raw.slice(-3, -1));
});

test('a square keeps its corners', () => {
  const pts = [];
  const side = (x0, y0, dx, dy) => { for (let i = 0; i < 100; i++) pts.push(x0 + dx * i, y0 + dy * i, 0.5); };
  side(0, 0, 1, 0); side(100, 0, 0, 1); side(100, 100, -1, 0); side(0, 100, 0, -1); pts.push(0, 0, 0.5);
  const out = F.relax(pts, 1.5 + F.RELAX_PX);
  for (const [cx, cy] of [[100, 0], [100, 100], [0, 100]]) {
    let best = Infinity;
    for (let i = 0; i < out.length; i += 3) best = Math.min(best, Math.hypot(out[i] - cx, out[i + 1] - cy));
    assert.ok(best < 1.5, `corner at ${cx},${cy} kept within ${best.toFixed(2)}`);
  }
});

test('live: a slow pen is pulled hardest, a fast one barely more than before, and Off is the old filter', () => {
  assert.equal(F.liveAmount(0, 1), F.STREAMLINE);
  assert.ok(F.liveAmount(0.5, 1) > F.liveAmount(0.5, 20));
  assert.ok(F.liveAmount(1, 0.5) <= 0.9);
});

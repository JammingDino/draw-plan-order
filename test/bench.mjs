/* ── bench.mjs ── the numbers behind the performance commits ─────────
   `npm run bench`. Node, not a browser, so these measure the algorithms
   rather than the canvas — which is the point: every case here is one
   that used to be superlinear in board size or stroke length. The
   in-browser frame counter (?perf) covers the painting side. */
import { core, load, inked } from './harness.mjs';

const D = core();
const U = D.util, FH = D.freehand;
const R = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js');

const ms = (label, reps, fn) => {
  fn();                                            // warm
  const t = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) fn();
  const per = Number(process.hrtime.bigint() - t) / 1e6 / reps;
  return { label, per };
};

const row = (name, a, b) =>
  console.log(`  ${name.padEnd(28)} ${a.per.toFixed(4)}ms  vs  ${b.per.toFixed(4)}ms   ${(b.per / a.per).toFixed(1)}x`);

function board(n) {
  const s = new D.Scene();
  for (let i = 0; i < n; i++) {
    const x = (Math.random() - 0.5) * 20000, y = (Math.random() - 0.5) * 20000;
    const pts = [];
    for (let k = 0; k < 12; k++) pts.push(x + Math.random() * 150, y + Math.random() * 150, 0.5);
    s.add(D.make.stroke({ pts, size: 3 }));
  }
  return s;
}

console.log('\nScene query — a 1920x1080 view, index vs the linear scan it replaced');
for (const n of [500, 2000, 8000, 20000]) {
  const s = board(n);
  const view = U.box(0, 0, 1920, 1080);
  s.near(view);
  const visible = s.near(view).length;
  row(`${n} items (${visible} visible)`,
    ms('index', 300, () => s.near(view)),
    ms('linear', 300, () => s.items.filter(it => U.boxesOverlap(view, s.bbox(it)))));
}

console.log('\nUndo snapshot — one stroke, direct walk vs the JSON round trip');
const jsonClone = it => {
  const o = {};
  for (const k in it) if (k[0] !== '_') o[k] = it[k];
  if (o.pts) o.pts = Array.from(o.pts, v => Math.round(v * 100) / 100);
  return JSON.parse(JSON.stringify(o));
};
for (const n of [30, 400, 3000]) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(Math.random() * 1000, Math.random() * 1000, Math.random());
  const st = D.make.stroke({ pts, size: 3 });
  row(`${n}-point stroke`,
    ms('clone', 500, () => D.clone(st)),
    ms('json', 500, () => jsonClone(st)));
}

console.log('\nStroke smoothing — the cost of drawing one stroke end to end');
for (const n of [200, 800, 2000]) {
  const samples = [];
  for (let i = 0; i < n; i++) samples.push(Math.random() * 800, Math.random() * 800, Math.random());

  const incremental = () => {
    const raw = [];
    let sm = null, pts = null;
    for (let i = 0; i < samples.length; i += 3) {
      raw.push(samples[i], samples[i + 1], samples[i + 2]);
      if (raw.length <= 6) { sm = null; pts = raw.slice(); }
      else if (!sm || sm.length + 3 !== raw.length) pts = sm = FH.smooth(raw);
      else pts = FH.smoothStep(raw, sm);
    }
    return pts;
  };
  const full = () => {
    const raw = [];
    let pts = null;
    for (let i = 0; i < samples.length; i += 3) {
      raw.push(samples[i], samples[i + 1], samples[i + 2]);
      pts = FH.smooth(raw);
    }
    return pts;
  };
  row(`${n}-sample stroke`, ms('incremental', 20, incremental), ms('full', 20, full));
}

console.log('\nHit testing — one tap on the board');
for (const n of [500, 2000, 8000]) {
  const s = board(n);
  s.hitTest(0, 0);
  row(`${n} items`,
    ms('index', 300, () => s.hitTest(Math.random() * 2000, Math.random() * 2000, 6)),
    ms('linear', 300, () => {
      const x = Math.random() * 2000, y = Math.random() * 2000;
      for (let i = s.items.length - 1; i >= 0; i--) if (s.hitItem(s.items[i], x, y, 6)) return s.items[i];
      return null;
    }));
}

/* Painting is measured in geometry submitted, not milliseconds: node has no
   rasteriser, so the honest number here is how much work the painter hands
   over, and how many draw calls it takes to do it. */
console.log('');
console.log('Dense handwriting - what a redraw asks the rasteriser to do');
{
  const scene = new R.Scene();
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let l = 0; l < 40; l++) {
    for (let c = 0; c < 26; c++) {
      const x = 40 + c * 30, y = 60 + l * 42;
      const pts = [];
      const n = 12 + Math.floor(rand() * 20);
      for (let k = 0; k < n; k++) pts.push(x + rand() * 22, y + rand() * 26, 0.3 + rand() * 0.7);
      scene.add(R.make.stroke({ pts, size: 2.5, thinning: 0.55, taper: 6 }));
    }
  }
  const app = { scene, camera: new R.Camera(), requestDraw() {}, opts: {} };
  const r = new R.Renderer(app);
  r.grid = 'none';
  console.log(`  ${scene.items.length} strokes on the board`);
  console.log('  zoom   visible   path ops   draw calls   as centrelines');
  for (const z of [0.1, 0.25, 0.5, 1, 2]) {
    app.camera.zoom = z;
    r.drawScene();                                   // warm the caches
    r.bctx.ops = 0; r.bctx.calls.length = 0;
    r.drawScene();
    const draws = r.bctx.calls.filter(c => c === 'fill' || c === 'stroke').length;
    console.log(
      '  ' + String(z).padEnd(6),
      String(r.lastDrawn).padStart(7),
      String(r.bctx.ops).padStart(10),
      String(draws).padStart(12),
      String(r.lastSimplified).padStart(16));
  }
}

console.log('');

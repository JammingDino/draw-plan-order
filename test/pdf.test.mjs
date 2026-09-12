/* Exercises the real js/pdf.js against a stand-in pdf.js module.
   Run: node pdftest.mjs */
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("..", import.meta.url));
const HERE = import.meta.dirname;
const baseURI = pathToFileURL(HERE + "/").href;

/* ── minimal browser surface ─────────────────────────────────────── */
/* Enough of a 2D context for the dark-paper pass to run for real: it
   records the ops so a test can assert that the page was actually
   inverted rather than merely handed back unchanged. */
class FakeCanvas {
  constructor(w, h) { this.width = w; this.height = h; this.ops = []; }
  getContext() {
    const c = this;
    return {
      fillStyle: "", filter: "none", globalCompositeOperation: "source-over",
      fillRect() { c.ops.push("fill:" + this.fillStyle + ":" + this.globalCompositeOperation); },
      drawImage() { c.ops.push("draw:" + this.filter); },
      save() {}, restore() {}, setTransform() {},
    };
  }
}
globalThis.OffscreenCanvas = FakeCanvas;
globalThis.document = { baseURI, documentElement: { dataset: { theme: "light" } } };
const setTheme = t => { document.documentElement.dataset.theme = t; };
globalThis.performance = { now: () => Date.now() };

const DPO = {
  util: { uid: () => "a" + Math.random().toString(36).slice(2, 8) },
  make: { pdfpage: o => ({ type: "pdfpage", ...o }) },
};
globalThis.window = { DPO };

/* pdf.js is an IIFE that hangs itself off window.DPO, and its dynamic
   import resolves against document.baseURI. Copying it next to the stub
   and importing it normally makes both of those work with no VM games. */
fs.copyFileSync(APP + "/js/pdf.js", HERE + "/pdf-under-test.mjs");
await import("./pdf-under-test.mjs");

const P = DPO.pdf;
const fake = await import("./vendor/pdfjs/pdf.min.mjs");

/* ── a stand-in App ──────────────────────────────────────────────── */
let draws = 0;
const app = {
  toasts: [],
  toast(m) { this.toasts.push(m); },
  getAsset: async () => new Uint8Array([1, 2, 3]),
  putAsset: async () => {},
  requestDraw() { draws++; },
  scene: { begin() {}, add() {}, commit() {} },
  afterEdit() {},
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? "  — " + extra : ""}`);
};

/* ── 1. importing a 150-page document ────────────────────────────── */
globalThis.__FAKE_PAGES__ = 150;
const file = {
  name: "EMTH119 lecture notes.pdf",
  arrayBuffer: async () => new ArrayBuffer(8),
};
const t0 = Date.now();
const items = await P.import(app, file, { x: 0, y: 0 });
const importMs = Date.now() - t0;

check("import creates one item per page", items.length === 150, `${items.length}`);
check("import reports progress", app.toasts.some(t => /\d+\/150/.test(t)));
check("import stays quick", importMs < 3000, `${importMs}ms`);
check("pages are laid out down the canvas", items[1].y > items[0].y);
check("page geometry is sane", Math.abs(items[0].h / items[0].w - 842 / 595) < 0.01);

/* ── 2. the cache is budgeted in bytes ───────────────────────────── */
fake.setRenderDelay(0);
/* Ask for every page at max resolution — the pathological case that used
   to allocate gigabytes under a 48-entry page cache. */
for (const it of items) P.bitmap(app, it, 4);
await sleep(600);
for (const it of items) P.bitmap(app, it, 4);
await sleep(1200);

const s = P.stats();
check("sharp cache stays inside its budget", s.hiMB <= 256, `${s.hiMB}MB`);
check("thumbnail cache stays inside its budget", s.thumbMB <= 64, `${s.thumbMB}MB`);
check("total memory is laptop-sized", s.hiMB + s.thumbMB < 330, `${(s.hiMB + s.thumbMB).toFixed(1)}MB`);
check("concurrency is capped", s.inflight.length <= 2, `${s.inflight.length}`);

/* ── 3. zoom drift does not thrash ───────────────────────────────── */
P.clear();
await sleep(50);
const page = items[0];
P.bitmap(app, page, 2);
await sleep(300);            // let the thumbnail and the scale-2 render settle
const before = fake.stats.renders;
for (const z of [1.55, 1.62, 1.71, 1.68, 1.8, 1.9, 1.74]) P.bitmap(app, page, z);
await sleep(200);
check("drift inside one rung of the ladder renders nothing",
  fake.stats.renders === before, `${fake.stats.renders - before} extra`);

/* Crossing a rung costs exactly one render, no matter how many times the
   zoom wobbles back and forth across it. That bound is the whole reason
   the ladder exists: without it each of these samples is its own render. */
const beforeCross = fake.stats.renders;
for (const z of [1.92, 2.04, 1.97, 2.1, 2.02, 1.95, 2.08]) P.bitmap(app, page, z);
await sleep(300);
check("wobbling across a rung costs one render, not one per sample",
  fake.stats.renders - beforeCross === 1, `${fake.stats.renders - beforeCross} renders`);

const beforeStep = fake.stats.renders;
P.bitmap(app, page, 4);            // a real step up the ladder
await sleep(200);
check("a genuine zoom step does render", fake.stats.renders > beforeStep);

/* ── 4. scrolling away cancels work ──────────────────────────────── */
/* Renders must outlast STALE_MS (1.5s) for there to be anything still in
   flight to cancel; a fast render simply finishes first. */
fake.setRenderDelay(2500);
P.clear();
await sleep(50);
fake.stats.cancels = 0;

for (const it of items.slice(0, 6)) P.bitmap(app, it, 4);
await sleep(100);
// the user jumps to the end and stays there
for (let f = 0; f < 16; f++) {
  for (const it of items.slice(148)) P.bitmap(app, it, 4);
  P.sweep();
  await sleep(200);
}
check("work for pages scrolled past is cancelled", fake.stats.cancels > 0,
  `${fake.stats.cancels} cancelled`);
check("the queue does not grow without bound", P.stats().queued < 40,
  `${P.stats().queued} queued`);

/* The page actually being looked at must not be starved by thumbnail
   work for the 148 pages that were skipped over. Renders go back to a
   realistic speed here — the slow ones above existed only to leave
   something in flight for the cancellation check. */
fake.setRenderDelay(10);
const looking = items[149].asset + ":150";
let served = false;
for (let f = 0; f < 40 && !served; f++) {
  P.bitmap(app, items[149], 4);
  P.sweep();
  await sleep(100);
  served = P.stats().cache.some(c => c.k === looking && c.px > 0);
}
check("the page on screen gets a sharp render, not just a thumbnail", served);

/* ── 5. a cancelled render is not recorded as a failure ──────────── */
const failed = P.stats().cache.filter(c => c.failed);
check("cancellation never poisons the cache", failed.length === 0,
  failed.length ? failed[0].err : "");

/* ── 6. dark paper ───────────────────────────────────────────────── */
/* A white page on a dark board is a floodlight, so pages are baked dark
   at render time. The cache therefore belongs to one theme, and flipping
   the board has to invalidate it — otherwise the next frame paints the
   light bitmaps straight back onto the dark board. */
P.clear();
fake.setRenderDelay(0);
await sleep(50);

const sheet = items[0];
P.bitmap(app, sheet, 2);
await sleep(300);
check("a light board caches a light page",
  P.stats().cache.some(c => c.k === sheet.asset + ":1" && c.px > 0));

setTheme("dark");
P.themeChanged();
check("flipping the board drops the bitmaps baked for the old one",
  P.stats().hiMB === 0 && P.stats().thumbMB === 0);

/* Nothing usable is cached for the new theme, so the very next frame must
   report a miss rather than serving the light bitmap it just dropped. */
check("the first dark frame has nothing to paint yet",
  P.bitmap(app, sheet, 2) === null);

await sleep(400);
const darkBmp = P.bitmap(app, sheet, 2);
check("the page comes back rendered for the dark board", !!darkBmp);
check("the dark page is luminance-inverted, not merely dimmed",
  !!darkBmp && darkBmp.ops.some(o => o.startsWith("draw:invert(1)")));
check("the paper is floored at a soft near-black, not left pure black",
  !!darkBmp && darkBmp.ops.some(o => o === "fill:#191b1f:lighten"));

/* Going back must not reuse the inverted bitmap either — the check has
   to run in both directions, and a one-way guard would pass the test
   above while still painting a dark page on a white board. */
setTheme("light");
P.themeChanged();
check("flipping back also invalidates", P.bitmap(app, sheet, 2) === null);
await sleep(400);
const lightBmp = P.bitmap(app, sheet, 2);
check("the light board gets a page with no dark pass applied",
  !!lightBmp && !lightBmp.ops.some(o => o.startsWith("draw:invert(1)")));

/* ── 7. forget / clear release memory ────────────────────────────── */
P.forget(items[0].asset);
const after = P.stats();
check("forget empties the caches", after.hiMB === 0 && after.thumbMB === 0,
  `${after.hiMB}/${after.thumbMB}MB`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

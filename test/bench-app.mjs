/* ── bench-app.mjs ── the app itself, driven like a person uses it ────
   npm run bench:app                 the web build, in Chrome
   npm run bench:app -- --desktop    the desktop app (build it first:
                                     npx tauri build --no-bundle), on a
                                     throwaway boards folder

   bench.mjs measures the algorithms under node; this measures what you
   feel and what the battery pays, on a big handwritten board:

     main    ms of main-thread work (Chrome's TaskDuration): what the
             battery pays, and time the page could not answer the pen
     input   ms from an input event (pen, wheel, click) to the end of the
             frame that showed it — median / 95th percentile / worst.
             This is "does it feel fluid".
     frame   ms inside one App.frame(), mean / worst
     long    tasks over 50ms (the hitches you notice), and the longest
     wall    ms start to finish, for one-shot actions (open, save, switch)

   The desktop run differs from the browser one where it matters: saving
   and loading go through the shell and the disk, and painting is the
   WebView2 on your own screen. Close the installed app first; the two
   share a WebView2 profile.

   --runs N takes the median of N runs; --only a,b picks scenarios;
   --strokes N sizes the board; --json file keeps the numbers.          */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const DESKTOP = args.includes('--desktop');
const RUNS = +opt('runs', 1);
const STROKES = +opt('strokes', 8000);
const ONLY = opt('only', '');

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch (_) { console.error('needs playwright-core: npm install'); process.exit(1); }

/* ── where the app runs ────────────────────────────────────────────── */
async function webTarget() {
  const CHROME = process.env.CHROME || [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find(p => existsSync(p));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, r));
  /* Headless Chrome usually paints through SwiftShader, a software stand-in
     for the graphics card, which makes painting look far dearer than it is
     on a laptop's GPU. --headed opens a real window on the real GPU. */
  const browser = await chromium.launch({ executablePath: CHROME, headless: !args.includes('--headed') });
  return {
    browser,
    async open() {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
      await page.goto(`http://localhost:${server.address().port}/?scratch`);
      return { page, browser, close: () => page.close() };
    },
    async done() { await browser.close(); server.close(); }
  };
}

async function desktopTarget() {
  const exe = join(ROOT, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'draw-plan-order.exe' : 'draw-plan-order');
  if (!existsSync(exe)) { console.error('build the desktop app first: npx tauri build --no-bundle'); process.exit(1); }
  return {
    async open() {
      const dir = await mkdtemp(join(tmpdir(), 'dpo-bench-'));
      const port = 9300 + Math.floor(Math.random() * 600);
      const proc = spawn(exe, [], {
        /* this replaces the arguments the app sets for itself (open_window
           in main.rs), so it repeats them — with the battery's choice of
           GPU, so runs compare the same chip whether plugged in or not */
        env: {
          ...process.env, DPO_BOARDS_DIR: dir,
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --force_low_power_gpu --remote-debugging-port=${port}`
        },
        stdio: 'ignore'
      });
      let browser;
      for (let i = 0; i < 100 && !browser; i++) {
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
        catch (_) { await new Promise(r => setTimeout(r, 200)); }
      }
      if (!browser) { proc.kill(); throw new Error('the desktop app did not open its debugging port'); }
      let page;
      for (let i = 0; i < 100 && !page; i++) {
        page = browser.contexts().flatMap(c => c.pages())[0];
        if (!page) await new Promise(r => setTimeout(r, 100));
      }
      return {
        page, browser,
        async close() {
          try { await browser.close(); } catch (_) { }
          proc.kill();
          await new Promise(r => setTimeout(r, 500));
          await rm(dir, { recursive: true, force: true }).catch(() => { });
        }
      };
    },
    async done() { }
  };
}

/* ── in the page: the board, and the probes ─────────────────────────── */
function setup(n) {
  const D = window.DPO, app = D.app;
  let seed = 11;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  /* Lines of handwriting down a long page, the way homework fills one:
     ~40 letters a line, letters of 30-90 samples with real pressure. */
  for (let i = 0; i < n; i++) {
    const line = Math.floor(i / 40), col = i % 40;
    let x = col * 22 + rand() * 4, y = line * 48 + rand() * 6;
    const pts = [], k = 30 + Math.floor(rand() * 60);
    let a = rand() * 6.28;
    for (let j = 0; j < k; j++) {
      a += (rand() - 0.5) * 0.9;
      x += Math.cos(a) * 0.9; y += Math.sin(a) * 0.9;
      pts.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, 0.35 + rand() * 0.5);
    }
    app.scene.add(D.make.stroke({ pts, size: 2.5, thinning: 0.55, taper: 6.25, color: 'ink' }));
  }
  app.scene.undoStack.length = 0;
  $title().value = 'Bench homework';
  app.camera.zoom = 1; app.camera.x = 120; app.camera.y = 120;
  app.requestDraw();
  function $title() { return document.getElementById('board-title'); }

  // probes: wrap the hot paths without changing them
  const S = window.__bench = { frame: [], move: [], lat: [], long: [], pending: [] };
  const wrap = (obj, name, into, after) => {
    const f = obj[name];
    obj[name] = function (...a) {
      const t = performance.now();
      try { return f.apply(this, a); }
      finally { const e = performance.now(); into.push(e - t); if (after) after(e); }
    };
  };
  /* input → frame: every event that should change the picture (a press,
     a drag, a wheel turn) waits for the next App.frame() to show it */
  /* only input aimed at the board: a click on a button opens a sheet,
     which is not a frame of the canvas and is timed by its own scenario */
  const stage = document.getElementById('stage');
  const note = e => {
    if (!stage.contains(e.target) && !(e.type === 'pointermove' && DPO.app.active)) return;
    if (e.type !== 'pointermove' || e.buttons) S.pending.push([e.timeStamp, e.type]);
  };
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) addEventListener(t, note, { capture: true, passive: true });
  S.worst = [];
  wrap(app, 'frame', S.frame, end => {
    for (const [ts, type] of S.pending) {
      S.lat.push(end - ts);
      if (end - ts > 100) S.worst.push(`${type} waited ${(end - ts).toFixed(0)}ms`);
    }
    S.pending.length = 0;
  });
  wrap(app, 'onMove', S.move);
  new PerformanceObserver(l => { for (const e of l.getEntries()) S.long.push(e.duration); }).observe({ type: 'longtask' });
  S.reset = () => { for (const k of ['frame', 'move', 'lat', 'long', 'pending', 'worst']) S[k].length = 0; };
  S.frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/* ── what a person does ─────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** one handwritten letter: a short wiggle, at a pen's pace */
async function letter(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 18; k++) await page.mouse.move(x + 12 * Math.sin(k / 3) + k * 0.6, y + 16 * Math.sin(k / 2.2));
  await page.mouse.up();
}
async function writeLine(page, x, y, words, think = 0) {
  for (let w = 0; w < words; w++) {
    for (let l = 0; l < 4; l++) { await letter(page, x, y); x += 22; await sleep(90); }
    x += 26;
    await sleep(think && w === 1 ? think : 350);       // between words, or a pause to think
  }
}
const frames = page => page.evaluate(() => __bench.frames());

const scenarios = {
  /** the whole of it: what a homework session actually does */
  async session(page) {
    await page.evaluate(() => DPO.app.setTool('pen'));
    await page.click('#btn-menu'); await sleep(600);              // look at the boards
    await page.keyboard.press('Escape'); await sleep(300);
    await writeLine(page, 260, 260, 4);
    await writeLine(page, 260, 330, 4, 6000);                     // stop to think: the autosave lands here
    await writeLine(page, 260, 400, 3);
    await page.mouse.move(700, 450);
    for (let k = 0; k < 25; k++) { await page.mouse.wheel(0, 50); await sleep(16); }   // scroll down the page
    await sleep(400);
    await writeLine(page, 260, 300, 3);
    await page.keyboard.down('Control');
    for (let k = 0; k < 12; k++) { await page.mouse.wheel(0, 80); await sleep(16); }   // zoom out to find your place
    await sleep(500);
    for (let k = 0; k < 12; k++) { await page.mouse.wheel(0, -80); await sleep(16); }  // and back in
    await page.keyboard.up('Control');
    await sleep(400);
    await writeLine(page, 260, 380, 2);
    await page.evaluate(async () => {                              // over to another board and back
      const app = DPO.app, big = app.board.id;
      if (!window.__small) { const b = DPO.store.newBoard('Bench small'); await DPO.store.save(b); window.__small = b.id; }
      await app.openBoard(window.__small); await __bench.frames();
      await app.openBoard(big); await __bench.frames();
    });
    await sleep(300);
  },
  /** writing at reading zoom, no pauses: the drawing path alone */
  async write(page) {
    for (let s = 0; s < 30; s++) await letter(page, 300 + (s % 10) * 40, 300 + Math.floor(s / 10) * 60);
  },
  /** one long stroke: the per-sample cost as a stroke grows */
  async longStroke(page) {
    await page.mouse.move(200, 400);
    await page.mouse.down();
    for (let k = 0; k < 400; k++) await page.mouse.move(200 + k * 2, 400 + 60 * Math.sin(k / 9));
    await page.mouse.up();
  },
  async pan(page) {
    await page.mouse.move(700, 450);
    for (let k = 0; k < 60; k++) { await page.mouse.wheel(0, 40); await frames(page); }
  },
  /** the whole board on screen, panning */
  async panZoomedOut(page) {
    await page.evaluate(() => DPO.app.zoomToFit());
    await frames(page);
    await page.mouse.move(700, 450);
    for (let k = 0; k < 40; k++) { await page.mouse.wheel(0, 30); await frames(page); }
    await page.evaluate(() => { const c = DPO.app.camera; c.zoom = 1; c.x = 120; c.y = 120; DPO.app.requestDraw(); });
    await frames(page);
  },
  async zoom(page) {
    await page.mouse.move(700, 450);
    await page.keyboard.down('Control');
    for (let k = 0; k < 30; k++) { await page.mouse.wheel(0, k < 15 ? -60 : 60); await frames(page); }
    await page.keyboard.up('Control');
  },
  async dragSelection(page) {
    await page.evaluate(() => DPO.app.setTool('select'));
    await page.mouse.move(150, 150); await page.mouse.down();
    await page.mouse.move(700, 500, { steps: 10 }); await page.mouse.up();
    await page.mouse.move(400, 300); await page.mouse.down();
    for (let k = 0; k < 40; k++) await page.mouse.move(400 + k * 3, 300 + k * 2);
    await page.mouse.up();
    await page.evaluate(() => { DPO.app.select([]); DPO.app.setTool('pen'); });
  },
  async erase(page) {
    await page.evaluate(() => DPO.app.setTool('eraser'));
    await page.mouse.move(150, 200); await page.mouse.down();
    for (let k = 0; k < 60; k++) await page.mouse.move(150 + k * 8, 200 + 40 * Math.sin(k / 4));
    await page.mouse.up();
    await page.evaluate(() => DPO.app.setTool('pen'));
  },
  async save(page) {
    return page.evaluate(async () => {
      const app = DPO.app;
      app.markDirty();
      const t = performance.now(); await app.saveNow(); return performance.now() - t;
    });
  },
  /** the boards menu, until its preview has painted */
  async openSheet(page) {
    return page.evaluate(async () => {
      const ui = DPO.app.ui, t = performance.now();
      await new Promise(r => { const o = ui.preview.onPaint; ui.preview.onPaint = () => { ui.preview.onPaint = o; o && o(); r(); }; ui.openSheet(); });
      const ms = performance.now() - t;
      ui.closeSheet();
      return ms;
    });
  },
  /** to a small board and back to the big one, until each has painted */
  async switchBoards(page) {
    return page.evaluate(async () => {
      const app = DPO.app, big = app.board.id;
      if (!window.__small) { const b = DPO.store.newBoard('Bench small'); await DPO.store.save(b); window.__small = b.id; }
      await app.saveNow(true);
      const t = performance.now();
      await app.openBoard(window.__small); await __bench.frames();
      await app.openBoard(big); await __bench.frames();
      return performance.now() - t;
    });
  },
  /** three seconds of nothing: what the app costs sitting open */
  async idle(page) { await sleep(3000); }
};

/* ── run ───────────────────────────────────────────────────────────── */
const target = DESKTOP ? await desktopTarget() : await webTarget();
const results = {};
for (let run = 0; run < RUNS; run++) {
  const { page, browser, close } = await target.open();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  /* CPU seconds across every process — the page, the GPU process that
     rasterises its canvases, the browser — which is what the battery
     actually pays. The page's own main thread is only part of it. */
  const bcdp = await browser.newBrowserCDPSession().catch(() => null);
  /* The browser process is left out: it is busy mostly with this script's
     own injected input, which a person's pen does not cost. */
  const procs = async () => {
    if (!bcdp) return { all: 0, gpu: 0 };
    try {
      const list = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
      const sum = f => list.filter(f).reduce((s, p) => s + p.cpuTime, 0);
      return { all: sum(p => p.type !== 'browser'), gpu: sum(p => /gpu/i.test(p.type)) };
    } catch (_) { return { all: 0, gpu: 0 }; }
  };
  const cpu = async () => ({ ...(await metrics()), procs: await procs() });
  await page.waitForFunction(() => window.DPO && DPO.app && DPO.app.ui, null, { timeout: 30000 });
  // --css "…": try a style change without editing the app
  if (opt('css', '')) await page.addStyleTag({ content: opt('css', '') });
  // --eval "…": try a code change in the page without editing the app
  if (opt('eval', '')) await page.evaluate(opt('eval', ''));
  const t0 = Date.now();
  await page.evaluate(setup, STROKES);
  await frames(page);
  if (!run) {
    const gpu = await page.evaluate(() => {
      try {
        const g = document.createElement('canvas').getContext('webgl');
        const x = g.getExtension('WEBGL_debug_renderer_info');
        return g.getParameter(x.UNMASKED_RENDERER_WEBGL);
      } catch (_) { return 'unknown'; }
    });
    console.log(`${DESKTOP ? 'desktop app' : 'Chrome'} on ${gpu}`);
    console.log(`${STROKES} strokes, built and painted in ${Date.now() - t0}ms`);
  }
  await page.evaluate(() => DPO.app.saveNow(true));
  await sleep(1500);                            // first paint, idle warming and the first save settle

  for (const [name, fn] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.split(',').includes(name)) continue;
    await page.evaluate(() => __bench.reset());
    const PROFILE = args.includes('--profile');
    if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    const before = await cpu();
    const t = Date.now();
    const ms = await fn(page);
    await frames(page);
    const after = await cpu();
    const slow = await page.evaluate(() => __bench.worst.slice(0, 6));
    if (slow.length && args.includes('--why')) console.log(`  ${name}: slow inputs: ${slow.join(', ')}`);
    if (PROFILE) {
      /* --profile: where the main thread's time went, by function. Time
         outside any script (the browser's own input, style, layout and
         paint bookkeeping) shows up as "(program)". */
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map(), dt = new Map();
      for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
      for (const n of profile.nodes) {
        const cf = n.callFrame, file = (cf.url || '').split('/').pop();
        const key = `${cf.functionName || '(anonymous)'} ${file ? file + ':' + (cf.lineNumber + 1) : ''}`.trim();
        self.set(key, (self.get(key) || 0) + (dt.get(n.id) || 0) / 1000);
      }
      const top = [...self].filter(([k]) => k !== '(idle)').sort((a, b) => b[1] - a[1]).slice(0, 14);
      console.log(`\n  ${name}: main-thread time by function (ms, self)`);
      for (const [k, v] of top) console.log(`   ${v.toFixed(1).padStart(8)}  ${k}`);
    }
    const s = await page.evaluate(() => ({ frame: __bench.frame.slice(), move: __bench.move.slice(), lat: __bench.lat.slice(), long: __bench.long.slice() }));
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const pct = (a, p) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
    const r = {
      main: (after.TaskDuration - before.TaskDuration) * 1000,
      cpu: (after.procs.all - before.procs.all) * 1000,
      gpu: (after.procs.gpu - before.procs.gpu) * 1000,
      inP50: pct(s.lat, 0.5), inP95: pct(s.lat, 0.95), inMax: Math.max(0, ...s.lat),
      frameMean: mean(s.frame), frameMax: Math.max(0, ...s.frame),
      long: s.long.length, longMax: Math.max(0, ...s.long),
      wall: typeof ms === 'number' ? ms : Date.now() - t
    };
    (results[name] = results[name] || []).push(r);
  }
  await close();
}
await target.done();

/* ── report: the median run of each ─────────────────────────────────── */
const med = (rs, k) => rs.map(r => r[k]).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
const f = v => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
console.log('\nscenario         main ms  app CPU  gpu proc   input p50/p95/worst   frame avg/worst   long (worst)   wall ms');
const out = {};
for (const [name, rs] of Object.entries(results)) {
  const o = out[name] = Object.fromEntries(Object.keys(rs[0]).map(k => [k, med(rs, k)]));
  console.log(
    name.padEnd(15),
    f(o.main).padStart(9), f(o.cpu).padStart(8), f(o.gpu).padStart(9),
    `${f(o.inP50)}/${f(o.inP95)}/${f(o.inMax)}`.padStart(22),
    `${f(o.frameMean)}/${f(o.frameMax)}`.padStart(18),
    `${o.long} (${f(o.longMax)})`.padStart(14),
    f(o.wall).padStart(9));
}
const jsonOut = opt('json', '');
if (jsonOut) await writeFile(jsonOut, JSON.stringify(out, null, 1));

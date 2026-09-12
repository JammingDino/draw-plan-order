/* ── harness.mjs ── run the browser-global modules under node ────────
   js/*.js hang everything off `window.DPO` and expect a DOM, because the
   app is meant to run straight from file:// with no build step. Rather
   than reshape the source to suit the tests, the tests bring the two
   browser bits it actually touches: a global `window`, and a canvas
   context that can measure text. Measurement is a fixed-width stand-in —
   layout tests assert on wrapping behaviour, not on Segoe UI's metrics. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** width of one character at 1px, for the stub text measurer */
export const CHAR_W = 0.5;

/* A 2d context that records nothing and refuses nothing. Enough for code
   that paints — the tests assert on the numbers behind the painting, never
   on pixels. `calls` is there for the rare assertion that something was
   drawn at all. */
function stubContext() {
  const ctx = {
    font: '10px sans-serif',
    calls: [],
    measureText(s) {
      const px = parseFloat(this.font) || 10;
      return { width: String(s).length * px * CHAR_W };
    }
  };
  const noop = ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
    'ellipse', 'rect', 'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke',
    'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage',
    'setTransform', 'transform', 'translate', 'scale', 'rotate', 'setLineDash', 'clip'];
  for (const m of noop) ctx[m] = (...a) => { ctx.calls.push(m); };
  ctx.createPattern = () => ({ setTransform() {} });
  ctx.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  return ctx;
}

/** the little bit of DOM the painting code reaches for */
function stubElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, children: [], width: 0, height: 0,
    innerHTML: '', textContent: '', className: '',
    getContext: () => (el._ctx || (el._ctx = stubContext())),
    setAttribute(k, v) { el[k] = v; },
    getAttribute(k) { return el[k]; },
    addEventListener() {}, removeEventListener() {},
    append(...k) { el.children.push(...k); },
    appendChild(k) { el.children.push(k); return k; },
    remove() { el.removed = true; },
    /* the overlay builds itself from an innerHTML string, so hand back a
       fresh stub for whatever it asks for rather than parsing the markup */
    querySelector(sel) {
      const key = '_q' + sel;
      return el[key] || (el[key] = stubElement(sel.replace(/[^a-z]/gi, '') || 'div'));
    },
    toDataURL: () => 'data:image/png;base64,'
  };
  return el;
}

/** Load the given js/ files, in order, into one fresh global. */
export function load(...files) {
  const ctx = {
    Math, JSON, Date, performance, console,
    Array, Object, String, Number, Boolean, Error, Map, Set, RegExp,
    Float32Array, Uint8Array, Uint8ClampedArray, Int32Array,
    isFinite, isNaN, parseFloat, parseInt,
    setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0),
    document: {
      documentElement: Object.assign(stubElement('html'), { dataset: {} }),
      body: stubElement('body'),
      createElement: stubElement,
      getElementById: id => stubElement('div'),
      querySelector: sel => stubElement('div'),
      addEventListener() {}
    },
    location: { search: '', protocol: 'http:', origin: 'http://localhost' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    devicePixelRatio: 2,
    innerWidth: 1280, innerHeight: 800,
    DOMMatrix: class { constructor(v) { this.v = v; } },
    Path2D: class { moveTo() {} lineTo() {} closePath() {} arc() {} roundRect() {} ellipse() {} },
    addEventListener() {}
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files) {
    vm.runInContext(readFileSync(join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.DPO;
}

/** The geometry layer: everything with no rendering or storage in it. */
export function core() {
  return load('util.js', 'freehand.js', 'recognize.js', 'scene.js');
}

/** A stand-in for App, for code that only reads a few fields off it. */
export function fakeApp(D, over = {}) {
  return Object.assign({
    scene: new D.Scene(),
    camera: { zoom: 1, x: 0, y: 0 },
    schedule() { this.scheduled = (this.scheduled || 0) + 1; },
    startAnim() {}, stopAnim() {}
  }, over);
}

/** A flat [x,y,pressure,…] path along the given [x,y] points. */
export function inked(xy, pressure = 0.5) {
  const out = [];
  for (let i = 0; i < xy.length; i += 2) out.push(xy[i], xy[i + 1], pressure);
  return out;
}

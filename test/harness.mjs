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

function stubContext() {
  return {
    font: '10px sans-serif',
    measureText(s) {
      const px = parseFloat(this.font) || 10;
      return { width: String(s).length * px * CHAR_W };
    }
  };
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
      documentElement: { dataset: {}, style: {} },
      createElement: tag => tag === 'canvas'
        ? { width: 0, height: 0, getContext: () => stubContext() }
        : { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
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

/** A flat [x,y,pressure,…] path along the given [x,y] points. */
export function inked(xy, pressure = 0.5) {
  const out = [];
  for (let i = 0; i < xy.length; i += 2) out.push(xy[i], xy[i + 1], pressure);
  return out;
}

/* Press and hold (taps.js Hold, app.js armHold/onHold/onTap): when a held
   pen or finger opens the long-press menu, and — the harder half — all the
   gestures that start exactly the same way and must not: a finger panning,
   a pen holding still at the end of a stroke to snap it, the select tool
   picking up a page, two fingers held to keep undoing, a palm.

   These run the real App, tools and Taps on a fake clock: every timer the
   app sets (the hold, the pen's snap, the select tool's pick-up, the
   two-finger repeat, the frame loop) waits on it, so a test says exactly
   how long a contact was held, and runs in no time at all. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, inked } from './harness.mjs';

/* ── a clock that only moves when told to ─────────────────────────── */
function fakeClock() {
  let t = 1000, seq = 0;
  const q = new Map();
  return {
    now: () => t,
    set: (fn, ms = 0) => { const id = ++seq; q.set(id, { at: t + Math.max(0, +ms || 0), fn }); return id; },
    clear: id => { q.delete(id); },
    /** run everything due in the next `ms`, in order, at the time it was due */
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let id = null, next = null;
        for (const [k, e] of q) if (e.at <= end && (!next || e.at < next.at)) { id = k; next = e; }
        if (!next) break;
        q.delete(id);
        t = Math.max(t, next.at);
        next.fn();
      }
      t = end;
    }
  };
}

/* ── the pure detector ────────────────────────────────────────────── */
const H = load('util.js', 'taps.js');

function holdRig() {
  const clock = fakeClock(), log = [];
  const hold = new H.Hold({ ring: h => log.push('ring'), abort: () => log.push('abort'), fire: h => log.push('fire') }, clock);
  const ev = (x, y, type = 'touch', id = 1) => ({ pointerId: id, pointerType: type, clientX: x, clientY: y });
  return { clock, log, hold, ev };
}

test('a contact held still fires once, after the delay, with the ring before it', () => {
  const { clock, log, hold, ev } = holdRig();
  hold.start(ev(100, 100), 500);
  const ringAt = Math.max(H.Hold.RING_MIN, 500 - H.Hold.RING_LEAD);
  clock.advance(ringAt - 1);
  assert.deepEqual(log, []);
  clock.advance(1);
  assert.deepEqual(log, ['ring'], 'the ring shows once it has been still a moment');
  clock.advance(500 - ringAt - 1);
  assert.deepEqual(log, ['ring']);
  clock.advance(1);
  assert.deepEqual(log, ['ring', 'fire']);
  clock.advance(5000);
  assert.deepEqual(log, ['ring', 'fire'], 'once');
});

test('wobble inside the slop is still a hold; past it, never again until the next down', () => {
  const { clock, log, hold, ev } = holdRig();
  hold.start(ev(100, 100), 500);
  hold.move(ev(100 + H.Hold.SLOP.touch - 1, 100));
  clock.advance(500);
  assert.deepEqual(log, ['ring', 'fire']);

  const b = holdRig();
  b.hold.start(b.ev(100, 100, 'pen'), 500);
  b.clock.advance(300);
  b.hold.move(b.ev(100 + H.Hold.SLOP.pen + 1, 100, 'pen'));
  b.hold.move(b.ev(100, 100, 'pen'));                 // back where it started: too late
  b.clock.advance(2000);
  assert.deepEqual(b.log, ['ring', 'abort'], 'the ring is taken down, nothing fires');
});

test('lifting, or another contact, ends it; other pointers moving do not', () => {
  const { clock, log, hold, ev } = holdRig();
  hold.start(ev(100, 100), 500);
  hold.move(ev(400, 400, 'touch', 2));                // someone else's finger
  clock.advance(100);
  hold.end(ev(100, 100));
  clock.advance(1000);
  assert.deepEqual(log, []);

  const b = holdRig();
  b.hold.start(b.ev(100, 100), 500);
  b.clock.advance(200);
  b.hold.start(b.ev(300, 100, 'touch', 2), 500);      // the app restarts it for each new contact
  b.hold.cancel();                                     // ... and a second finger is not eligible
  b.clock.advance(2000);
  assert.deepEqual(b.log, ['ring', 'abort']);
});

/* ── the whole app ────────────────────────────────────────────────── */
function rig({ tool = 'pen', items = [] } = {}) {
  const clock = fakeClock();
  const D = load('util.js', 'freehand.js', 'recognize.js', 'scene.js', 'camera.js', 'render.js',
    'editor.js', 'taps.js', 'tools.js', g => {
      g.setTimeout = clock.set; g.clearTimeout = clock.clear;
      g.requestAnimationFrame = fn => clock.set(fn, 16);
      g.performance = { now: clock.now };
      // a store that never answers: start() waits on it, so only the constructor runs
      g.DPO.store = { init: () => new Promise(() => {}), setLast() {} };
    }, 'press.js', 'app.js');
  const app = D.app;
  app.ui = { toast() {}, hideToast() {}, refresh() {}, palette: () => [] };
  app.saveDebounced = () => {}; app.warmSave = () => {}; app.savePrefs = () => {};
  app.setBoard({ id: 'b', name: 'B', doc: { items: [] } });
  /* the DOM half of press.js, recorded rather than built */
  const press = app.press = {
    menus: [], labels: [], rings: 0, aborts: 0, locks: [],
    ring() { this.rings++; }, unring() { this.aborts++; }, lock(h, mode) { this.locks.push(mode); },
    openMenu(ctx) { this.menus.push(ctx); }, closeMenu() {}, closeLabel() {},
    editLabel(e) { this.labels.push(e); }, hideBar() {}, frame() {}, reset() {}, key: () => false
  };
  app.renderer.picture = () => ({ img: null, ready: Promise.resolve() });   // no image decoding under node
  const edited = [];
  app.editor.open = it => edited.push(it);
  const made = typeof items === 'function' ? items(D) : items;
  for (const it of made) app.scene.add(it);
  app.setTool(tool);

  const ev = o => Object.assign({
    pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, isPrimary: true, button: 0, buttons: 1,
    pressure: 0.5, width: 22, height: 22, target: { closest: () => null }, preventDefault() {}
  }, o);
  const at = (x, y, o) => ev({ clientX: x, clientY: y, ...o });
  const io = {
    down: (x, y, o) => app.onDown(at(x, y, o)),
    move: (x, y, o) => app.onMove(at(x, y, { button: -1, ...o })),
    up: (x, y, o) => app.onUp(at(x, y, { buttons: 0, ...o })),
    /** move in steps, a frame apart, as a hand does */
    drag(pts, o) { for (const [x, y] of pts) { io.move(x, y, o); clock.advance(8); } },
    tap(x, y, o) { io.down(x, y, o); clock.advance(60); io.up(x, y, o); }
  };
  return { D, app, press, clock, edited, items: made, ...io };
}
const PEN = { pointerType: 'pen', pointerId: 7 };
const menus = r => r.press.menus.length;
const delay = 500;
const MENU_WAIT = 350;         // app.js: armed and still this long, the menu opens anyway

test('a finger held still arms at the delay, opens the menu as it lifts, and leaves the board where it was', () => {
  const r = rig();
  r.down(600, 400);
  r.move(604, 403);                                    // a finger is never perfectly still: it nudges the pan
  r.clock.advance(delay - 1);
  assert.equal(r.press.locks.length, 0);
  r.clock.advance(1);
  assert.deepEqual(r.press.locks, ['marquee'], 'the ring locks at the delay');
  assert.equal(menus(r), 0, 'but the menu waits for the lift (or a little longer)');
  r.up(604, 403);
  assert.equal(menus(r), 1);
  const ctx = r.press.menus[0];
  assert.equal(ctx.pointerType, 'touch');
  assert.deepEqual([ctx.sx, ctx.sy], [600, 400]);
  assert.equal(ctx.hit, null);
  assert.deepEqual([r.app.camera.x, r.app.camera.y], [0, 0], 'the nudge is undone');
  assert.ok(r.press.rings >= 1, 'the ring showed while it was held');
  assert.equal(r.app.scene.items.length, 0);
});

test('a finger that moves pans straight away, and never opens the menu', () => {
  const r = rig();
  r.down(600, 400);
  r.move(612, 400);
  assert.equal(r.app.camera.x, 12, 'the very first move panned: nothing waits on the hold');
  r.drag([[640, 400], [660, 410]]);
  r.clock.advance(2000);
  r.up(660, 410);
  assert.equal(menus(r), 0);
  assert.deepEqual([r.app.camera.x, r.app.camera.y], [60, 10]);
});

test('a pen held still where it landed opens the menu and leaves no dot', () => {
  const r = rig();
  r.down(500, 300, PEN);
  r.clock.advance(delay);
  assert.equal(menus(r), 0);
  r.clock.advance(MENU_WAIT);
  assert.equal(menus(r), 1, 'still held a moment after arming: the menu opens without waiting for the lift');
  r.up(500, 300, PEN);
  assert.equal(menus(r), 1, 'and lifting does not open a second');
  r.clock.advance(1000);
  assert.equal(r.app.scene.items.length, 0, 'the pen’s stroke was cancelled, not committed');
  assert.equal(r.app.scene.undoStack.length, 0);
});

test('a pen that draws and then holds still snaps the shape instead', () => {
  const r = rig();
  r.down(300, 300, PEN);
  const pts = [];
  for (let i = 1; i <= 20; i++) pts.push([300 + i * 10, 300]);
  for (let i = 1; i <= 15; i++) pts.push([500, 300 + i * 10]);
  for (let i = 1; i <= 20; i++) pts.push([500 - i * 10, 450]);
  for (let i = 1; i <= 15; i++) pts.push([300, 450 - i * 10]);
  r.drag(pts, PEN);
  r.clock.advance(1500);                               // held still at the end, well past both delays
  assert.equal(menus(r), 0);
  r.up(300, 300, PEN);
  assert.deepEqual([...r.app.scene.items.map(i => i.type)], ['shape'], 'it snapped');
  assert.equal(r.app.scene.items[0].kind, 'rect');
});

test('a short bar held still at its end stays ink, so it can be half of an "="; a long one still snaps', () => {
  const r = rig();
  r.down(300, 300, PEN);
  const pts = [];
  for (let i = 1; i <= 14; i++) pts.push([300 + i * 2, 300]);     // 28px: a long "=" bar, written slowly
  r.drag(pts, PEN);
  r.clock.advance(1500);
  r.up(328, 300, PEN);
  assert.deepEqual([...r.app.scene.items.map(i => i.type)], ['stroke'], 'left as ink');

  const s = rig();
  s.down(300, 300, PEN);
  const long = [];
  for (let i = 1; i <= 20; i++) long.push([300 + i * 10, 300]);   // 200px: a line someone wants
  s.drag(long, PEN);
  s.clock.advance(1500);
  s.up(500, 300, PEN);
  assert.equal(s.app.scene.items[0].type, 'shape', 'snapped');
  assert.equal(s.app.scene.items[0].kind, 'line');
});

test('the select tool picks a page up first; the menu needs a longer hold, and dragging after the pick-up still drags', () => {
  const page = D => [D.make.image({ x: 100, y: 100, w: 600, h: 400, src: 'data:,' })];
  const r = rig({ tool: 'select', items: page });
  r.down(300, 250, PEN);
  r.clock.advance(320);
  assert.deepEqual([...r.app.selection.map(i => i.type)], ['image'], 'picked up at the select tool’s 300ms');
  r.clock.advance(delay - 320);
  assert.equal(r.press.locks.length, 0, 'not at the plain delay: there is time to start dragging');
  r.clock.advance(400);
  assert.equal(r.press.locks.length, 1, 'still holding, still still: armed');
  r.clock.advance(MENU_WAIT);
  assert.equal(menus(r), 1, 'and then the menu');
  assert.deepEqual([...r.press.menus[0].selection.map(i => i.type)], ['image']);
  r.up(300, 250, PEN);
  assert.equal(r.app.scene.undoStack.length, 0, 'the half-made move left nothing');

  const s = rig({ tool: 'select', items: page });
  const img = s.items[0];
  s.down(300, 250, PEN);
  s.clock.advance(450);                                // lifted, seen, and now...
  s.drag([[310, 250], [340, 260], [380, 270]], PEN);   // ...dragged
  s.clock.advance(2000);
  s.up(380, 270, PEN);
  assert.equal(menus(s), 0);
  assert.equal(img.x, 180, 'the page moved');
});

test('once the select tool has nudged something, a still hold is a drag that stopped, not a menu', () => {
  const r = rig({ tool: 'select', items: D => [D.make.note({ x: 400, y: 200, w: 190, h: 190 })] });
  const note = r.items[0];
  r.down(480, 280, PEN);
  r.move(484, 280, PEN);                               // past the tool's 3px, inside the hold's 6
  r.clock.advance(2000);
  r.up(484, 280, PEN);
  assert.equal(menus(r), 0);
  assert.equal(note.x, 404);
  assert.deepEqual([...r.app.scene.undoStack.map(o => o.label)], ['move'], 'and the nudge is an undo step like any move');
});

test('two fingers held still keep undoing, and never open the menu', () => {
  const r = rig(), D = r.D;
  for (let i = 0; i < 4; i++) {
    r.app.scene.begin('draw'); r.app.scene.add(D.make.stroke({ pts: inked([i * 50, 0, i * 50 + 30, 30]) })); r.app.scene.commit();
  }
  r.down(400, 400, { pointerId: 1 });
  r.clock.advance(30);
  r.down(470, 400, { pointerId: 2, isPrimary: false });
  r.clock.advance(2000);
  r.up(400, 400, { pointerId: 1 });
  r.up(470, 400, { pointerId: 2, isPrimary: false });
  assert.equal(menus(r), 0);
  assert.equal(r.app.scene.items.length, 0, 'the two-finger hold undid all four strokes');
});

test('a second finger, even briefly, ends the first one’s hold for good', () => {
  const r = rig();
  r.down(400, 400, { pointerId: 1 });
  r.clock.advance(200);
  r.down(520, 420, { pointerId: 2, isPrimary: false });
  r.clock.advance(100);
  r.up(520, 420, { pointerId: 2, isPrimary: false });
  r.clock.advance(2000);
  r.up(400, 400, { pointerId: 1 });
  assert.equal(menus(r), 0);
});

test('a resting palm does not open the menu: not soon after the pen, not as the pen arrives, not when it is palm-sized', () => {
  const r = rig();
  r.move(800, 500, { pointerType: 'pen', pointerId: 7, buttons: 0 });   // the pen hovering
  r.clock.advance(300);
  r.down(900, 600);
  r.clock.advance(2000);
  r.up(900, 600);
  assert.equal(menus(r), 0, 'a finger down while the pen was about');

  const s = rig();
  s.down(900, 600);
  s.clock.advance(250);
  s.move(800, 500, { pointerType: 'pen', pointerId: 7, buttons: 0 });   // the pen comes into range
  s.clock.advance(2000);
  s.up(900, 600);
  assert.equal(menus(s), 0, 'the pen arriving');

  const t = rig();
  t.down(900, 600, { width: 120, height: 90 });
  t.clock.advance(2000);
  t.up(900, 600);
  assert.equal(menus(t), 0, 'a contact the size of a palm');
});

test('the eraser and the mouse do not long-press; a right click opens the menu', () => {
  const r = rig({ tool: 'eraser' });
  r.down(500, 300, PEN);
  r.clock.advance(2000);
  r.up(500, 300, PEN);
  assert.equal(menus(r), 0, 'the eraser has already rubbed out what it landed on');

  const m = rig();
  m.down(500, 300, { pointerType: 'mouse' });
  m.clock.advance(2000);
  m.up(500, 300, { pointerType: 'mouse' });
  assert.equal(menus(m), 0);
  m.tap(500, 300, { pointerType: 'mouse', button: 2, buttons: 2 });
  assert.equal(menus(m), 1);
  assert.equal(m.press.menus[0].pointerType, 'mouse');
});

test('each mouse button has its own job: right-drag selects, middle-drag pans, the side buttons undo and redo', () => {
  const MOUSE = { pointerType: 'mouse' };
  const RIGHT = { ...MOUSE, button: 2, buttons: 2 }, MIDDLE = { ...MOUSE, button: 1, buttons: 4 };
  const r = rig({ items: D => [D.make.note({ x: 300, y: 200, w: 100, h: 100 }), D.make.note({ x: 500, y: 200, w: 100, h: 100 })] });
  const strokes = () => r.app.scene.items.filter(it => it.type === 'stroke').length;

  r.down(250, 150, RIGHT);
  r.drag([[400, 250], [650, 350]], { ...RIGHT, button: -1 });
  r.up(650, 350, RIGHT);
  assert.equal(r.app.selection.length, 2, 'the box took in both notes');
  assert.equal(menus(r), 0, 'a drag is not a click: no menu');
  assert.equal(r.app.toolName, 'pen', 'with the pen still out');
  assert.equal(strokes(), 0, 'and no ink');

  const cam = r.app.camera.toJSON();
  r.down(800, 600, MIDDLE);
  r.drag([[860, 640], [900, 700]], { ...MIDDLE, button: -1 });
  r.up(900, 700, MIDDLE);
  assert.notDeepEqual(r.app.camera.toJSON(), cam, 'the middle button moved the board');
  assert.equal(strokes(), 0);
  assert.equal(menus(r), 0);

  r.down(800, 600, MOUSE); r.drag([[850, 620], [900, 640]], { ...MOUSE, button: -1 }); r.up(900, 640, MOUSE);
  assert.equal(strokes(), 1, 'the left button draws');
  r.down(10, 10, { ...MOUSE, button: 3, buttons: 8 });
  assert.equal(strokes(), 0, 'back undoes');
  r.down(10, 10, { ...MOUSE, button: 4, buttons: 16 });
  assert.equal(strokes(), 1, 'forward redoes');
});

test('the wheel scrolls, or zooms when Settings say so; Ctrl always zooms', () => {
  const r = rig();
  const wheel = o => r.app.onWheel({ deltaX: 0, deltaY: 100, deltaMode: 0, clientX: 400, clientY: 300, preventDefault() {}, ...o });
  const z = r.app.camera.zoom;
  wheel({});
  assert.equal(r.app.camera.zoom, z, 'scrolls by default');
  wheel({ ctrlKey: true });
  assert.ok(r.app.camera.zoom < z, 'Ctrl zooms');
  r.app.opts.general.wheel = 'zoom';
  const z2 = r.app.camera.zoom;
  wheel({ deltaY: -100 });
  assert.ok(r.app.camera.zoom > z2, 'the plain wheel zooms');
  const z3 = r.app.camera.zoom;
  wheel({ shiftKey: true });
  assert.equal(r.app.camera.zoom, z3, 'Shift still scrolls');
});

test('holding on an item selects it, whatever the tool; putting the pen down again lets go', () => {
  const r = rig({ items: D => [D.make.note({ x: 400, y: 200, w: 190, h: 190, text: 'Units?' })] });
  const note = r.items[0];
  r.down(480, 280, PEN);
  r.clock.advance(delay);
  r.up(480, 280, PEN);
  assert.equal(r.app.toolName, 'pen', 'the pen is still out');
  assert.deepEqual([...r.app.selection], [note]);
  assert.equal(r.press.menus[0].hit, note);
  r.down(900, 600, PEN); r.drag([[930, 620]], PEN); r.up(930, 620, PEN);
  assert.deepEqual([...r.app.selection], [], 'writing elsewhere dropped the selection');
});

test('holding a drawing tool on a page or picture is about the board there, not the page', () => {
  const r = rig({ items: D => [D.make.image({ x: 100, y: 100, w: 600, h: 400, src: 'data:,' })] });
  const pic = r.items[0];
  r.down(300, 250, PEN);
  r.clock.advance(delay);
  r.up(300, 250, PEN);
  const ctx = r.press.menus[0];
  assert.equal(ctx.hit, pic, 'it is what was pressed on');
  assert.deepEqual([...ctx.selection], [], 'but it is not selected');
});

/* ── hold, then drag: a selection (issue #15) ─────────────────────── */
/* a note to box in, one to leave out, and a stroke under the first */
const board = D => [
  D.make.note({ x: 400, y: 200, w: 100, h: 100 }),
  D.make.note({ x: 800, y: 200, w: 100, h: 100 }),
  D.make.stroke({ pts: inked([420, 500, 480, 540]) })
];
/* hold at (x, y) until armed, then drag through pts and lift */
function holdDrag(r, x, y, pts, o) {
  r.down(x, y, o);
  r.clock.advance(delay);
  r.drag(pts, o);
  const [ex, ey] = pts[pts.length - 1];
  r.up(ex, ey, o);
}

test('a pen held, then dragged, draws a box from where it was held and selects what it encloses', () => {
  const r = rig({ items: board });
  const [inside, outside, stroke] = r.items;
  r.down(350, 150, PEN);
  r.clock.advance(delay);
  assert.deepEqual(r.press.locks, ['marquee']);
  r.drag([[362, 158], [450, 300]], PEN);
  assert.equal(r.app.active, r.app.tools.select, 'the select tool’s box, under the pen');
  assert.equal(r.app.active.mode, 'marquee');
  assert.deepEqual([r.app.active.start.x, r.app.active.start.y], [350, 150], 'from the press, not from where the drag began');
  r.drag([[560, 450], [600, 600]], PEN);
  r.clock.advance(1000);
  r.up(600, 600, PEN);
  assert.equal(menus(r), 0, 'a drag, so no menu');
  assert.deepEqual(new Set(r.app.selection), new Set([inside, stroke]));
  assert.ok(!r.app.selection.includes(outside));
  assert.equal(r.app.toolName, 'pen', 'the pen is still out');
  assert.equal(r.app.scene.items.length, 3, 'and left no ink');
  assert.equal(r.app.scene.undoStack.length, 0);
});

test('hold and drag draws a lasso when that is the choice: the select tool’s last mode, or the setting', () => {
  const r = rig({ items: board });
  const [inside] = r.items;
  r.app.setTool('lasso'); r.app.setTool('pen');
  assert.equal(r.app.opts.press.lastSelect, 'lasso', 'the select tool’s mode is remembered');
  r.down(380, 180, PEN);
  r.clock.advance(delay);
  assert.deepEqual(r.press.locks, ['lasso'], 'and the locked ring says so');
  r.drag([[395, 180], [520, 180], [520, 320], [380, 320], [380, 190]], PEN);
  assert.equal(r.app.active, r.app.tools.lasso);
  r.up(380, 190, PEN);
  assert.deepEqual([...r.app.selection], [inside], 'only what the loop went round');

  const s = rig({ items: board });
  s.app.setTool('lasso'); s.app.setTool('pen');
  s.app.opts.press.drag = 'box';
  holdDrag(s, 350, 150, [[362, 158], [600, 600]], PEN);
  assert.deepEqual(s.press.locks, ['marquee'], 'Box in settings wins over the tool');
  assert.equal(s.app.selection.length, 2);

  const t = rig({ items: board });
  t.app.opts.press.drag = 'lasso';
  t.down(380, 180, PEN); t.clock.advance(delay);
  assert.deepEqual(t.press.locks, ['lasso'], 'and Lasso does too');
});

test('held long enough that the menu opened, a drag still selects, and takes the menu away', () => {
  const r = rig({ items: board });
  let closed = 0;
  r.press.closeMenu = () => { closed++; };
  r.down(350, 150, PEN);
  r.clock.advance(delay + MENU_WAIT);
  assert.equal(menus(r), 1);
  r.drag([[362, 158], [600, 600]], PEN);
  assert.ok(closed >= 1, 'the menu closed as the drag began');
  r.up(600, 600, PEN);
  assert.equal(menus(r), 1, 'and no second one on the lift');
  assert.equal(r.app.selection.length, 2);
});

test('the pen moves a selection it made, from anywhere inside it, as one undo step; outside it draws and lets go', () => {
  const r = rig({ items: board });
  const [inside, , stroke] = r.items;
  holdDrag(r, 350, 150, [[362, 158], [600, 600]], PEN);
  r.clock.advance(500);
  r.down(450, 400, PEN);                               // a gap between the note and the stroke, inside the box
  r.drag([[460, 405], [480, 420], [500, 430]], PEN);
  r.up(500, 430, PEN);
  assert.deepEqual([inside.x, inside.y], [450, 230], 'moved by the drag');
  assert.deepEqual([stroke.pts[0], stroke.pts[1]], [470, 530], 'all of it');
  assert.deepEqual([...r.app.scene.undoStack.map(o => o.label)], ['move'], 'one step');
  assert.deepEqual(new Set(r.app.selection), new Set([inside, stroke]), 'still selected, to move again');
  assert.equal(r.app.scene.items.length, 3, 'no ink');
  r.app.undo();
  const back = r.app.scene.get(inside.id);
  assert.deepEqual([back.x, back.y], [400, 200], 'and one undo puts it all back');

  r.clock.advance(500);
  r.down(900, 600, PEN); r.drag([[930, 620], [960, 640]], PEN); r.up(960, 640, PEN);
  assert.deepEqual([...r.app.selection], [], 'outside: let go');
  assert.equal(r.app.scene.items.length, 4, 'and drew');
});

test('a selection from the long-press menu moves with the pen too', () => {
  const r = rig({ items: D => [D.make.note({ x: 400, y: 200, w: 190, h: 190 })] });
  const note = r.items[0];
  r.down(480, 280, PEN); r.clock.advance(delay); r.up(480, 280, PEN);
  assert.deepEqual([...r.app.selection], [note]);
  r.clock.advance(500);
  r.down(480, 280, PEN); r.drag([[500, 280], [540, 300]], PEN); r.up(540, 300, PEN);
  assert.deepEqual([note.x, note.y], [460, 220]);
  assert.equal(r.app.scene.items.length, 1);
});

test('a finger held, then dragged, selects too; then drags the selection, and pans from outside it', () => {
  const r = rig({ items: board });
  const [inside, , stroke] = r.items;
  holdDrag(r, 350, 150, [[370, 160], [600, 600]]);
  assert.deepEqual(new Set(r.app.selection), new Set([inside, stroke]));
  assert.deepEqual([r.app.camera.x, r.app.camera.y], [0, 0], 'the hold did not pan');
  r.clock.advance(500);
  r.down(450, 400); r.drag([[470, 400], [500, 420]]); r.up(500, 420);
  assert.deepEqual([inside.x, inside.y], [450, 220], 'a finger inside moves it');
  assert.deepEqual([r.app.camera.x, r.app.camera.y], [0, 0]);
  r.clock.advance(500);
  r.down(900, 700); r.move(912, 700);
  assert.equal(r.app.camera.x, 12, 'outside, a finger pans straight away');
  r.drag([[940, 700]]); r.up(940, 700);
  assert.equal(r.app.selection.length, 2, 'and keeps the selection');
});

test('held on a page, a drag gathers up the ink on it, not the page', () => {
  const r = rig({ items: D => [
    D.make.image({ x: 100, y: 100, w: 600, h: 400, src: 'data:,' }),
    D.make.stroke({ pts: inked([200, 200, 260, 240]) })
  ] });
  const [, ink] = r.items;
  holdDrag(r, 150, 150, [[165, 160], [300, 300]], PEN);
  assert.deepEqual([...r.app.selection], [ink]);
});

test('a drag that starts before the hold arms is the tool’s, as ever', () => {
  const r = rig({ items: board });
  r.down(350, 150, PEN);
  r.clock.advance(delay - 100);
  r.drag([[362, 158], [450, 300]], PEN);
  r.clock.advance(1000);
  r.up(450, 300, PEN);
  assert.equal(r.press.locks.length, 0);
  assert.deepEqual([...r.app.selection], []);
  assert.equal(r.app.scene.items.length, 4, 'it drew');
});

test('a second finger while armed is a pinch: no menu, no selection', () => {
  const r = rig({ items: board });
  r.down(350, 150, { pointerId: 1 });
  r.clock.advance(delay);
  assert.equal(r.press.locks.length, 1);
  r.down(500, 150, { pointerId: 2, isPrimary: false });
  r.drag([[380, 170]], { pointerId: 1 });
  r.up(380, 170, { pointerId: 1 });
  r.up(500, 150, { pointerId: 2, isPrimary: false });
  r.clock.advance(1000);
  assert.equal(menus(r), 0);
  assert.deepEqual([...r.app.selection], []);
});

/* ── taps ─────────────────────────────────────────────────────────── */
test('a pen double-tap on text edits it, and takes back the two dots it drew', () => {
  const r = rig({ items: D => [D.make.text({ x: 400, y: 200, text: 'Free body diagram', size: 24, w: 260 })] });
  const text = r.items[0];
  r.app.scene.begin('text'); r.app.scene.touch(text); text.text += '!'; r.app.scene.commit();
  r.tap(450, 212, PEN);
  r.clock.advance(120);
  r.tap(451, 213, PEN);
  assert.deepEqual([...r.edited], [text]);
  assert.deepEqual([...r.app.scene.items], [text], 'no dots left on it');
  assert.deepEqual([...r.app.scene.undoStack.map(o => o.label)], ['text'], 'nor in the history');
  assert.equal(r.app.scene.redoStack.length, 0);
  assert.equal(r.app.onDoubleClick({ clientX: 451, clientY: 213 }), false, 'the browser’s own dblclick for the same pair is ignored');
});

test('a pen double-tap that lands on nothing leaves its dots: that was a colon', () => {
  const r = rig();
  r.tap(450, 212, PEN);
  r.clock.advance(120);
  r.tap(451, 220, PEN);
  assert.equal(r.app.scene.items.length, 2);
  assert.equal(r.edited.length, 0);
});

test('a finger double-tap on a connector opens its label field', () => {
  const r = rig({ items: D => [D.make.edge({ from: { x: 100, y: 300 }, to: { x: 500, y: 300 } })] });
  const edge = r.items[0];
  r.tap(300, 302);
  r.clock.advance(150);
  r.tap(302, 300);
  assert.deepEqual([...r.press.labels], [edge]);
});

test('slow or far-apart taps are two taps, not a double', () => {
  const r = rig({ items: D => [D.make.text({ x: 400, y: 200, text: 'Moments', size: 24, w: 260 })] });
  const text = r.items[0];
  r.tap(450, 212); r.clock.advance(600); r.tap(450, 212);
  r.clock.advance(600);
  r.tap(450, 212); r.clock.advance(100); r.tap(520, 212);
  assert.equal(r.edited.length, 0);
});

test('with the select tool a finger taps to select, drags what is selected, and pans from anywhere else', () => {
  const r = rig({ tool: 'select', items: D => [D.make.note({ x: 400, y: 200, w: 190, h: 190, text: 'Drag me' })] });
  const note = r.items[0];
  r.tap(480, 280);
  assert.deepEqual([...r.app.selection], [note], 'a tap selected it');
  r.clock.advance(500);
  r.down(480, 280);
  r.drag([[500, 280], [540, 290]]);
  r.up(540, 290);
  assert.deepEqual([note.x, note.y], [460, 210], 'the finger moved it');
  assert.deepEqual([r.app.camera.x, r.app.camera.y], [0, 0], 'and did not pan');
  r.clock.advance(500);
  r.down(900, 600); r.drag([[930, 600]]); r.up(930, 600);
  assert.equal(r.app.camera.x, 30, 'off the selection, a finger still pans');
  assert.deepEqual([...r.app.selection], [note], 'and panning keeps the selection');
  r.clock.advance(500);
  r.tap(1000, 700);
  assert.deepEqual([...r.app.selection], [], 'a tap on bare board lets go');
});

test('with a drawing tool a finger tap never selects', () => {
  const r = rig({ items: D => [D.make.note({ x: 400, y: 200, w: 190, h: 190 })] });
  const note = r.items[0];
  r.tap(480, 280);
  assert.deepEqual([...r.app.selection], []);
});

test('coarse follows whatever pressed last', () => {
  const r = rig();
  r.tap(100, 100, { pointerType: 'mouse', pointerId: 3 });
  assert.equal(r.app.coarse, false);
  assert.equal(r.app.hitPx(), 8);
  r.clock.advance(500);
  r.tap(100, 100);
  assert.equal(r.app.coarse, true);
  assert.equal(r.app.hitPx(), 16);
  assert.ok(r.app.handlePad('touch') > r.app.handlePad('mouse'));
});

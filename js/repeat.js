/* ── repeat.js ── copies in a row, or round a centre ───────────────────
   A bolt circle, a row of rungs, the teeth of a gear: Repeat (in the
   style panel under Arrange, or the long-press menu) makes copies of the
   selection, as one undo step.

   In a row: so many copies, each the same step across and down from the
   one before — the step starts as the selection's own width and a gap,
   so the copies sit side by side. Round a centre: so many copies spread
   over an angle (a whole turn shares them out evenly, with none on top
   of the first), turned with it about a centre that is the middle of the
   selection unless one is picked on the board — tap "Pick the centre",
   then the centre of the flange, say; it snaps.

   Copies keep their attachments among themselves (D.cloneSet), and are
   selected afterwards, the originals with them.

   D.repeat.run(app, o) → copies   o: { mode: 'row' | 'round', count,
     dx, dy (board units), angle (degrees, anticlockwise), centre }       */
(function (D) {
  'use strict';
  const U = D.util;
  const el = (tag, attrs, ...kids) => U.el(tag, attrs, ...kids);
  const ICON = 'M3.5 8.5h5v5h-5z|M10 8.5h5v5h-5z|M16.5 8.5h4v5h-4|M3.5 17.5h17';

  D.ext.opts.repeat = { mode: 'row', count: 3, angle: 360, gap: 20, dx: null, dy: 0 };

  let centre = null;               // a centre picked on the board, for the selection it was picked for
  let picking = false;
  let open = false;                // the panel group shown
  let stepFor = null;              // the selection the row's step was worked out for

  function run(app, o) {
    const sel = app.selection.slice();
    if (!sel.length || !(o.count >= 1)) return [];
    const n = Math.min(500, Math.round(o.count)), made = [];
    const scene = app.scene;
    scene.begin('repeat');
    for (let i = 1; i <= n; i++) {
      const { copies } = D.cloneSet(sel);
      for (const c of copies) {
        scene.add(c);
        if (o.mode === 'round') {
          // a whole turn shares the copies out with none on the first; part of one, from end to end
          const full = Math.abs(Math.abs(o.angle) - 360) < 1e-9;
          const step = o.angle / (full ? n + 1 : n);
          scene.rotateItem(c, o.centre, -i * step * Math.PI / 180);
        } else scene.translate(c, i * o.dx, i * o.dy);
        made.push(c);
      }
    }
    scene.commit();
    app.select([...sel, ...made]);
    app.afterEdit();
    return made;
  }

  /** where the copies turn about: the one picked, or the middle of the selection */
  function centreFor(app) {
    if (centre && centre.for === key(app.selection)) return centre;
    const f = app.selectionFrame();
    return f ? { x: f.cx, y: f.cy, picked: false } : null;
  }
  const key = sel => sel.map(i => i.id).join(',');

  /* the panel group, after Arrange */
  function group(ui, sel) {
    const app = ui.app, o = app.opts.repeat;
    if (!sel.length) return null;
    if (!open) return ui.group('', el('button', { class: 'btn', type: 'button', onclick: () => { open = true; ui.buildPanel(); } }, 'Repeat…'));
    const b = app.selectionBounds(), C = D.cad, S = C ? C.scaleOf(app.scene) : { k: 1, unit: '', prec: 1 };
    if (o.dx == null || stepFor !== key(sel)) { o.dx = b.w + (o.gap || 20); o.dy = 0; stepFor = key(sel); }
    const len = (label, v, set) => ui.num(label, v * S.k, { unit: S.unit, prec: S.prec, step: C ? C.stepFor(Math.max(b.w, b.h) * S.k) : 1, set: x => set(x / S.k) });
    const c = centreFor(app);
    const rows = [
      ui.seg([['row', 'In a row'], ['round', 'In a circle']], o.mode, v => { o.mode = v; }),
      ui.num('Copies', o.count, { prec: 0, step: 1, min: 1, max: 500, set: v => { o.count = Math.round(v); } })
    ];
    if (o.mode === 'row') rows.push(el('div', { class: 'num-pair' }, len('Across', o.dx, v => { o.dx = v; }), len('Down', -o.dy, v => { o.dy = -v; })));
    else {
      rows.push(ui.num('Over', o.angle, { unit: '°', prec: 2, step: 15, min: -360, max: 360, set: v => { o.angle = v; } }));
      rows.push(el('div', { class: 'actions' },
        el('button', { class: 'btn' + (picking ? ' primary' : ''), type: 'button', onclick: () => { picking = !picking; ui.buildPanel(); app.requestDrawLive(); } },
          picking ? 'Tap the centre…' : c && c.picked ? 'Centre picked ✓' : 'Pick the centre')));
    }
    rows.push(el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => {
        const cc = centreFor(app);
        run(app, { mode: o.mode, count: o.count, dx: o.dx, dy: o.dy, angle: o.angle, centre: cc });
        picking = false;
      } }, 'Make copies'),
      el('button', { class: 'btn', type: 'button', onclick: () => { open = false; picking = false; ui.buildPanel(); app.requestDrawLive(); } }, 'Close')));
    return ui.group('Repeat', ...rows);
  }

  /* picking the centre: the next press on the board, snapped */
  D.ext.routes.push((app, e) => {
    if (!picking || e.button > 0 || !app.selection.length) return null;
    return {
      down(ev) {
        const s = D.cad ? D.cad.snap(app, ev.x, ev.y, {}) : { x: ev.x, y: ev.y };
        centre = { x: s.x, y: s.y, picked: true, for: key(app.selection) };
        picking = false;
      },
      move() { }, cancel() { },
      up() { if (app.ui) app.ui.buildPanel(); app.requestDrawLive(); }
    };
  });

  /* the centre, marked while there is one to turn about */
  D.ext.on('frame', (app, ctx) => {
    const o = app.opts.repeat;
    if (!open || o.mode !== 'round' || !app.selection.length) return;
    const c = centreFor(app);
    if (!c) return;
    const p = app.camera.toScreen(c.x, c.y);
    ctx.save();
    ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.moveTo(p.x - 12, p.y); ctx.lineTo(p.x + 12, p.y); ctx.moveTo(p.x, p.y - 12); ctx.lineTo(p.x, p.y + 12);
    ctx.stroke();
    ctx.restore();
  });
  D.ext.on('select', (app, items) => { if (!items.length) { picking = false; } });

  D.ext.pressActions.push({ id: 'repeat', label: 'Repeat…', icon: ICON, order: 30,
    when: ctx => ctx.source === 'menu' && ctx.selection.length > 0,
    run: ctx => { open = true; if (ctx.app.ui) ctx.app.ui.buildPanel(); } });

  D.repeat = { run, group, centreFor };
})(window.DPO);

/* ── style.js ── copy one thing's look onto others ──────────────────────
   "Copy style" on the long-press menu, the action bar or Ctrl+Alt+C takes
   the colour, weight, dash, fill, heads and the like of what is selected;
   "Paste style" (Ctrl+Alt+V) puts it on whatever is selected next, as one
   undo step — a format painter, so ten arrows can be made to match the
   one that is right without setting each by hand.

   What carries over depends on what it lands on. Between things of the
   same kind, everything in STYLE does. Across kinds, only what means the
   same on both: an ink colour is not a sticky note's paper, and a text
   box's size is a font size, not a stroke's width.

   D.style.copy(app, item)        keep item's look; false if it has none
   D.style.paste(app, items)      put it on items; how many changed
   D.style.held()                 what is kept, or null                  */
(function (D) {
  'use strict';
  const ICON_COPY = 'M5 20l3.5-1L19 8.5 16.5 6 6 16.5z|M14.5 8l2.5 2.5|M4 4h6|M7 1.5v5';
  const ICON_PASTE = 'M5 20l3.5-1L19 8.5 16.5 6 6 16.5z|M14.5 8l2.5 2.5|M3 7.5l2 2 3.5-4';

  /* what makes up each kind's look */
  const STYLE = {
    stroke: ['color', 'size', 'alpha', 'thinning', 'blend', 'taper'],
    shape: ['color', 'fill', 'hatch', 'size', 'alpha', 'dash', 'radius', 'head1', 'head2', 'headScale'],
    text: ['color', 'size', 'font', 'align', 'alpha'],
    note: ['color', 'size', 'align', 'textColor', 'alpha'],
    node: ['color', 'fill', 'size', 'textSize', 'textColor', 'align', 'alpha'],
    edge: ['color', 'size', 'dash', 'style', 'arrowEnd', 'arrowStart', 'alpha'],
    symbol: ['color', 'size', 'textSize', 'alpha']
  };
  const OTHER = ['color', 'size', 'alpha'];
  /* whose `color` is an ink, and whose `size` a line's width */
  const INKY = new Set(['stroke', 'shape', 'text', 'node', 'edge', 'symbol', 'dim', 'graph']);
  const WIDTH = new Set(['stroke', 'shape', 'node', 'edge', 'symbol']);

  const keysOf = it => STYLE[it.type] || OTHER;
  const lineish = it => D.isLine(it) || (it.type === 'shape' && it.kind === 'moment');

  const copyOf = v => v && typeof v === 'object' ? D.clone(v) : v;

  let held = null;               // { type, kind, open, style }

  function copy(app, it) {
    if (!it || it.type === 'image' || it.type === 'pdfpage') return false;
    const style = {};
    for (const k of keysOf(it)) if (it[k] !== undefined) style[k] = copyOf(it[k]);
    if (!Object.keys(style).length) return false;
    held = { type: it.type, open: lineish(it), style };
    return true;
  }

  /** whether key k of the held style means the same on `it` */
  function carries(k, it) {
    if (!keysOf(it).includes(k)) return false;
    if (k === 'head1' || k === 'head2' || k === 'headScale') return lineish(it) && held.open;
    if (k === 'radius') return it.type === 'shape' && it.kind === 'rect';
    if (k === 'fill' || k === 'hatch') return !lineish(it);
    if (held.type === it.type) return true;
    if (k === 'color') return INKY.has(held.type) && INKY.has(it.type);
    if (k === 'size') return WIDTH.has(held.type) && WIDTH.has(it.type);
    return k === 'alpha' || k === 'dash';
  }

  function paste(app, items) {
    if (!held || !items.length) return 0;
    let n = 0;
    app.scene.begin('paste style');
    for (const it of items) {
      const ks = Object.keys(held.style).filter(k => carries(k, it) && JSON.stringify(it[k]) !== JSON.stringify(held.style[k]));
      if (!ks.length) continue;
      app.scene.touch(it);
      for (const k of ks) it[k] = copyOf(held.style[k]);
      n++;
    }
    app.scene.commit();
    if (n) app.afterEdit();
    return n;
  }

  function copySelection(app) {
    const sel = app.selection.filter(i => i.type !== 'image' && i.type !== 'pdfpage');
    if (sel.length && copy(app, sel[0])) app.flash('Style copied');
  }
  function pasteSelection(app) {
    if (!held) { app.flash('Copy a style first'); return; }
    const n = paste(app, app.selection);
    app.flash(n ? 'Style pasted' : 'Already that style');
  }

  D.ext.pressActions.push(
    {
      id: 'style-copy', label: 'Copy style', icon: ICON_COPY, order: 20,
      when: ctx => ctx.selection.length >= 1 && ctx.selection.some(i => i.type !== 'image' && i.type !== 'pdfpage'),
      run: ctx => copySelection(ctx.app)
    },
    {
      id: 'style-paste', label: 'Paste style', icon: ICON_PASTE, order: 21,
      when: ctx => !!held && ctx.selection.length >= 1,
      run: ctx => pasteSelection(ctx.app)
    }
  );

  D.ext.on('key', (app, e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey || !app.selection.length) return false;
    const k = (e.key || '').toLowerCase();
    if (k === 'c' || e.code === 'KeyC') { e.preventDefault(); copySelection(app); return true; }
    if (k === 'v' || e.code === 'KeyV') { e.preventDefault(); pasteSelection(app); return true; }
    return false;
  });

  D.style = { copy, paste, held: () => held, STYLE };
})(window.DPO);

/* ── present.js ── step through the pages full screen ─────────────────
   Present (F5, the Pages list, or the long-press menu on the board) fills
   the screen with the page in view and hides everything else, with the
   laser pointer in hand. The arrow keys, Page Up and Down, Space and
   Enter step through the pages in their order (D.frames.sheets), as do
   the arrows that show in the corner when the pointer moves; Escape, or
   leaving full screen, ends it and puts the view and the tool back. A
   board with no pages is shown whole, as one slide.

   D.present.start(app, fromPage) / stop(app) / active()                */
(function (D) {
  'use strict';
  const U = D.util;
  const el = (tag, attrs, ...kids) => U.el(tag, attrs, ...kids);
  const ICON = 'M3.5 4.5h17v11h-17z|M12 15.5v4|M8 19.5h8|M10 8l4.5 2.5L10 13z';

  let show = null;                 // { pages, i, view, tool, bar, count, hideT }

  function fitNow(app) {
    if (!show) return;
    const f = show.pages[show.i];
    const box = f ? U.box(f.x, f.y, f.x + f.w, f.y + f.h) : app.scene.contentBounds() || U.box(0, 0, 800, 600);
    app.camera.fit(box, innerWidth, innerHeight, f ? 8 : 40);
    app.requestDraw(); app.requestDrawLive();
    show.count.textContent = show.pages.length ? `${show.i + 1} / ${show.pages.length}` : '';
  }
  function go(app, by) {
    if (!show || !show.pages.length) return;
    show.i = U.clamp(show.i + by, 0, show.pages.length - 1);
    fitNow(app);
  }
  function to(app, i) { if (show && show.pages.length) { show.i = U.clamp(i, 0, show.pages.length - 1); fitNow(app); } }

  function start(app, from) {
    if (show) return;
    const pages = D.frames ? D.frames.sheets(app.scene) : [];
    const at = from || (D.frames && pages.length ? D.frames.current(app) : null);
    const btn = (title, text, onclick) => el('button', { class: 'pr-btn', type: 'button', title, 'aria-label': title, onclick }, text);
    const count = el('span', { class: 'pr-count' });
    const bar = el('div', { class: 'present-bar' },
      btn('Previous page · ←', '‹', () => go(app, -1)), count, btn('Next page · →', '›', () => go(app, 1)),
      btn('End the presentation · Esc', '✕', () => stop(app)));
    show = { pages, i: Math.max(0, pages.indexOf(at)), view: { x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom }, tool: app.toolName, bar, count, hideT: 0 };
    document.body.append(bar);
    document.body.classList.add('presenting');
    app.select([]);
    if (app.tools.laser) app.setTool('laser');
    try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => { }); } catch (_) { }
    nudge();
    fitNow(app);
    if (!pages.length) app.toast('No pages on this board, so it is shown whole');
  }

  function stop(app) {
    if (!show) return;
    const s = show;
    show = null;
    clearTimeout(s.hideT);
    s.bar.remove();
    document.body.classList.remove('presenting');
    if (document.fullscreenElement && document.exitFullscreen) { try { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => { }); } catch (_) { } }
    app.camera.x = s.view.x; app.camera.y = s.view.y; app.camera.zoom = s.view.zoom;
    if (s.tool && app.tools[s.tool]) app.setTool(s.tool);
    app.requestDraw(); app.requestDrawLive();
    if (app.ui) app.ui.refresh();
  }

  /* Everything round the page is blacked out, as a projector shows it:
     the next page down, and the page's name above it, are not part of
     the slide. */
  D.ext.on('frame', (app, ctx) => {
    if (!show) return;
    const f = show.pages[show.i];
    if (!f) return;
    const a = app.camera.toScreen(f.x, f.y), e = app.camera.toScreen(f.x + f.w, f.y + f.h);
    const W = innerWidth, H = innerHeight;
    ctx.save();
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(0, 0, W, Math.max(0, a.y));
    ctx.fillRect(0, e.y, W, Math.max(0, H - e.y));
    ctx.fillRect(0, a.y, Math.max(0, a.x), e.y - a.y);
    ctx.fillRect(e.x, a.y, Math.max(0, W - e.x), e.y - a.y);
    ctx.restore();
  });

  /* the corner arrows show while the pointer moves, and fade after */
  function nudge() {
    if (!show) return;
    show.bar.classList.add('shown');
    clearTimeout(show.hideT);
    show.hideT = setTimeout(() => { if (show) show.bar.classList.remove('shown'); }, 2200);
  }

  D.ext.on('key', (app, e) => {
    if (e.key === 'F5' && !show) { e.preventDefault(); start(app); return true; }
    if (!show) return false;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); stop(app); return true; }
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'n') { e.preventDefault(); go(app, 1); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p') { e.preventDefault(); go(app, -1); return true; }
    if (k === 'Home') { e.preventDefault(); to(app, 0); return true; }
    if (k === 'End') { e.preventDefault(); to(app, Infinity); return true; }
    return false;
  });

  if (typeof addEventListener === 'function') {
    addEventListener('pointermove', () => nudge(), { passive: true });
    addEventListener('resize', () => { if (show && D.app) fitNow(D.app); });
    document.addEventListener('fullscreenchange', () => { if (show && !document.fullscreenElement && show.wasFull && D.app) stop(D.app); else if (show && document.fullscreenElement) show.wasFull = true; });
  }
  D.ext.on('board', app => stop(app));

  D.ext.pressActions.push({ id: 'present', label: 'Present', icon: ICON, order: 90,
    when: ctx => ctx.source === 'menu' && !ctx.selection.length, run: ctx => start(ctx.app, ctx.hit && (ctx.hit.type === 'frame' || ctx.hit.type === 'pdfpage') ? ctx.hit : null) });

  D.present = { start, stop, active: () => !!show, page: () => show && show.i };
})(window.DPO);

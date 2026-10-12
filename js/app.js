/* ── app.js ── wiring: input, tools, selection, files ─────────────── */
(function (D) {
  'use strict';
  const U = D.util, mk = D.make, $ = U.$;

  class App {
    constructor() {
      this.scene = new D.Scene();
      this.camera = new D.Camera();
      this.renderer = new D.Renderer(this);
      this.editor = new D.TextEditor(this);
      this.perf = D.Perf ? new D.Perf(this) : null;   // ?perf or Ctrl+Shift+P
      this.selection = [];
      this.clipboard = [];
      this.pointer = null;
      this.pointers = new Map();
      this.spaceDown = false;
      this.hoverEraser = false;      // the stylus eraser end is in range
      this.needBase = true;
      this.needLive = true;
      this.anim = false;

      this.opts = {
        general: { holdToSnap: true, scribbleErase: true, snapGrid: false, touchPan: true, stickyTools: true },
        pen: { color: 'ink', size: 3, alpha: 1, thinning: 0.6 },
        highlighter: { color: '#ffe066', size: 22, alpha: 0.4 },
        eraser: { mode: 'object', size: 26 },
        shape: { kind: 'rect', color: 'ink', size: 3, alpha: 1, fill: 'none', dash: 0, radius: 10 },
        text: { color: 'ink', size: 20, font: 'sans', align: 'left' },
        note: { color: '#ffe58a', size: 16 },
        node: { kind: 'process', color: 'ink', fill: 'paper', size: 2, textSize: 15 },
        edge: { color: '#5b6472', size: 2, style: 'elbow', dash: 0, arrowEnd: true, arrowStart: false },
        /* How PNG and SVG exports look (Settings → Export). 'auto' follows
           the theme on screen; a transparent background leaves just the
           work, to sit on a slide or a page of any colour. */
        export: { theme: 'auto', background: 'transparent' }
      };
      /* What features add (ext.js). Before start() lays the saved prefs
         over the top, so a feature's options are remembered like the rest
         — deepAssign only fills keys that already exist. */
      fillIn(this.opts, D.ext.opts);

      const T = D.tools;
      this.tools = {
        select: new T.SelectTool(this, false),
        lasso: new T.SelectTool(this, true),
        pen: new T.PenTool(this, 'pen'),
        highlighter: new T.PenTool(this, 'highlighter'),
        eraser: new T.EraserTool(this),
        shape: new T.ShapeTool(this),
        text: new T.TextTool(this),
        note: new T.NoteTool(this),
        node: new T.NodeTool(this),
        connector: new T.ConnectorTool(this),
        laser: new T.LaserTool(this),
        pan: new T.PanTool(this)
      };
      for (const t of D.ext.tools) this.tools[t.name] = t.create(this);
      this.toolName = 'pen';
      this.tool = this.tools.pen;

      this.scene.onchange = () => { this.needBase = true; this.schedule(); };
      this.tree = new Tree(this);
      this.taps = new D.Taps(this);       // two fingers tap to undo, three to redo

      /* Pen and touch on their own, with no keyboard and no right button
         (press.js has the menu and the bar). `coarse` says the last thing
         to press was a finger or a pen, so the painter and the select
         tool can make their targets bigger; hitPx and handlePad are the
         sizes to use, so everything agrees on what "on it" means. */
      this.pointerType = self.matchMedia && matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
      this.coarse = this.pointerType !== 'mouse';
      this.hold = new D.Hold({
        ring: h => { if (this.press) this.press.ring(h); },
        abort: () => { if (this.press) this.press.unring(); },
        fire: h => this.onHold(h)
      });
      this.tap = null;          // the contact that may yet turn out to be a tap
      this.lastTap = null;      // the tap before it, for a double-tap
      this.press = null;        // the menu and the action bar, once the UI is up
    }

    /* ── boot ─────────────────────────────────────────────────────── */
    async start() {
      await D.store.init();
      const prefs = await D.store.prefs();
      if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;
      else document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      if (prefs.grid) this.renderer.grid = prefs.grid;
      if (prefs.opts) deepAssign(this.opts, prefs.opts);
      /* touchPan was once palmReject, which only panned once a pen had
         been seen. Someone who turned that off wanted their finger to
         draw, so carry the answer over rather than the question. */
      const g = this.opts.general;
      if (g.touchPan === undefined && g.palmReject !== undefined) g.touchPan = g.palmReject;
      delete g.palmReject;
      this.syncThemeInk();

      const params = new URLSearchParams(location.search);

      /* ?embed — the board is a panel inside someone else's page rather
         than the whole window, so the chrome that assumes a full window
         steps aside. See the [data-embed] rules in css/app.css. */
      if (params.has('embed')) document.documentElement.dataset.embed = '1';

      /* ?board=<id> — a host application (the Obsidian plugin) opening a
         specific board in this frame. It wins over "whatever was open
         last", which is per-profile state and means nothing when the
         host is the one deciding what to show. */
      const asked = params.get('board');
      let board = asked && await D.store.load(asked);

      /* The host may name a board that does not exist yet: opening a PDF
         for the first time asks for the annotation board belonging to
         it. Create it under exactly that id rather than a fresh random
         one, or the pairing is lost the moment the tab is closed. */
      if (!board && asked) {
        board = D.store.newBoard(params.get('name') || 'Untitled board');
        board.id = asked;
        /* Where the host wants the file kept, if it cares — a PDF board
           lives beside its PDF rather than in the boards folder. */
        const file = params.get('file');
        if (file) board.file = file;
        await D.store.save(board);
      }

      const lastId = board ? null : await D.store.lastId();
      if (!board) board = lastId && await D.store.load(lastId);
      if (!board) {
        const list = await D.store.list();
        board = list[0] && await D.store.load(list[0].id);
      }
      if (!board) { board = D.store.newBoard('My first board'); await D.store.save(board); }

      // replay anything the last session did not get to write
      const rescued = readRescue();
      if (rescued && (!board || rescued.id === board.id) && rescued.updated > (board.updated || 0)) {
        const gained = rescued.doc.items.length - (board.doc.items.length || 0);
        board = rescued;
        await D.store.save(board);
        setTimeout(() => this.toast(gained > 0 ? `Recovered ${gained} unsaved item${gained > 1 ? 's' : ''}` : 'Recovered unsaved changes'), 600);
      }
      clearRescue();
      this.setBoard(board);

      this.ui = new D.UI(this);
      if (D.Press) this.press = new D.Press(this);
      this.bindInput();
      this.bindHostMessages();
      this.setTool('pen');
      this.requestDraw();
      this.ui.refresh();
      this.ui.restoreFolds();      // the panels you had folded away last time
      const moved = D.store.migrated;
      if (moved) setTimeout(() => this.toast(`Moved ${moved} board${moved > 1 ? 's' : ''} into the vault`), 800);
      this.registerServiceWorker();
      // after the board is up and any toast about it has had its turn
      if (D.desktop.on && D.desktop.autoUpdate) setTimeout(() => this.offerUpdate(), 6000);

      /* ?pdf=<host path> — this board exists to annotate that document.
         Attached after the UI is up so the progress toasts are visible
         on a long one. */
      const pdf = params.get('pdf');
      if (pdf) await this.openHostPdf(pdf, params.get('name') || pdf, params.get('page'));

      /* Tell the host we are up. A deep link like #page=3 is delivered to
         the view long before this frame has finished booting, so the host
         cannot simply post the page and hope: it waits for this and then
         sends whatever it is holding. */
      if (parent !== self) parent.postMessage({ channel: 'dpo-view', op: 'ready' }, '*');
      D.ext.emit('ready', this);
    }

    /** lets the board be installed as a standalone app, and opened offline */
    registerServiceWorker() {
      // only meaningful for the browser build: the desktop app already has
      // the files locally, and tauri:// cannot host a worker
      if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
      navigator.serviceWorker.register('sw.js').catch(() => { });
      addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        this.installPrompt = e;
        const b = $('#act-install');
        b.hidden = false;
        b.onclick = async () => {
          b.hidden = true;
          this.installPrompt.prompt();
          await this.installPrompt.userChoice;
          this.installPrompt = null;
        };
      });
    }

    setBoard(board) {
      if (this.board && this.board.id !== board.id) { D.pdf.clear(); this.renderer.forgetPictures(); this._assets = new Map(); }
      this.board = board;
      this.scene.load(board.doc);
      this.movePicturesOut();
      this.camera.load(readView(board.id) || board.camera);
      $('#board-title').value = board.name;
      this.selection = [];
      if (this.press) this.press.reset();
      D.store.setLast(board.id);
      this.requestDraw();
      if (this.ui) this.ui.refresh();
      this.warmSave();
      D.ext.emit('board', this, board);
    }

    /* Get the board's saved text ready while the pen is idle, so the first
       autosave after opening a big board is as quick as every later one
       (Scene.docText). */
    warmSave() {
      if (!self.requestIdleCallback || this._warmJob) return;
      const scene = this.scene;
      const step = deadline => {
        this._warmJob = null;
        if (this.scene !== scene) return;
        if (this.active) { this._warmJob = requestIdleCallback(step); return; }
        if (!scene.warmText(deadline)) this._warmJob = requestIdleCallback(step);
      };
      this._warmJob = requestIdleCallback(step);
    }

    /* ── updates (desktop app) ────────────────────────────────────── */
    /* Quietly: an offline start, or GitHub being unreachable, is not worth
       interrupting anyone over. Settings → Check now says so out loud. */
    async offerUpdate() {
      let u = null;
      try { u = await D.desktop.checkUpdate(); } catch (err) { console.warn('[dpo] update check', err); }
      if (u) this.ui.toast(`Version ${u.version} is available`, 'Update', () => this.installUpdate(u), 15000);
    }

    async installUpdate(u) {
      this.ui.closeSettings();
      this.ui.toast(`Downloading version ${u.version}… the app restarts when it is done`, null, null, 60000);
      await this.saveNow(true);     // the installer closes the app underneath us
      try { await D.desktop.installUpdate(); }
      catch (err) { this.toast('The update did not install: ' + err); }
    }

    /* ── frame loop ───────────────────────────────────────────────── */
    schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this.frame(); });
    }
    requestDraw() { this.needBase = true; this.needLive = true; this.schedule(); }
    /* Only the camera's position changed: the scene layer may shift what
       it already has instead of repainting (Renderer.scrollFrom). Anything
       else asking for a draw in the same frame still gets a full one. */
    requestPan() { this.needPan = true; this.needLive = true; this.schedule(); }
    /* A zoom in progress (the wheel, a pinch): the scene layer may scale
       the last sharp picture rather than repaint, and paints it properly
       once the zoom stops (Renderer.drawZoom). */
    requestZoom() { this.needZoom = true; this.needLive = true; this.schedule(); }

    /**
     * Pan by a screen distance, in whole device pixels.
     *
     * Moves that land on the device-pixel grid are what let a pan shift
     * the picture already painted instead of repainting it. The part of
     * each move that does not fit is carried into the next, so the board
     * still follows the pointer to within half a device pixel.
     */
    panScreen(dx, dy) {
      const d = this.renderer.dpr, rest = this._panRest || (this._panRest = { x: 0, y: 0 });
      const tx = dx + rest.x, ty = dy + rest.y;
      const qx = Math.round(tx * d) / d, qy = Math.round(ty * d) / d;
      rest.x = tx - qx; rest.y = ty - qy;
      this.camera.panBy(qx, qy);
      this.requestPan();
    }
    requestDrawLive() { this.needLive = true; this.schedule(); }
    startAnim() { this.anim = true; this.schedule(); }
    stopAnim() { this.anim = false; }

    frame() {
      const r = this.renderer;
      if (this.perf) this.perf.frameStart();
      if (this.needBase || this.needPan || this.needZoom) {
        const full = this.needBase, zoom = this.needZoom && !full;
        this.needBase = this.needPan = this.needZoom = false;
        if (zoom) r.drawZoom(); else r.drawScene(!full);
        if (this.perf) {
          this.perf.drawn = r.lastDrawn;
          this.perf.simplified = r.lastSimplified;
          this.perf.batches = r.lastBatches;
          this.perf.mark('base');
        }
        /* drawScene is what tells the PDF layer which pages are on
           screen, so the sweep belongs directly after it: any page not
           asked for during that pass has scrolled away, and its queued
           or in-flight render is now wasted work. */
        if (D.pdf && D.pdf.sweep) D.pdf.sweep();
      }
      if (this.needLive || this.anim) {
        this.needLive = false;
        /* Paint whatever is actually driving the pointer, not whatever is
           lit up in the tool rail. They differ whenever the input picks the
           tool for you — a middle-drag pans, and the blunt end of the
           stylus erases — and the eraser is the case you can see, because
           it is the one that draws a cursor. */
        const t = this.active || this.tool;
        if (t.incremental && t.item) t.paint(r);
        else {
          r.clearLive();
          this.selBox = this.selection.length ? r.drawSelection(this.selection, { handles: !this.editor.active }) : null;
          /* The selected tool still gets a turn underneath when something
             else has taken the pointer: the laser trail goes on fading
             while you middle-drag the page around. */
          if (this.tool !== t && this.tool.paint) this.tool.paint(r);
          if (t.paint) t.paint(r);
          /* Hovering the eraser end, nothing erased yet. Held space wins over
             the stylus on the way down, so the ring must not promise an erase
             that a press would turn into a pan. */
          if (!this.active && this.hoverEraser && !this.spaceDown && t !== this.tools.eraser)
            this.tools.eraser.paint(r);
          /* The action bar follows the selection here, on the frames that
             already repaint it — never on the ones the pen is appending
             ink on, which return above without getting this far. */
          if (this.press) this.press.frame();
          /* Features' overlays (ext.js), last and in screen space. A tool's
             paint can leave alpha or blending set, so they start clean. */
          if (D.ext.has('frame')) {
            const ctx = r.liveScreen();
            ctx.save();
            ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
            D.ext.emit('frame', this, ctx);
            ctx.restore();
          }
        }
        if (this.perf) this.perf.mark('live');
      }
      if (this.editor.active) this.editor.place();
      if (this.perf) this.perf.frameEnd();
      /* The counter keeps the loop ticking so its readout stays live, but
         through its own flag: `anim` belongs to the laser trail, and the
         two would otherwise switch each other off. */
      if (this.anim || (this.perf && this.perf.on)) this.schedule();
    }

    /**
     * Show a document the host owns, and put the view on `page`.
     *
     * The asset id is `vault:<path>` rather than a copy: the host reads
     * those straight off disk, so annotating a 15MB lecture set costs a
     * few kilobytes of strokes instead of a second copy of the PDF. It
     * also means editing or replacing the PDF is reflected here.
     *
     * Idempotent, because this runs on every open of the board and the
     * pages are already in the scene on the second and later visits.
     */
    async openHostPdf(path, label, page) {
      const asset = 'vault:' + path;
      let pages = this.scene.items.filter(i => i.type === 'pdfpage' && i.asset === asset);

      if (!pages.length) {
        await D.pdf.attach(this, asset, label, { x: 0, y: 0 });
        pages = this.scene.items.filter(i => i.type === 'pdfpage' && i.asset === asset);
        /* Save immediately: the layout is the expensive part, and a
           crash before the first autosave would redo all of it. */
        await this.saveNow(true);
      }
      if (!pages.length) return;

      /* Honour a #page=N deep link, which is how the rest of the vault
         already points into PDFs. Page numbers are 1-based and come from
         a URL, so they cannot be trusted to be in range. */
      const n = Math.max(1, Math.min(pages.length, parseInt(page, 10) || 1));
      this.fitToBox(this.scene.bbox(pages.find(p => p.page === n) || pages[0]));
      this.requestDraw();
      this.ui.refresh();
    }

    /** Put the view on page `n` of whatever document is on this board. */
    gotoPage(n) {
      const pages = this.scene.items
        .filter(i => i.type === 'pdfpage')
        .sort((a, b) => a.page - b.page);
      if (!pages.length) return;
      const want = Math.max(1, Math.min(pages.length, Number(n) || 1));
      this.fitToBox(this.scene.bbox(pages.find(p => p.page === want) || pages[0]));
      this.requestDraw();
      this.ui.refresh();
    }

    /**
     * Commands from the host view, as opposed to storage replies.
     *
     * A page jump is a message rather than a reload of the frame: the
     * document is already rendered here, and reloading to move the
     * viewport would discard that and any stroke not yet saved.
     */
    bindHostMessages() {
      addEventListener('message', e => {
        const m = e.data;
        if (!m || m.channel !== 'dpo-view') return;
        if (m.op === 'page') this.gotoPage(m.page);
      });
    }

    /** Sit the camera so `b` fills the view, with a margin. */
    fitToBox(b, margin = 40) {
      const w = Math.max(1, innerWidth - margin * 2);
      const h = Math.max(1, innerHeight - margin * 2);
      /* Cap at 1: a single page is usually smaller than the window, and
         magnifying it on open would be disorienting. */
      const zoom = Math.min(1, w / Math.max(1, b.w), h / Math.max(1, b.h));
      this.camera.zoom = zoom;
      this.camera.x = innerWidth / 2 - (b.x + b.w / 2) * zoom;
      this.camera.y = innerHeight / 2 - (b.y + b.h / 2) * zoom;
      this.saveView();
    }

    /* ── tools ────────────────────────────────────────────────────── */
    setTool(name) {
      if (this.tool && this.tool.cancel) this.tool.cancel();
      if (this.press) this.press.closeMenu();
      this.toolName = name;
      this.tool = this.tools[name];
      if (name !== 'select' && name !== 'lasso') this.select([]);
      document.body.classList.toggle('grab', name === 'pan');
      if (this.ui) this.ui.refresh();
      this.requestDrawLive();
      D.ext.emit('tool', this, name);
    }

    /* Called by a drawing tool once it has committed a new item.

       Leaving the item selected while its drawing tool is still armed is a
       dead end: the one gesture that normally dismisses a selection —
       clicking empty canvas — just draws another item instead, so the only
       ways out are Escape or a tool change. So the new item is selected
       only when we are also handing over to the select tool, where
       click-away works. */
    finishCreate(item) {
      if (this.opts.general.stickyTools) { this.select([]); return; }
      this.setTool('select');
      this.select([item]);
    }

    select(items, quiet) {
      this.selection = items.filter(Boolean);
      this.requestDrawLive();
      if (!quiet && this.ui) this.ui.refresh();
      D.ext.emit('select', this, this.selection);
    }

    selectionBounds() {
      let b = null;
      for (const it of this.selection) b = U.unionBox(b, this.scene.bbox(it));
      return b;
    }

    /* ── input ────────────────────────────────────────────────────── */
    bindInput() {
      const stage = $('#stage');
      stage.addEventListener('pointerdown', e => this.onDown(e));
      stage.addEventListener('pointermove', e => this.onMove(e), { passive: true });
      addEventListener('pointerup', e => this.onUp(e));
      addEventListener('pointercancel', e => this.onUp(e, true));
      /* A pen leaving hover range is the only signal that the eraser ring
         should go: hovering never pressed anything, so there is no
         pointerup to hang it off. pointerleave rather than pointerout
         because out bubbles — crossing between the stacked canvases would
         otherwise blink the ring off and straight back on. */
      stage.addEventListener('pointerleave', e => this.onPointerLeave(e));
      stage.addEventListener('contextmenu', e => e.preventDefault());
      stage.addEventListener('wheel', e => this.onWheel(e), { passive: false });
      stage.addEventListener('dblclick', e => this.onDoubleClick(e));
      addEventListener('keydown', e => this.onKey(e));
      addEventListener('keyup', e => {
        if (e.code !== 'Space') return;
        this.spaceDown = false; document.body.classList.remove('grab');
        if (this.hoverEraser) this.requestDrawLive();   // the ring is allowed back
      });
      addEventListener('paste', e => this.onPaste(e));
      addEventListener('blur', () => { this.spaceDown = false; this.clearHover(); });
      $('#file-input').addEventListener('change', e => this.onFile(e));
      addEventListener('dragover', e => e.preventDefault());
      addEventListener('drop', e => this.onDrop(e));
      // Save on the way out, three ways, because none of them is reliable alone:
      // hiding the tab is the last moment an async write can still finish,
      // pagehide/beforeunload only leave time for the synchronous mirror.
      addEventListener('visibilitychange', () => {
        if (document.hidden) { if (this._dirty) this.saveNow(false, true); }
        else this.requestDraw();          // PDF pages that stalled while hidden get another go
      });
      addEventListener('pagehide', () => this.writeRescue());
      addEventListener('beforeunload', () => this.writeRescue());
    }

    mkEv(e, samples) {
      const w = this.camera.toWorld(e.clientX, e.clientY);
      const ev = {
        x: w.x, y: w.y, sx: e.clientX, sy: e.clientY,
        pressure: pressureOf(e), shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
        pointerType: e.pointerType, e
      };
      ev.samples = samples || [ev];
      return ev;
    }

    onDown(e) {
      if (e.target.closest('#overlay .text-edit')) return;
      this.taps.down(e);
      if (this.editor.active) this.editor.close();
      if (this.press) this.press.closeLabel(true);
      const now = performance.now();
      this.setPointerType(e.pointerType);
      if (e.pointerType === 'pen') this.penAt = now;
      // a primary press means nothing else is really down: drop anything stale
      // (pointers can go missing when the pen leaves the digitiser range)
      if (e.isPrimary) this.pointers.clear();
      else for (const [id, p] of this.pointers) if (now - p._t > 3000) this.pointers.delete(id);
      e._t = now;
      this.pointers.set(e.pointerId, e);

      /* Every new contact ends a hold: a second finger makes it a pinch,
         and a pen landing beside a resting finger says the finger was a
         palm. Whether this contact starts a hold of its own is settled
         below, once it is known what it is driving. Likewise a tap: one
         contact, down and up again without going anywhere. */
      this.hold.cancel();
      if (this.tap) this.tap.multi = true;
      this.tap = this.pointers.size === 1 ? {
        id: e.pointerId, type: e.pointerType, button: e.button, x: e.clientX, y: e.clientY, t0: now,
        slop: TAP_SLOP[e.pointerType] || TAP_SLOP.mouse, moved: false, multi: false, held: false, panned: false, dot: null
      } : null;

      /* two-finger pinch / pan */
      if (this.pointers.size === 2) {
        if (this.active) { this.active.cancel(); this.active = null; }
        this.gesture = startGesture([...this.pointers.values()], this.camera);
        return;
      }
      if (this.pointers.size > 2) return;

      /* A finger navigates and a pen draws — that is the whole model, and
         it does not depend on the tool or on whether a pen has been seen
         yet. It is what makes sketch → shove the page along → sketch some
         more work without reaching for the pan tool between strokes, and
         it is also palm rejection for free: a hand resting on the glass
         cannot leave ink. Settings can hand touch back to the tool. */
      const touchPans = e.pointerType === 'touch' && this.opts.general.touchPan;
      const eraserButton = U.isEraserEnd(e);
      const middle = e.button === 1, right = e.button === 2;
      const selecting = SELECTING.has(this.toolName);

      let tool;
      if (middle || right || this.spaceDown || touchPans) tool = this.tools.pan;
      else if (eraserButton) tool = this.tools.eraser;
      else tool = this.tool;

      /* The one exception: with the select tool out, a finger on what is
         already selected takes hold of it, so a selection can be moved and
         resized with nothing but a finger. Anywhere else it still pans. */
      const grab = touchPans && tool === this.tools.pan && !middle && !right && !this.spaceDown && selecting && this.onSelection(e);
      if (grab) tool = this.tool;

      /* A long-press can select something with a drawing tool still out.
         That selection is for the menu and the action bar: putting the
         tool to the board again lets go of it, as clicking away would. */
      if (tool === this.tool && !selecting && this.selection.length) this.select([]);
      if (tool !== this.tools.pan && this.press) this.press.hideBar();

      this.active = tool;
      this.activeName = tool === this.tool ? this.toolName : (tool === this.tools.pan ? 'pan' : 'eraser');
      if (this.tap) this.tap.panned = touchPans && tool === this.tools.pan;
      const ev = this.mkEv(e);
      this.pointer = ev;
      this.downId = e.pointerId;
      try { $('#stage').setPointerCapture(e.pointerId); } catch (_) { }
      if (grab) {
        /* If the select tool does not find a handle or an item under the
           finger after all — its idea of "under" may be tighter than
           onSelection's — the finger pans, as it would have, rather than
           starting a marquee that throws the selection away. */
        const kept = this.selection;
        tool.down(ev);
        if (!tool.mode || tool.mode === 'marquee' || tool.mode === 'lasso') {
          tool.cancel();
          this.select(kept, true);
          tool = this.active = this.tools.pan;
          this.activeName = 'pan';
          if (this.tap) this.tap.panned = true;
          tool.down(ev);
        }
      } else tool.down(ev);
      this.armHold(e);
      this.requestDrawLive();
      e.preventDefault?.();
    }

    /** remember what last pressed, and repaint if that changes how big the handles are */
    setPointerType(type) {
      if (!type || type === this.pointerType) return;
      this.pointerType = type;
      const coarse = type === 'touch' || type === 'pen';
      if (coarse !== this.coarse) { this.coarse = coarse; this.requestDrawLive(); }
    }

    /** screen px a press may land from an item and still be on it, for `type` of pointer */
    hitPx(type = this.pointerType) { return HIT_PX[type] || HIT_PX.mouse; }
    /** screen px around a selection handle that still takes it */
    handlePad(type = this.pointerType) { return HANDLE_PAD[type] || HANDLE_PAD.mouse; }

    /** is this press on the selection: one of its items, or a handle? */
    onSelection(e) {
      if (!this.selection.length) return false;
      if (this.selBox) {
        const pad = this.handlePad(e.pointerType);
        for (const h of this.renderer.handleRects(this.selBox))
          if (e.clientX >= h.x - pad && e.clientX <= h.x + h.w + pad && e.clientY >= h.y - pad && e.clientY <= h.y + h.h + pad) return true;
      }
      const w = this.camera.toWorld(e.clientX, e.clientY);
      const hit = this.scene.hitTest(w.x, w.y, this.hitPx(e.pointerType) / this.camera.zoom);
      return !!hit && this.selection.includes(hit);
    }

    /**
     * What a press at (x, y), in world units, is on. A page or picture
     * covers its whole area, so anything drawn on it within reach wins,
     * as it does for the select tool.
     */
    pickAt(x, y, type) {
      const tol = this.hitPx(type) / this.camera.zoom;
      let hit = this.scene.hitTest(x, y, tol);
      if (D.backdrop(hit)) {
        const over = this.scene.hitTest(x, y, tol, it => !D.backdrop(it) && it._z > hit._z);
        if (over) hit = over;
      }
      return hit;
    }

    groupOf(it) { return it.group ? this.scene.items.filter(i => i.group === it.group) : [it]; }

    /**
     * Start watching this press for a long-press, if it may be one.
     *
     * Fingers and pens only: a mouse has its right button, which opens the
     * same menu (onTap). Never the eraser, which has already rubbed out
     * what it landed on — a cancel cannot put that back — nor a press that
     * is panning on purpose (middle button, Space). A finger soon after
     * the pen was about is a palm, and so is a contact the size of one.
     * On something the select tool can pick up and drag, the menu waits
     * GRAB_GRACE longer: the tool lifts a page at 300ms, and someone who
     * holds, sees it lift and then starts to drag should get the drag.
     */
    armHold(e) {
      const o = this.opts.press, type = e.pointerType;
      if (!o || !o.hold || (type !== 'touch' && type !== 'pen') || (type === 'pen' && !o.pen)) return;
      if (this.pointers.size !== 1 || e.button === 1 || e.button === 2 || this.spaceDown) return;
      if (this.activeName === 'eraser' || !this.active) return;
      if (type === 'touch') {
        if (performance.now() - (this.penAt ?? -Infinity) < PEN_NEAR_MS) return;
        if (Math.max(e.width || 0, e.height || 0) > PALM_PX) return;
      }
      let delay = o.delay || 500;
      const mode = this.active.mode;
      if (SELECTING.has(this.activeName) && mode && mode !== 'marquee' && mode !== 'lasso') delay += GRAB_GRACE;
      this.holdCam = this.camera.toJSON();
      this.hold.start(e, delay);
    }

    /** a long-press has fired: drop what the press had started, and open the menu */
    onHold(h) {
      if (h.id !== this.downId || !this.pointers.has(h.id)) return;
      /* Every tool's cancel leaves no trace — no dot of ink, no empty text
         box, no half-made move — which is what lets a hold start out as
         whatever the tool does and turn into a menu afterwards. */
      if (this.active) {
        const panned = this.active === this.tools.pan;
        this.active.cancel();
        this.active = null;
        /* the finger may have nudged the board within the slop: put it back, as a tap does */
        if (panned && this.holdCam) { this.camera.load(this.holdCam); this.requestPan(); }
      }
      if (this.tap && this.tap.id === h.id) this.tap.held = true;
      this.openPress(h.x, h.y, h.type);
    }

    /**
     * The long-press menu for screen point (sx, sy) — also what a right
     * click or the pen's barrel button opens. Pressing on something
     * selects it whatever the tool, unless it is part of the selection
     * already (then the menu is for all of it). A page or picture under a
     * drawing tool is what you are writing on, not what you are asking
     * about: the menu is the board's, with a way to select the page.
     */
    openPress(sx, sy, type) {
      const w = this.camera.toWorld(sx, sy);
      const hit = this.pickAt(w.x, w.y, type);
      const target = hit && !(D.backdrop(hit) && !SELECTING.has(this.toolName)) ? hit : null;
      if (target) { if (!this.selection.includes(target)) this.select(this.groupOf(target)); }
      else if (this.selection.length) this.select([]);
      const ctx = { app: this, x: w.x, y: w.y, sx, sy, hit, selection: this.selection.slice(), pointerType: type };
      if (this.press) this.press.openMenu(ctx);
      this.requestDrawLive();
      return ctx;
    }

    onMove(e) {
      this.taps.move(e);
      this.hold.move(e);
      const tap = this.tap;
      if (tap && tap.id === e.pointerId && !tap.moved && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > tap.slop) tap.moved = true;
      if (e.pointerType === 'pen') {
        this.penAt = performance.now();
        /* the pen coming into range while a finger is held: that finger is the hand holding it */
        if (this.hold.armed && this.hold.armed.type === 'touch') this.hold.cancel();
      }
      if (this.pointers.has(e.pointerId)) { e._t = performance.now(); this.pointers.set(e.pointerId, e); }

      if (this.gesture && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        applyGesture(this.gesture, a, b, this.camera);
        this.requestZoom();
        if (this.ui) $('#btn-zoom-reset').textContent = Math.round(this.camera.zoom * 100) + '%';
        return;
      }

      const samples = [];
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const s of (list.length ? list : [e])) samples.push(this.mkEv(s));
      const ev = this.mkEv(e, samples);
      this.pointer = ev;

      if (this.active && e.pointerId === this.downId) {
        this.active.move(ev);
        /* The select tool starts moving things after a few pixels — inside
           the hold's slop — and its cancel drops the move without putting
           them back. Once it has changed anything, this is a drag. */
        if (this.hold.armed && SELECTING.has(this.activeName)) {
          const t = this.active;
          if ((t.mode === 'move' && t.moved) || t.mode === 'resize' || t.mode === 'endpoint') this.hold.cancel();
        }
      } else {
        /* A hovering eraser end has to repaint even on the frame it stops
           being one, or the ring is left behind when the pen is turned
           back over. */
        const was = this.hoverEraser;
        this.hoverEraser = U.isEraserEnd(e);
        if (this.hoverEraser || was || this.toolName === 'eraser') this.requestDrawLive();
      }
    }

    onPointerLeave(e) {
      if (e.pointerId === this.downId) return;      // mid-stroke, and captured: not a real exit
      this.clearHover();
    }

    clearHover() {
      if (!this.hoverEraser) return;
      this.hoverEraser = false;
      this.requestDrawLive();
    }

    onUp(e, cancelled) {
      this.taps.up(e, cancelled);
      this.hold.end(e);
      this.pointers.delete(e.pointerId);
      if (this.gesture && this.pointers.size < 2) { this.gesture = null; this.saveView(); }
      const tap = this.endTap(e, cancelled);
      if (!this.active || e.pointerId !== this.downId) { if (tap) this.onTap(tap); return; }
      const ev = this.mkEv(e);
      /* note the stroke a pen tap leaves, so a double-tap can take it back */
      const undo = this.scene.undoStack, top = undo[undo.length - 1];
      if (cancelled && this.active.cancel) this.active.cancel();
      else this.active.up(ev);
      if (tap) { const op = undo[undo.length - 1]; if (op && op !== top && op.label === 'draw') tap.dot = op; }
      this.active = null;
      try { $('#stage').releasePointerCapture(e.pointerId); } catch (_) { }
      if (this.ui) this.ui.refresh();
      this.requestDrawLive();
      if (tap) this.onTap(tap);
    }

    /** the tap this lift completes, or null if the contact was anything else */
    endTap(e, cancelled) {
      const t = this.tap;
      if (!t || t.id !== e.pointerId) return null;
      this.tap = null;
      if (cancelled || t.moved || t.multi || t.held) { this.lastTap = null; return null; }
      t.t1 = performance.now();
      t.long = t.t1 - t.t0 > TAP_MS;
      return t;
    }

    /**
     * A contact that came and went without travelling. Three things hang
     * off one: a right click (or the pen's barrel button) opens the
     * long-press menu; two quick taps in one place are a double-click,
     * which Windows does not reliably make for a pen and does not make at
     * all for a finger; and a finger's tap selects, with the select tool.
     */
    onTap(tap) {
      if (tap.button === 2) { this.openPress(tap.x, tap.y, tap.type); this.lastTap = null; return; }
      if (tap.long || (tap.type !== 'touch' && tap.type !== 'pen')) { this.lastTap = null; return; }
      const last = this.lastTap;
      if (last && last.type === tap.type && tap.t0 - last.t1 < DOUBLE_MS &&
        Math.hypot(tap.x - last.x, tap.y - last.y) < (DOUBLE_SLOP[tap.type] || 12)) {
        this.lastTap = null;
        this.doubleTap(last, tap);
        return;
      }
      this.lastTap = tap;
      if (tap.panned) this.fingerTap(tap);
    }

    /* With the select tool, a finger's tap selects what it lands on, or
       lets go on bare board. With any other tool it only lets go — of a
       selection a long-press made — so a palm brushing the glass while
       writing never picks anything up. */
    fingerTap(tap) {
      const w = this.camera.toWorld(tap.x, tap.y);
      const hit = this.pickAt(w.x, w.y, 'touch');
      if (SELECTING.has(this.toolName)) this.select(hit ? this.groupOf(hit) : []);
      else if (!hit && this.selection.length) this.select([]);
    }

    /**
     * Two taps in one place: a double-click. The pen drew a dot with each
     * tap, under a drawing tool, and those dots would sit on top of the
     * very thing being double-tapped — so they are looked through to find
     * it, and taken back out of the board and its history if the
     * double-tap did something. If it did not, they stay: that was a colon.
     */
    doubleTap(a, b) {
      const now = performance.now();
      if (now - (this._dblAt ?? -Infinity) < DOUBLE_GUARD) return;
      const ignore = new Set();
      for (const t of [a, b]) if (t.dot) for (const it of t.dot.adds) ignore.add(it.id);
      const w = this.camera.toWorld(b.x, b.y);
      const act = this.doubleAction(w.x, w.y, b.type, ignore);
      if (!act) return;
      this._dblAt = now;
      const s = this.scene;
      for (const t of [b, a]) if (t.dot && s.undoStack[s.undoStack.length - 1] === t.dot) { s.undo(); s.redoStack.pop(); }
      act();
    }

    onWheel(e) {
      e.preventDefault();
      if (this.press) this.press.closeMenu();
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * 0.0035);
        this.camera.zoomBy(f, e.clientX, e.clientY);
        this.requestZoom();
      } else if (e.shiftKey) {
        this.panScreen(-e.deltaY - e.deltaX, 0);
      } else {
        this.panScreen(-e.deltaX, -e.deltaY);
      }
      $('#btn-zoom-reset').textContent = Math.round(this.camera.zoom * 100) + '%';
      this.saveViewDebounced();
    }

    /* A double-tap is recognised in onTap as well as by the browser, and
       a Windows pen sometimes produces both: one action per pair. */
    onDoubleClick(e) {
      const now = performance.now();
      if (now - (this._dblAt ?? -Infinity) < DOUBLE_GUARD) return false;
      const w = this.camera.toWorld(e.clientX, e.clientY);
      const act = this.doubleAction(w.x, w.y, e.pointerType || this.pointerType);
      if (!act) return false;
      this._dblAt = now;
      act();
      return true;
    }

    /** what a double-click at (x, y) would do, as a function to call; null for nothing */
    doubleAction(x, y, type, ignore) {
      const hit = this.scene.hitTest(x, y, this.hitPx(type) / this.camera.zoom, ignore && ignore.size ? it => !ignore.has(it.id) : undefined);
      if (hit) return this.canEdit(hit) ? () => this.editItem(hit) : null;
      if (this.toolName !== 'select') return null;
      return () => {
        const o = this.opts.text;
        const it = mk.text({ x, y: y - o.size * 0.68, color: o.color, size: o.size, font: o.font, autoWidth: true, w: 40 });
        this.scene.begin('text'); this.scene.add(it); this.scene.commit();
        this.select([it]); this.editor.open(it, { isNew: true });
      };
    }

    /** can this item be edited in place: its text, its label, or whatever its type says (ext.js) */
    canEdit(it) {
      const xt = D.ext.items[it.type];
      if (xt) return !!xt.edit;
      return it.type === 'text' || it.type === 'note' || it.type === 'node' || it.type === 'edge';
    }

    /** edit it in place, as a double-click or F2 would; selects it first */
    editItem(it) {
      const xt = D.ext.items[it.type];
      if (xt) { if (xt.edit) { this.select([it]); xt.edit(this, it); } return; }
      if (it.type === 'edge') { this.editLabel(it); return; }
      if (it.type === 'text' || it.type === 'note' || it.type === 'node') { this.select([it]); this.editor.open(it, { selectAll: false }); }
    }

    /* A connector's label, in a field on the board itself. It used to be
       window.prompt(), which a pen user meets as a modal box far from
       the line it is about, and which Tauri's WebView does not show. */
    editLabel(edge) {
      if (this.press) { this.press.editLabel(edge); return; }
      const label = prompt('Connector label', edge.label || '');
      if (label !== null) this.setLabel(edge, label);
    }

    setLabel(edge, label) {
      label = String(label).trim();
      if (label === (edge.label || '') || !this.scene.get(edge.id)) return;
      this.scene.begin('label'); this.scene.touch(edge);
      if (label) edge.label = label; else delete edge.label;
      this.scene.commit(); this.afterEdit();
    }

    /* ── keyboard ─────────────────────────────────────────────────── */
    onKey(e) {
      if (e.target.matches('input, textarea')) return;
      if (this.press && this.press.key(e)) return;  // Escape closes the long-press menu
      if (D.ext.emit('key', this, e)) return;      // a feature took it
      // the boards sheet has the keyboard while it is open, not the board behind it
      if (this.ui && !$('#sheet').hidden) { this.ui.sheetKey(e); return; }
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;

      if (e.code === 'Space' && !this.spaceDown) {
        this.spaceDown = true; document.body.classList.add('grab'); e.preventDefault();
        if (this.hoverEraser) this.requestDrawLive();   // space pans instead: drop the ring
        return;
      }

      if (ctrl) {
        switch (k.toLowerCase()) {
          case 'z': e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return;
          case 'y': e.preventDefault(); this.redo(); return;
          case 'a': e.preventDefault(); this.setTool('select'); this.select(this.scene.items.slice()); return;
          case 'c': this.copy(); return;
          case 'x': this.copy(); this.deleteSelection(); return;
          case 'v': return;                       // handled by the paste event
          case 'd': e.preventDefault(); this.duplicate(); return;
          case 'g': e.preventDefault(); this.toggleGroup(); return;
          case 's': e.preventDefault(); this.saveNow(false, true); this.toast('Saved'); return;
          case 'm': e.preventDefault(); this.ui.openSheet(); return;
          case ',': e.preventDefault(); this.ui.openSettings(); return;
          case '\\': e.preventDefault(); this.ui.toggleFolds(); return;
          case '0': e.preventDefault(); this.camera.zoomTo(1, innerWidth / 2, innerHeight / 2); this.requestDraw(); this.ui.refresh(); return;
          case '=': case '+': e.preventDefault(); this.camera.zoomBy(1.25, innerWidth / 2, innerHeight / 2); this.requestDraw(); this.ui.refresh(); return;
          case '-': e.preventDefault(); this.camera.zoomBy(0.8, innerWidth / 2, innerHeight / 2); this.requestDraw(); this.ui.refresh(); return;
          case "'": e.preventDefault(); this.cycleGrid(); return;
        }
        return;
      }

      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }
      if (k === 'Escape' && !($('#sheet').hidden && $('#settings').hidden)) {
        this.ui.closeSheet(); this.ui.closeSettings();
        return;
      }
      if (k === 'Escape') {
        // Escape unwinds one step at a time: abandon what is in progress and
        // drop the selection, then — if there was nothing to drop — fall back
        // to the select tool rather than leaving you stuck in a drawing mode.
        const had = this.selection.length;
        this.select([]);
        const selecting = this.toolName === 'select' || this.toolName === 'lasso';
        this.setTool(had || selecting ? this.toolName : 'select');
        return;
      }
      if (k === 'Tab' && this.selection.length === 1 && this.selection[0].type === 'node') { e.preventDefault(); this.tree.addChild(this.selection[0]); return; }
      if (k === 'Enter' && this.selection.length === 1) {
        e.preventDefault();
        const it = this.selection[0];
        if (it.type === 'node') this.tree.addSibling(it);
        else if (it.type === 'text' || it.type === 'note') this.editor.open(it);
        return;
      }
      if (k === 'F2' && this.selection.length === 1) {
        e.preventDefault();
        const it = this.selection[0], xt = D.ext.items[it.type];
        if (it.type === 'edge') this.editLabel(it);
        else if (!xt) this.editor.open(it);
        else if (xt.edit) xt.edit(this, it);
        return;
      }
      if (k === ']') { this.arrange('front'); return; }
      if (k === '[') { this.arrange('back'); return; }
      if (k === '!' || (e.shiftKey && k === '1')) { this.zoomToFit(); return; }

      if (/^[1-8]$/.test(k)) {
        const pal = this.ui.palette();
        const c = pal[+k - 1];
        if (this.selection.length) { this.scene.begin('colour'); for (const it of this.selection) { this.scene.touch(it); it.color = c; it._path = null; } this.scene.commit(); this.afterEdit(); }
        else { const o = this.opts[this.toolName]; if (o && 'color' in o) { o.color = c; this.ui.refresh(); } }
        return;
      }

      const map = {
        v: 'select', p: 'pen', b: 'pen', h: 'highlighter', e: 'eraser', t: 'text', n: 'node',
        c: 'connector', k: 'note', q: 'laser', g: 'lasso'
      };
      const shapeMap = { r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', d: 'diamond' };
      const low = k.toLowerCase();
      /* A registered tool's key (ext.js) is asked first, so a feature can
         have B, which is only an alias for the pen here. Taking one of
         the letters the help lists is the feature's own lookout. */
      const x = D.ext.tools.find(t => t.rail && t.rail.key && t.rail.key.toLowerCase() === low);
      if (x) { this.setTool(x.name); return; }
      if (map[low]) { this.setTool(map[low]); return; }
      if (shapeMap[low]) { this.opts.shape.kind = shapeMap[low]; this.setTool('shape'); return; }
    }

    /* ── editing commands ─────────────────────────────────────────── */
    /** both hand back the step they undid or redid, or null if there was none */
    undo() { const op = this.scene.undo(); this.select([]); this.afterEdit(); return op; }
    redo() { const op = this.scene.redo(); this.select([]); this.afterEdit(); return op; }
    /** a word or two on screen for a moment, for a gesture that has no button to light up */
    flash(text) { this.ui.toast(text, null, null, 1100); }

    deleteSelection() {
      if (!this.selection.length) return;
      this.scene.begin('delete');
      this.scene.removeMany(this.selection);
      this.scene.commit();
      this.select([]);
      this.afterEdit();
    }

    duplicate() {
      if (!this.selection.length) return;
      this.scene.begin('duplicate');
      const { copies } = D.cloneSet(this.selection);
      for (const c of copies) { this.scene.add(c); this.scene.translate(c, 24, 24); }
      this.scene.commit();
      this.select(copies);
      this.afterEdit();
    }

    copy() {
      if (!this.selection.length) return;
      const items = this.clipboard = this.selection.map(D.clone);
      /* Also offer it to the system clipboard, so it can be pasted into
         another board. Pictures go with it: they are assets now, and the
         window it lands in — another browser, the desktop app — may keep
         its assets somewhere else entirely. (PDF pages travel as a
         reference, as they always have; a whole document is too much.) */
      (async () => {
        const assets = {};
        for (const id of new Set(items.filter(i => i.type === 'image' && i.asset).map(i => i.asset))) {
          const bytes = await this.getAsset(id);
          const meta = (this.board.assets || []).find(a => a.id === id) || {};
          if (bytes) assets[id] = { name: meta.name, type: meta.type, b64: D.store.toB64(bytes) };
        }
        await navigator.clipboard.writeText(JSON.stringify({ dpo: true, items, assets }));
      })().catch(() => { });
    }

    /** store any pictures a paste brought with it that this window lacks */
    async adoptAssets(assets) {
      for (const [id, a] of Object.entries(assets || {})) {
        if (await this.getAsset(id).catch(() => null)) continue;
        await this.putAsset(id, D.store.fromB64(a.b64), { name: a.name || 'picture', type: a.type || 'image/png' });
      }
    }

    /** centred on `at`, or where they were copied from if `at` is null */
    pasteItems(items, at) {
      if (!items.length) return;
      let box = null;
      const tmp = new D.Scene({ items });
      for (const it of items) box = U.unionBox(box, tmp.bbox(it));
      let dx = at ? at.x - (box.x + box.w / 2) : 0, dy = at ? at.y - (box.y + box.h / 2) : 0;
      /* in place, on top of the very things copied, looks like nothing
         happened: step aside the way Duplicate does */
      if (!at && items.some(it => this.scene.get(it.id))) dx = dy = 24;
      const { copies, ids } = D.cloneSet(items);
      // an edge whose other end was left behind becomes a loose connector
      for (const c of copies) {
        if (c.type !== 'edge') continue;
        if (c.from.id && !ids.has(c.from.id)) c.from = { ...tmp.endpoint(c.from, { x: 0, y: 0 }) };
        if (c.to.id && !ids.has(c.to.id)) c.to = { ...tmp.endpoint(c.to, { x: 0, y: 0 }) };
      }
      this.scene.begin('paste');
      for (const c of copies) { this.scene.add(c); this.scene.translate(c, dx, dy); }
      this.scene.commit();
      this.setTool('select');
      this.select(copies);
      this.afterEdit();
    }

    onPaste(e) {
      if (this.editor.active) return;
      const at = this.pointer ? { x: this.pointer.x, y: this.pointer.y } : U.boxCenter(this.camera.viewport(innerWidth, innerHeight));
      const dt = e.clipboardData;
      if (!dt) return;
      for (const f of dt.files) {
        if (f.type.startsWith('image/')) { e.preventDefault(); this.insertImageFile(f, at); return; }
        if (f.type === 'application/pdf') { e.preventDefault(); this.insertPdf(f, at); return; }
      }
      const text = dt.getData('text/plain');
      if (text) { e.preventDefault(); this.pasteText(text, at); return; }
      if (this.clipboard.length) { e.preventDefault(); this.pasteItems(this.clipboard, at); }
    }

    /** text off the clipboard: this app's own items if it is a copy of some, otherwise a text box */
    pasteText(text, at) {
      try {
        const j = JSON.parse(text);
        if (j && j.dpo && Array.isArray(j.items)) {
          this.adoptAssets(j.assets).catch(err => console.warn('[dpo] paste', err)).then(() => this.pasteItems(j.items, at));
          return;
        }
      } catch (_) { }
      const o = this.opts.text;
      at = at || this.viewCentre();
      const it = mk.text({ x: at.x, y: at.y, text, color: o.color, size: o.size, w: 380 });
      this.scene.begin('paste text'); this.scene.add(it); this.scene.commit();
      this.setTool('select'); this.select([it]); this.afterEdit();
    }

    viewCentre() { return U.boxCenter(this.camera.viewport(innerWidth, innerHeight)); }

    /**
     * Paste without a keyboard: what the long-press menu's Paste does.
     *
     * Ctrl+V hands the page a paste event with the clipboard in it; a
     * button has to ask for it instead, through the async Clipboard API,
     * which may be missing, or refused (the browser asks once, and a
     * "no" sticks). Then the paste falls back to what was last copied in
     * this window, and says so. `at` is the world point to paste on, or
     * null for "where it came from" — the app's own items go back where
     * they were copied from, anything else lands mid-view.
     */
    async pasteFromClipboard(at) {
      let text = null, blocked = false;
      const cb = navigator.clipboard;
      if (cb && cb.read) {
        try {
          const found = await cb.read();
          for (const item of found) {
            const pic = item.types.find(t => t.startsWith('image/'));
            const pdf = item.types.includes('application/pdf');
            if (pic || pdf) {
              const type = pic || 'application/pdf';
              const blob = await item.getType(type);
              const file = new File([blob], pdf && !pic ? 'pasted.pdf' : 'pasted', { type });
              if (pic) this.insertImageFile(file, at || this.viewCentre());
              else this.insertPdf(file, at || this.viewCentre());
              return true;
            }
          }
          const plain = found.find(i => i.types.includes('text/plain'));
          if (plain) text = await (await plain.getType('text/plain')).text();
        } catch (err) { blocked = true; }
      }
      if (text == null && cb && cb.readText) {
        try { text = await cb.readText(); blocked = false; } catch (err) { blocked = true; }
      }
      if (text) { this.pasteText(text, at); return true; }
      if (this.clipboard.length) {
        this.pasteItems(this.clipboard, at);
        if (blocked || !cb) this.toast('Could not read the clipboard here, so this is what you last copied on this board');
        return true;
      }
      this.toast(blocked || !cb ? 'The clipboard cannot be read here — use Ctrl+V, or copy something on the board first' : 'Nothing to paste');
      return false;
    }

    /** the file picker, for a picture or PDF to land at `at` (or mid-view) */
    pickFile(at) {
      this._fileAt = at || null;
      $('#file-input').click();
    }

    onDrop(e) {
      e.preventDefault();
      const at = this.camera.toWorld(e.clientX, e.clientY);
      for (const f of e.dataTransfer.files) {
        if (f.type.startsWith('image/')) this.insertImageFile(f, at);
        else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) this.insertPdf(f, at);
        else if (/\.(board|json)$/i.test(f.name)) this.importFile(f);
      }
    }

    async insertPdf(file, at) {
      try {
        const items = await D.pdf.import(this, file, at);
        if (items.length) {
          this.camera.fit(this.scene.bbox(items[0]), innerWidth, innerHeight);
          this.requestDraw();
        }
      } catch (err) {
        this.toast('Could not read that PDF');
        console.error(err);
      }
    }

    /* ── binary assets ────────────────────────────────────────────── */
    async putAsset(id, bytes, meta) {
      this._assets = this._assets || new Map();
      this._assets.set(id, bytes);
      this.board.assets = [...(this.board.assets || []).filter(a => a.id !== id), { id, ...meta }];
      await D.store.putAsset(id, bytes, meta);
    }

    async getAsset(id) {
      this._assets = this._assets || new Map();
      if (this._assets.has(id)) return this._assets.get(id);
      const bytes = await D.store.getAsset(id);
      if (bytes) this._assets.set(id, bytes);
      return bytes;
    }

    /**
     * Put a picture on the board.
     *
     * The file is kept as an asset, like a PDF, and the board holds only
     * its id. Pictures used to ride inside the board as data URLs, so a
     * few pasted screenshots made the board record megabytes long, and
     * every autosave — after every stroke — copied all of it again: into
     * IndexedDB here, and across the bridge and onto disk in the desktop
     * app, where it also churned the vault's sync. Stored at full
     * resolution either way; nothing is recompressed.
     */
    async insertImageFile(file, at) {
      let size;
      try {
        const d = await U.decodeImage(file);
        size = { w: d.w, h: d.h };
        if (d.img.close) d.img.close();
        if (d.url) URL.revokeObjectURL(d.url);
      } catch (err) { return this.toast('Could not read that picture'); }
      const max = 520;
      const s = Math.min(1, max / Math.max(size.w, size.h));
      const type = file.type || (/\.svg$/i.test(file.name) ? 'image/svg+xml' : 'image/png');
      let it;
      try {
        const id = U.uid();
        await this.putAsset(id, new Uint8Array(await file.arrayBuffer()), { name: file.name || 'picture', type });
        it = mk.image({ asset: id, mime: type, w: size.w * s, h: size.h * s });
      } catch (err) {
        // nowhere to keep it apart from the board: carry it inline, as before
        console.warn('[dpo] picture kept inline', err);
        it = mk.image({ src: await dataUrlOf(file), w: size.w * s, h: size.h * s });
      }
      it.x = at.x - it.w / 2; it.y = at.y - it.h / 2;
      this.scene.begin('image'); this.scene.add(it); this.scene.commit();
      this.setTool('select'); this.select([it]); this.afterEdit();
    }

    /**
     * Boards from before pictures were assets carry them inline. Move each
     * one out, once, when the board is opened — the same picture pasted
     * twice becomes one asset. The items change in place rather than
     * through history: nothing about the board's content changes, and
     * undoing back to the inline form would draw just the same.
     */
    async movePicturesOut() {
      const board = this.board;
      const inline = this.scene.items.filter(i => i.type === 'image' && !i.asset && /^data:[^,]*;base64,/.test(i.src || ''));
      if (!inline.length) return;
      const made = new Map();
      for (const it of inline) {
        if (this.board !== board) return;           // switched boards meanwhile
        let a = made.get(it.src);
        if (!a) {
          const comma = it.src.indexOf(',');
          const type = it.src.slice(5, comma).replace(/;base64$/, '') || 'image/png';
          a = { id: U.uid(), type };
          try { await this.putAsset(a.id, D.store.fromB64(it.src.slice(comma + 1)), { name: 'picture', type }); }
          catch (err) { console.warn('[dpo] picture left inline', err); return; }
          made.set(it.src, a);
        }
        this.renderer.renamePicture(it.src, a.id);   // already decoded: no flicker
        it.asset = a.id; it.mime = a.type; delete it.src; it._json = null;
      }
      if (this.board === board) this.markDirty();
    }

    arrange(mode) {
      if (!this.selection.length) return;
      this.scene.reorder(this.selection, mode);
      this.afterEdit();
    }

    toggleGroup() {
      if (this.selection.length < 1) return;
      const grouped = this.selection.some(i => i.group);
      this.scene.begin('group');
      const g = grouped ? null : U.uid();
      for (const it of this.selection) { this.scene.touch(it); if (g) it.group = g; else delete it.group; }
      this.scene.commit();
      this.afterEdit();
    }

    zoomToFit() {
      const b = this.selection.length ? this.selectionBounds() : this.scene.contentBounds();
      if (!b) { this.camera.zoomTo(1, innerWidth / 2, innerHeight / 2); }
      else this.camera.fit(b, innerWidth, innerHeight);
      this.requestDraw(); this.ui.refresh(); this.saveView();
    }

    cycleGrid() {
      const order = ['dots', 'lines', 'lined', 'none'];
      this.renderer.grid = order[(order.indexOf(this.renderer.grid) + 1) % order.length];
      this.requestDraw(); this.savePrefs(); this.ui.refresh();
    }

    toggleTheme() {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      this.syncThemeInk();
      this.savePrefs();
      this.requestDraw();
      this.ui.refresh();
    }

    /** keep the default ink readable when the paper flips colour */
    syncThemeInk() {
      const dark = document.documentElement.dataset.theme === 'dark';
      // the installed app paints its title bar with this
      const meta = document.getElementById('theme-color');
      if (meta) meta.content = dark ? '#0e1014' : '#f6f6f8';
      const wasInk = ['#14161c', '#f2f4f8'];
      for (const key of ['pen', 'shape', 'text', 'node']) {
        const o = this.opts[key];
        if (wasInk.includes(o.color)) o.color = dark ? '#f2f4f8' : '#14161c';
      }
      if (this.opts.node.fill === '#ffffff' || this.opts.node.fill === '#14161c') this.opts.node.fill = dark ? '#14161c' : '#ffffff';
      /* PDF pages are baked light or dark at render time, so the cache
         is stale the moment the board flips. */
      D.pdf.themeChanged();
      this.renderer.invalidate();
    }

    /* ── feedback ─────────────────────────────────────────────────── */
    toast(msg, label, action) { this.ui.toast(msg, label, action); }
    /* Surfaces have no vibration motor, so the snap "feels" like the label
       that pops up next to the nib — see PenTool.trySnap. */
    haptic() { }

    hint(x, y, text) {
      this.hideHint();
      const h = U.el('div', { class: 'hint' }, text);
      h.style.left = x + 'px'; h.style.top = y + 'px';
      $('#overlay').append(h);
      this._hint = h;
    }
    hideHint() { if (this._hint) { this._hint.remove(); this._hint = null; } }
    focusCanvas() { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }

    /* ── persistence ──────────────────────────────────────────────── */
    afterEdit() { this.markDirty(); this.requestDraw(); if (this.ui) this.ui.refresh(); D.ext.emit('change', this); }

    /* Autosave waits for a pause: SAVE_IDLE after the last edit, and every
       edit starts the wait again, so a run of writing is saved once, when
       you stop. It also saves on leaving the board, on hiding or closing
       the window, and on Ctrl+S. SAVE_MAX is the one exception: work that
       has gone that long unsaved because you never paused is saved at the
       next gap between strokes anyway. */
    markDirty() {
      if (!this._dirty) this._dirtySince = Date.now();
      this._dirty = true;
      this._edits = (this._edits || 0) + 1;
      $('#save-state').textContent = 'unsaved';
      if (Date.now() - this._dirtySince > SAVE_MAX) this.saveSoon();
      else this.saveDebounced();
      /* the save is seconds away: serialise what changed in the gaps
         before it, so a big edit (a drag of thousands of strokes) does not
         land on the save as one long task */
      this.warmSave();
    }

    /** never in the middle of a stroke or a drag: that waits for the pen to lift */
    saveSoon() {
      if (this.active) { this.saveDebounced(); return; }
      return this.saveNow();
    }

    /**
     * Save before the window closes (the desktop shell holds the close
     * until this answers, or gives up after a few seconds).
     */
    async onCloseRequested() {
      try { if (this._dirty) await this.saveNow(true); }
      catch (err) { console.error('[dpo] save on close', err); }
      finally { self.__TAURI_INTERNALS__.invoke('dpo_close'); }
    }

    /** `force` refreshes the board's card picture; either flag updates the board list */
    async saveNow(force, listToo) {
      if (!this.board) return;
      this.saveDebounced.cancel?.();
      const edits = this._edits;
      $('#save-state').textContent = 'saving…';
      this.snapshot();
      // the board's picture: always when leaving the board, otherwise now and then
      const board = this.board;
      const shot = force ? this.captureThumb() : null;
      if (!force && Date.now() - (this._thumbAt || 0) > 6000) this.queueThumb();
      await D.store.save(board, force || listToo);
      if (shot) await this.storeThumb(board, shot);
      // an edit made while that was writing is not in it: still unsaved
      if (this._edits !== edits) { $('#save-state').textContent = 'unsaved'; return; }
      this._dirty = false;
      $('#save-state').textContent = 'saved';
      clearRescue();
    }

    /**
     * A picture of the board for the boards list: the view you were last
     * looking at, as it is on screen. It used to be the whole board
     * squeezed into 340×212, which made writing on any sizeable board
     * unreadable, and repainted every item on the board to get there. The
     * screen already holds the view, so this is a scaled copy of it.
     * Taken in the current theme; thumbTheme records which.
     */
    /* In two halves. Copying the screen is a few ms and has to happen while
       it still shows this board, so it is synchronous. Encoding the copy
       took 150ms on the main thread as toDataURL — a hitch on every board
       switch and every few saves — so it goes through toBlob, which
       encodes on another thread. */
    captureThumb(w = 480) {
      if (!this.scene.items.length) return 'empty';   // the card shows a placeholder instead
      const src = this.renderer.base;
      if (!src.width || !src.height) return null;
      if (this.renderer._painted == null) this.renderer.drawScene();
      const c = document.createElement('canvas');
      c.width = w; c.height = Math.round(w * src.height / src.width);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, c.width, c.height);
      return c;
    }

    /** a captured picture as the data URL a board record keeps; null for an empty board */
    encodeThumb(c) {
      if (!c || c === 'empty') return Promise.resolve(null);
      return new Promise(res => c.toBlob(blob => {
        if (!blob) return res(null);
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(blob);
      }, 'image/webp', 0.75));
    }

    /**
     * Give `board` the picture `shot` and bring its entry in the board list
     * up to date. Only the list is written: the picture rides along in the
     * board's own file with its next real save, rather than costing one.
     */
    async storeThumb(board, shot) {
      if (shot == null) return;
      const theme = document.documentElement.dataset.theme;
      board.thumb = await this.encodeThumb(shot);
      board.thumbTheme = theme;
      this._thumbAt = Date.now();
      await D.store.touchIndex(board, true);
    }

    /** refresh the board's picture once the pen has been still long enough not to notice */
    queueThumb() {
      if (this._thumbJob) return;
      this._thumbAt = Date.now();
      const run = () => {
        this._thumbJob = null;
        if (!this.board || this.active) return;     // still drawing: catch it next time
        this.storeThumb(this.board, this.captureThumb()).catch(err => console.warn('[dpo] picture', err));
      };
      this._thumbJob = self.requestIdleCallback
        ? requestIdleCallback(run, { timeout: 4000 })
        : setTimeout(run, 400);
    }

    /** copy the live scene into the board record */
    snapshot() {
      D.store.setDocBytes(this.board, this.scene.docBytes(), this.scene.items.length);
      this.board.camera = this.camera.toJSON();
      this.board.name = $('#board-title').value || 'Untitled board';
      this.board.updated = Date.now();
      return this.board;
    }

    /**
     * A page can be closed or reloaded inside the autosave window, and an
     * IndexedDB write started at that moment will not finish. localStorage is
     * synchronous, so it does. This mirror is written on the way out and
     * replayed on the next start if it turns out to be newer.
     */
    writeRescue() {
      if (!this.board || !this._dirty) return;
      try { localStorage.setItem('dpo:rescue', D.store.boardText(this.snapshot())); } catch (_) { /* board too big: the DB copy stands */ }
    }

    /* Where you are looking is kept apart from the board. Writing it used
       to schedule a full save, so every pan ended in a re-serialisation of
       the whole board half a second after you let go — about 150ms on a
       2,000-stroke board, landing just as you put the pen down to pan
       again, which is why the hitch was only ever at the start of a move.
       It also rewrote the board file in the vault, and so churned the
       sync, for nothing but a scroll. The view now goes to a few bytes of
       localStorage, and rides along in the board record whenever the board
       is saved for a real edit. */
    saveView() {
      if (!this.board) return;
      this.board.camera = this.camera.toJSON();
      try { localStorage.setItem(VIEW + this.board.id, JSON.stringify(this.board.camera)); } catch (_) { }
    }

    savePrefs() {
      D.store.setPrefs({ theme: document.documentElement.dataset.theme, grid: this.renderer.grid, opts: this.opts });
    }

    /* ── boards ───────────────────────────────────────────────────── */
    async newBoard() {
      await this.saveNow(true);   // leaving this board: make its card current
      const b = D.store.newBoard('Untitled board');
      await D.store.save(b);
      this.setBoard(b);
      this.ui.closeSheet();
      this.toast('New board');
    }

    /** copy any board, open or not; the copy is saved but not opened. Its id, or null */
    async duplicateBoard(id = this.board.id) {
      const open = id === this.board.id;
      if (open && this._dirty) await this.saveNow(true);
      const src = open ? this.board : await D.store.load(id);
      if (!src) { this.toast('Could not read that board'); return null; }
      const b = D.store.newBoard((open ? $('#board-title').value || src.name : src.name) + ' copy');
      b.doc = open ? JSON.parse(this.scene.docText()) : src.doc;
      b.camera = open ? this.camera.toJSON() : src.camera;
      if (src.assets) b.assets = src.assets.slice();
      b.thumb = src.thumb; b.thumbTheme = src.thumbTheme;
      await D.store.save(b, true);
      this.toast('Made ' + b.name);
      return b.id;
    }

    /** rename any board; the open one's title follows */
    async renameBoard(id, name) {
      name = (name || '').trim() || 'Untitled board';
      if (id === this.board.id) {
        $('#board-title').value = name;
        this.board.name = name;
        this._edits = (this._edits || 0) + 1; this._dirty = true;
        return this.saveNow(false, true);
      }
      const b = await D.store.load(id);
      if (!b) return;
      b.name = name;
      await D.store.save(b, true);
    }

    /* Leaving a board: it is saved only if something changed (an unchanged
       board just gets its card picture refreshed in the list), and that
       write runs while the next board is being read rather than before. */
    async openBoard(id) {
      let leaving;
      // both take their picture of the screen before they first wait, while it still shows this board
      if (this._dirty) leaving = this.saveNow(true);
      else leaving = this.storeThumb(this.board, this.captureThumb());
      const [, b] = await Promise.all([
        leaving.catch(err => console.error('[dpo] saving the board left behind', err)),
        D.store.load(id)
      ]);
      if (b) this.setBoard(b);
      else this.toast('Could not open that board');
    }

    async deleteBoard(id) {
      /* The sweep below keeps the assets that saved boards refer to, so
         the board on screen has to be saved first: a picture pasted a
         moment ago is not in its saved copy yet. */
      if (this._dirty) await this.saveNow();
      await D.store.remove(id);
      try { localStorage.removeItem(VIEW + id); } catch (_) { }
      await D.store.sweepAssets();          // don't leave a deleted board's PDFs behind
      if (id === this.board.id) {
        const list = await D.store.list();
        const next = list[0] ? await D.store.load(list[0].id) : D.store.newBoard();
        if (!list[0]) await D.store.save(next);
        this.setBoard(next);
      }
    }

    /* ── import / export ──────────────────────────────────────────── */
    /** a .board carries its PDFs with it, so the file stands on its own */
    /** a .board file of any board, open or not, with its PDFs and pictures inside */
    async exportJSON(id = this.board.id) {
      const open = id === this.board.id;
      const b = open ? this.board : await D.store.load(id);
      if (!b) return this.toast('Could not read that board');
      const doc = open ? this.scene.toJSON() : b.doc;
      const name = open ? $('#board-title').value || b.name : b.name;
      const assets = {};
      for (const aid of new Set(doc.items.map(i => i.asset).filter(Boolean))) {
        const bytes = open ? await this.getAsset(aid) : await D.store.getAsset(aid);
        if (!bytes) continue;
        const meta = (b.assets || []).find(a => a.id === aid) || {};
        assets[aid] = { name: meta.name, type: meta.type, b64: D.store.toB64(bytes) };
      }
      const data = JSON.stringify({ app: 'draw-plan-order', v: 1, name, doc, assets });
      download(new Blob([data], { type: 'application/json' }), safeName(name) + '.board');
    }

    /** the theme and background an export is painted with — see opts.export */
    exportLook() {
      const o = this.opts.export;
      const theme = o.theme === 'light' || o.theme === 'dark' ? o.theme
        : document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      return { theme, dark: theme === 'dark', transparent: o.background !== 'paper' };
    }

    async exportSVG() {
      const b = this.scene.contentBounds();
      if (!b) return this.toast('Nothing to export');
      if (this._exporting) return;
      this._exporting = true;
      try {
        if (this.scene.items.some(i => i.type === 'pdfpage')) this.ui.toast('Exporting…', null, null, 60000);
        const svg = await this.renderer.toSVG(this.scene, b, this.exportLook());
        download(new Blob([svg], { type: 'image/svg+xml' }), safeName(this.board.name) + '.svg');
        this.ui.hideToast();
      } catch (err) {
        console.error(err);
        this.toast('The export did not finish: ' + (err.message || err));
      } finally { this._exporting = false; }
    }

    async exportPNG() {
      const b = this.scene.contentBounds();
      if (!b) return this.toast('Nothing to export');
      if (this._exporting) return;
      this._exporting = true;
      const c = document.createElement('canvas');
      try {
        const look = this.exportLook();
        const pad = 48, W = b.w + pad * 2, H = b.h + pad * 2;
        /* Twice the board's size for a crisp picture, but no bigger than a
           canvas can actually hold. The size used to be clamped while the
           scale stayed at 2, so anything past 4000 units across was simply
           cut off at the right and bottom; past the browser's real limits
           the canvas comes back blank instead. Scaling down keeps all of it. */
        const scale = Math.min(2, PNG_MAX_SIDE / W, PNG_MAX_SIDE / H, Math.sqrt(PNG_MAX_AREA / (W * H)));
        c.width = Math.max(1, Math.round(W * scale));
        c.height = Math.max(1, Math.round(H * scale));
        const ctx = c.getContext('2d');
        if (!look.transparent) {
          ctx.fillStyle = U.paintAs(look.theme, () => U.color('paper'));
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.setTransform(scale, 0, 0, scale, (-b.x + pad) * scale, (-b.y + pad) * scale);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (this.scene.items.some(i => i.type === 'pdfpage')) this.ui.toast('Exporting…', null, null, 60000);
        await this.renderer.paintExport(ctx, this.scene.items, scale, look);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        if (!blob) return this.toast('That board is too big to export as a PNG — try SVG');
        download(blob, safeName(this.board.name) + '.png');
        this.ui.hideToast();
      } catch (err) {
        console.error(err);
        this.toast('The export did not finish: ' + (err.message || err));
      } finally {
        c.width = 0; c.height = 0;          // a full-size export is a lot of memory to wait on GC for
        this._exporting = false;
      }
    }

    onFile(e) {
      const files = [...e.target.files];
      e.target.value = '';
      const at = this._fileAt || this.viewCentre();
      this._fileAt = null;
      files.forEach((f, i) => {
        // several pictures at once land in a short diagonal rather than in one pile
        const p = { x: at.x + i * 40, y: at.y + i * 40 };
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) this.insertPdf(f, p);
        else if (f.type.startsWith('image/') || /\.svg$/i.test(f.name)) this.insertImageFile(f, p);
        else this.importFile(f);
      });
    }

    importFile(file) {
      const fr = new FileReader();
      fr.onload = async () => {
        try {
          const j = JSON.parse(fr.result);
          const doc = j.doc || j;
          const b = D.store.newBoard(j.name || file.name.replace(/\.[^.]+$/, ''));
          b.doc = { v: 1, items: doc.items || [] };
          b.assets = [];
          for (const [id, a] of Object.entries(j.assets || {})) {
            await D.store.putAsset(id, D.store.fromB64(a.b64), { name: a.name, type: a.type });
            b.assets.push({ id, name: a.name, type: a.type });
          }
          await D.store.save(b);
          this.setBoard(b);
          this.ui.closeSheet();
          this.zoomToFit();
          this.toast('Imported ' + b.name);
        } catch (err) { this.toast('Could not read that file'); }
      };
      fr.readAsText(file);
    }
  }

  /* ── decision-tree helpers ──────────────────────────────────────── */
  class Tree {
    constructor(app) { this.app = app; }

    freeSpot(x, y, w, h) {
      const scene = this.app.scene;
      let ty = y;
      for (let i = 0; i < 60; i++) {
        const box = U.box(x - 12, ty - 12, x + w + 12, ty + h + 12);
        if (!scene.itemsInBox(box).some(it => it.type === 'node' || it.type === 'note')) return { x, y: ty };
        ty += h + 34;
      }
      return { x, y: ty };
    }

    create(parent, x, y, kind) {
      const app = this.app, scene = app.scene, o = app.opts.node;
      const w = parent ? parent.w : 170, h = parent ? parent.h : 68;
      const spot = this.freeSpot(x, y, w, h);
      const node = mk.node({
        kind: kind || 'process', x: spot.x, y: spot.y, w, h,
        color: o.color, fill: o.fill, size: o.size, textSize: parent ? parent.textSize : o.textSize
      });
      scene.begin('add node');
      scene.add(node);
      if (parent) {
        const e = app.opts.edge;
        scene.add(mk.edge({ from: { id: parent.id }, to: { id: node.id }, color: e.color, size: e.size, style: e.style, dash: e.dash, arrowEnd: e.arrowEnd }), 0);
      }
      scene.commit();
      app.setTool('select');
      app.select([node]);
      app.editor.open(node, { isNew: true });
      app.afterEdit();
      this.reveal(node);
      return node;
    }

    addChild(parent) {
      const b = this.app.scene.bbox(parent);
      return this.create(parent, b.x2 + 110, b.y, parent.kind === 'decision' ? 'process' : this.app.opts.node.kind);
    }

    addSibling(node) {
      const scene = this.app.scene;
      const b = scene.bbox(node);
      const edge = scene.items.find(i => i.type === 'edge' && i.to.id === node.id);
      const parent = edge && scene.get(edge.from.id);
      return this.create(parent, b.x, b.y2 + 40, node.kind);
    }

    /** nudge the camera so a freshly created node is on screen */
    reveal(node) {
      const cam = this.app.camera, b = this.app.scene.bbox(node);
      const a = cam.toScreen(b.x, b.y), c = cam.toScreen(b.x2, b.y2);
      const m = 90;
      let dx = 0, dy = 0;
      if (c.x > innerWidth - m) dx = innerWidth - m - c.x;
      if (a.x < m) dx = m - a.x;
      if (c.y > innerHeight - m) dy = innerHeight - m - c.y;
      if (a.y < m) dy = m - a.y;
      if (dx || dy) { cam.panBy(dx, dy); this.app.requestDraw(); }
    }
  }

  /* ── pinch/pan gesture ──────────────────────────────────────────── */
  function startGesture(ptrs, cam) {
    const [a, b] = ptrs;
    return {
      d: U.dist(a.clientX, a.clientY, b.clientX, b.clientY),
      cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2,
      zoom: cam.zoom
    };
  }
  function applyGesture(g, a, b, cam) {
    const d = U.dist(a.clientX, a.clientY, b.clientX, b.clientY);
    const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
    cam.panBy(cx - g.cx, cy - g.cy);
    if (g.d > 12) cam.zoomBy((d / g.d), cx, cy);
    g.d = d; g.cx = cx; g.cy = cy;
  }

  function pressureOf(e) {
    if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.35;
    if (e.pointerType === 'touch') return e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.6;
    return 0.55;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  /* What a PNG export may grow to. Chrome refuses canvases past 32767px a
     side or 268M pixels in all, and a quarter of that is already a gigabyte
     of RGBA to hold and encode — so stay well inside both. */
  const PNG_MAX_SIDE = 16384, PNG_MAX_AREA = 64e6;

  function dataUrlOf(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  }

  function safeName(s) { return (s || 'board').replace(/[^\w\-. ]+/g, '_').trim() || 'board'; }

  function readRescue() {
    try {
      const raw = localStorage.getItem('dpo:rescue');
      if (!raw) return null;
      const b = JSON.parse(raw);
      return b && b.id && b.doc ? b : null;
    } catch (_) { return null; }
  }
  function clearRescue() { try { localStorage.removeItem('dpo:rescue'); } catch (_) { } }

  /* ── pen and touch ── (see armHold, onTap and press.js) */
  const SELECTING = new Set(['select', 'lasso']);
  const HIT_PX = { touch: 16, pen: 10, mouse: 8 };        // App.hitPx
  const HANDLE_PAD = { touch: 12, pen: 6, mouse: 3 };     // App.handlePad
  const TAP_MS = 280;            // down to up, at most, for a tap
  const TAP_SLOP = { touch: 12, pen: 6, mouse: 4 };       // CSS px a tap may wander
  const DOUBLE_MS = 380;         // first tap up to second tap down
  const DOUBLE_SLOP = { touch: 28, pen: 12 };             // how far apart the two may land
  const DOUBLE_GUARD = 450;      // the browser's dblclick for a pair already handled
  const GRAB_GRACE = 300;        // longer to hold, for the menu, on what the select tool can drag
  const PEN_NEAR_MS = 1000;      // a finger held this soon after the pen was about is a palm
  const PALM_PX = 70;            // and so is a contact this wide (fingertips are 20–45)

  /* autosave: this long after the last edit, or at the next gap once work
     has gone this long unsaved (App.markDirty) */
  const SAVE_IDLE = 5000, SAVE_MAX = 60000;

  /** the last view of a board in this window, if it has one — see saveView */
  const VIEW = 'dpo:view:';
  D.readView = id => readView(id);
  function readView(id) {
    try {
      const c = JSON.parse(localStorage.getItem(VIEW + id));
      return c && isFinite(c.x) && isFinite(c.y) && c.zoom > 0 ? c : null;
    } catch (_) { return null; }
  }

  /** copy in whatever `src` has that `target` lacks, at any depth; nothing is overwritten */
  function fillIn(target, src) {
    for (const k in src) {
      const v = src[k];
      if (!(k in target)) target[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') fillIn(target[k], v);
    }
  }

  function deepAssign(target, src) {
    for (const k in src) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && target[k]) deepAssign(target[k], src[k]);
      else if (k in target) target[k] = src[k];
    }
  }

  /* ── go ─────────────────────────────────────────────────────────── */
  const app = new App();
  D.app = app;
  app.saveDebounced = U.debounce(() => app.saveSoon(), SAVE_IDLE);
  app.saveViewDebounced = U.debounce(() => app.saveView(), 500);
  app.savePrefs = U.debounce(app.savePrefs.bind(app), 400);
  app.start();

})(window.DPO);

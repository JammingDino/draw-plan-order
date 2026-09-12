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
      this.selection = [];
      this.clipboard = [];
      this.pointer = null;
      this.pointers = new Map();
      this.spaceDown = false;
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
        edge: { color: '#5b6472', size: 2, style: 'elbow', dash: 0, arrowEnd: true, arrowStart: false }
      };

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
      this.toolName = 'pen';
      this.tool = this.tools.pen;

      this.scene.onchange = () => { this.needBase = true; this.schedule(); };
      this.tree = new Tree(this);
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
      this.bindInput();
      this.bindHostMessages();
      this.setTool('pen');
      this.requestDraw();
      this.ui.refresh();
      this.registerServiceWorker();

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
      if (this.board && this.board.id !== board.id) { D.pdf.clear(); this._assets = new Map(); }
      this.board = board;
      this.scene.load(board.doc);
      this.camera.load(board.camera);
      $('#board-title').value = board.name;
      this.selection = [];
      D.store.setLast(board.id);
      this.requestDraw();
      if (this.ui) this.ui.refresh();
    }

    /* ── frame loop ───────────────────────────────────────────────── */
    schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this.frame(); });
    }
    requestDraw() { this.needBase = true; this.needLive = true; this.schedule(); }
    requestDrawLive() { this.needLive = true; this.schedule(); }
    startAnim() { this.anim = true; this.schedule(); }
    stopAnim() { this.anim = false; }

    frame() {
      const r = this.renderer;
      if (this.needBase) {
        this.needBase = false;
        r.drawScene();
        /* drawScene is what tells the PDF layer which pages are on
           screen, so the sweep belongs directly after it: any page not
           asked for during that pass has scrolled away, and its queued
           or in-flight render is now wasted work. */
        if (D.pdf && D.pdf.sweep) D.pdf.sweep();
      }
      if (this.needLive || this.anim) {
        this.needLive = false;
        const t = this.tool;
        if (t.incremental && t.item) t.paint(r);
        else {
          r.clearLive();
          this.selBox = this.selection.length ? r.drawSelection(this.selection, { handles: !this.editor.active }) : null;
          if (t.paint) t.paint(r);
        }
      }
      if (this.editor.active) this.editor.place();
      if (this.anim) this.schedule();
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
      this.toolName = name;
      this.tool = this.tools[name];
      if (name !== 'select' && name !== 'lasso') this.select([]);
      document.body.classList.toggle('grab', name === 'pan');
      if (this.ui) this.ui.refresh();
      this.requestDrawLive();
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
      stage.addEventListener('contextmenu', e => e.preventDefault());
      stage.addEventListener('wheel', e => this.onWheel(e), { passive: false });
      stage.addEventListener('dblclick', e => this.onDoubleClick(e));
      addEventListener('keydown', e => this.onKey(e));
      addEventListener('keyup', e => { if (e.code === 'Space') { this.spaceDown = false; document.body.classList.remove('grab'); } });
      addEventListener('paste', e => this.onPaste(e));
      addEventListener('blur', () => { this.spaceDown = false; });
      $('#file-input').addEventListener('change', e => this.onFile(e));
      addEventListener('dragover', e => e.preventDefault());
      addEventListener('drop', e => this.onDrop(e));
      // Save on the way out, three ways, because none of them is reliable alone:
      // hiding the tab is the last moment an async write can still finish,
      // pagehide/beforeunload only leave time for the synchronous mirror.
      addEventListener('visibilitychange', () => {
        if (document.hidden) { if (this._dirty) this.saveNow(); }
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
      if (this.editor.active) this.editor.close();
      // a primary press means nothing else is really down: drop anything stale
      // (pointers can go missing when the pen leaves the digitiser range)
      if (e.isPrimary) this.pointers.clear();
      else for (const [id, p] of this.pointers) if (performance.now() - p._t > 3000) this.pointers.delete(id);
      e._t = performance.now();
      this.pointers.set(e.pointerId, e);

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
      const eraserButton = e.pointerType === 'pen' && (e.buttons & 32 || e.button === 5);
      const middle = e.button === 1, right = e.button === 2;

      let tool;
      if (middle || right || this.spaceDown || touchPans) tool = this.tools.pan;
      else if (eraserButton) tool = this.tools.eraser;
      else tool = this.tool;

      this.active = tool;
      this.activeName = tool === this.tool ? this.toolName : (tool === this.tools.pan ? 'pan' : 'eraser');
      const ev = this.mkEv(e);
      this.pointer = ev;
      this.downId = e.pointerId;
      try { $('#stage').setPointerCapture(e.pointerId); } catch (_) { }
      tool.down(ev);
      this.requestDrawLive();
      e.preventDefault?.();
    }

    onMove(e) {
      if (this.pointers.has(e.pointerId)) { e._t = performance.now(); this.pointers.set(e.pointerId, e); }

      if (this.gesture && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        applyGesture(this.gesture, a, b, this.camera);
        this.requestDraw();
        if (this.ui) $('#btn-zoom-reset').textContent = Math.round(this.camera.zoom * 100) + '%';
        return;
      }

      const samples = [];
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const s of (list.length ? list : [e])) samples.push(this.mkEv(s));
      const ev = this.mkEv(e, samples);
      this.pointer = ev;

      if (this.active && e.pointerId === this.downId) this.active.move(ev);
      else if (this.toolName === 'eraser') this.requestDrawLive();
    }

    onUp(e, cancelled) {
      this.pointers.delete(e.pointerId);
      if (this.gesture && this.pointers.size < 2) { this.gesture = null; this.saveView(); }
      if (!this.active || e.pointerId !== this.downId) return;
      const ev = this.mkEv(e);
      if (cancelled && this.active.cancel) this.active.cancel();
      else this.active.up(ev);
      this.active = null;
      try { $('#stage').releasePointerCapture(e.pointerId); } catch (_) { }
      if (this.ui) this.ui.refresh();
      this.requestDrawLive();
    }

    onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * 0.0035);
        this.camera.zoomBy(f, e.clientX, e.clientY);
      } else if (e.shiftKey) {
        this.camera.panBy(-e.deltaY - e.deltaX, 0);
      } else {
        this.camera.panBy(-e.deltaX, -e.deltaY);
      }
      this.requestDraw();
      $('#btn-zoom-reset').textContent = Math.round(this.camera.zoom * 100) + '%';
      this.saveViewDebounced();
    }

    onDoubleClick(e) {
      const w = this.camera.toWorld(e.clientX, e.clientY);
      const hit = this.scene.hitTest(w.x, w.y, 8 / this.camera.zoom);
      if (hit && (hit.type === 'text' || hit.type === 'note' || hit.type === 'node')) {
        this.select([hit]); this.editor.open(hit, { selectAll: false });
      } else if (hit && hit.type === 'edge') {
        const label = prompt('Connector label', hit.label || '');
        if (label !== null) { this.scene.begin('label'); this.scene.touch(hit); hit.label = label; this.scene.commit(); this.afterEdit(); }
      } else if (!hit && this.toolName === 'select') {
        const o = this.opts.text;
        const it = mk.text({ x: w.x, y: w.y - o.size * 0.68, color: o.color, size: o.size, font: o.font, autoWidth: true, w: 40 });
        this.scene.begin('text'); this.scene.add(it); this.scene.commit();
        this.select([it]); this.editor.open(it, { isNew: true });
      }
    }

    /* ── keyboard ─────────────────────────────────────────────────── */
    onKey(e) {
      if (e.target.matches('input, textarea')) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;

      if (e.code === 'Space' && !this.spaceDown) { this.spaceDown = true; document.body.classList.add('grab'); e.preventDefault(); return; }

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
          case 's': e.preventDefault(); this.saveNow(); this.toast('Saved'); return;
          case 'm': e.preventDefault(); this.ui.openSheet(); return;
          case '0': e.preventDefault(); this.camera.zoomTo(1, innerWidth / 2, innerHeight / 2); this.requestDraw(); this.ui.refresh(); return;
          case '=': case '+': e.preventDefault(); this.camera.zoomBy(1.25, innerWidth / 2, innerHeight / 2); this.requestDraw(); this.ui.refresh(); return;
          case '-': e.preventDefault(); this.camera.zoomBy(0.8, innerWidth / 2, innerHeight / 2); this.requestDraw(); this.ui.refresh(); return;
          case "'": e.preventDefault(); this.cycleGrid(); return;
        }
        return;
      }

      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }
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
      if (k === 'F2' && this.selection.length === 1) { e.preventDefault(); this.editor.open(this.selection[0]); return; }
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
      if (map[low]) { this.setTool(map[low]); return; }
      if (shapeMap[low]) { this.opts.shape.kind = shapeMap[low]; this.setTool('shape'); return; }
    }

    /* ── editing commands ─────────────────────────────────────────── */
    undo() { this.scene.undo(); this.select([]); this.afterEdit(); }
    redo() { this.scene.redo(); this.select([]); this.afterEdit(); }

    deleteSelection() {
      if (!this.selection.length) return;
      this.scene.begin('delete');
      for (const it of this.selection) this.scene.remove(it);
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
      this.clipboard = this.selection.map(D.clone);
      // also offer it to the system clipboard, so it can be pasted into another board
      try { navigator.clipboard.writeText(JSON.stringify({ dpo: true, items: this.clipboard })).catch(() => { }); } catch (_) { }
    }

    pasteItems(items, at) {
      if (!items.length) return;
      let box = null;
      const tmp = new D.Scene({ items });
      for (const it of items) box = U.unionBox(box, tmp.bbox(it));
      const dx = at.x - (box.x + box.w / 2), dy = at.y - (box.y + box.h / 2);
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
      if (text) {
        try {
          const j = JSON.parse(text);
          if (j && j.dpo && Array.isArray(j.items)) { e.preventDefault(); this.pasteItems(j.items, at); return; }
        } catch (_) { }
        e.preventDefault();
        const o = this.opts.text;
        const it = mk.text({ x: at.x, y: at.y, text, color: o.color, size: o.size, w: 380 });
        this.scene.begin('paste text'); this.scene.add(it); this.scene.commit();
        this.setTool('select'); this.select([it]); this.afterEdit();
        return;
      }
      if (this.clipboard.length) { e.preventDefault(); this.pasteItems(this.clipboard, at); }
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

    insertImageFile(file, at) {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 520;
          const s = Math.min(1, max / Math.max(img.width, img.height));
          const it = mk.image({ src: fr.result, w: img.width * s, h: img.height * s });
          it.x = at.x - it.w / 2; it.y = at.y - it.h / 2;
          this.scene.begin('image'); this.scene.add(it); this.scene.commit();
          this.setTool('select'); this.select([it]); this.afterEdit();
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
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
    afterEdit() { this.markDirty(); this.requestDraw(); if (this.ui) this.ui.refresh(); }

    markDirty() {
      this._dirty = true;
      $('#save-state').textContent = 'saving…';
      this.saveDebounced();
    }

    async saveNow(force) {
      if (!this.board) return;
      this.snapshot();
      // the dashboard picture is cheap but not free: refresh it now and then,
      // and always when we are about to leave the board
      if (force) {
        this._thumbAt = Date.now();
        this.board.thumb = this.makeThumb();
        this.board.thumbTheme = document.documentElement.dataset.theme;
      } else if (Date.now() - (this._thumbAt || 0) > 6000) {
        /* Repainting the whole board and PNG-encoding it is not something to
           do in the middle of a stroke: on a busy board it is a visible hitch
           every few seconds. The card can wait for a gap in the drawing. */
        this._thumbAt = Date.now();
        this.queueThumb();
      }
      await D.store.save(this.board);
      this._dirty = false;
      $('#save-state').textContent = 'saved';
      clearRescue();
    }

    /**
     * A small picture of the board for the dashboard. Rendered with the
     * current theme, so it is refreshed whenever the board is opened or the
     * theme flips rather than cached forever.
     */
    makeThumb(w = 340, h = 212) {
      if (!this.scene.items.length) return null;      // the card shows a placeholder instead
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff';
      ctx.fillRect(0, 0, w, h);
      const b = this.scene.contentBounds();
      if (b && isFinite(b.w)) {
        const pad = 16;
        const z = Math.min((w - pad * 2) / Math.max(b.w, 1), (h - pad * 2) / Math.max(b.h, 1), 1.4);
        ctx.setTransform(z, 0, 0, z, (w - b.w * z) / 2 - b.x * z, (h - b.h * z) / 2 - b.y * z);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const it of this.scene.items) {
          try { this.renderer.drawItem(ctx, it); } catch (_) { }
        }
      }
      try { return c.toDataURL('image/webp', 0.7); } catch (_) { return c.toDataURL('image/png'); }
    }

    /** redraw the dashboard card once the user stops long enough not to notice */
    queueThumb() {
      if (this._thumbJob) return;
      const run = () => {
        this._thumbJob = null;
        if (!this.board || this.active) return;     // still drawing: catch it next time
        this.board.thumb = this.makeThumb();
        this.board.thumbTheme = document.documentElement.dataset.theme;
        this.markDirty();
      };
      this._thumbJob = self.requestIdleCallback
        ? requestIdleCallback(run, { timeout: 4000 })
        : setTimeout(run, 400);
    }

    /** refresh the thumbnail for the board that is open, then persist it */
    async refreshThumb() {
      if (!this.board) return;
      this.snapshot();                                // keep picture and content in step
      this.board.thumb = this.makeThumb();
      this.board.thumbTheme = document.documentElement.dataset.theme;
      await D.store.save(this.board);
    }

    /** copy the live scene into the board record */
    snapshot() {
      this.board.doc = this.scene.toJSON();
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
      try { localStorage.setItem('dpo:rescue', JSON.stringify(this.snapshot())); } catch (_) { /* board too big: the DB copy stands */ }
    }

    saveView() { this.board.camera = this.camera.toJSON(); this.saveDebounced(); }

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

    async duplicateBoard() {
      await this.saveNow(true);   // leaving this board: make its card current
      const b = D.store.newBoard(this.board.name + ' copy');
      b.doc = JSON.parse(JSON.stringify(this.scene.toJSON()));
      b.camera = this.camera.toJSON();
      await D.store.save(b);
      this.setBoard(b);
      this.ui.closeSheet();
    }

    async openBoard(id) {
      await this.saveNow(true);   // leaving this board: make its card current
      const b = await D.store.load(id);
      if (b) this.setBoard(b);
    }

    async deleteBoard(id) {
      await D.store.remove(id);
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
    async exportJSON() {
      const doc = this.scene.toJSON();
      const assets = {};
      for (const id of new Set(doc.items.map(i => i.asset).filter(Boolean))) {
        const bytes = await this.getAsset(id);
        if (!bytes) continue;
        const meta = (this.board.assets || []).find(a => a.id === id) || {};
        assets[id] = { name: meta.name, type: meta.type, b64: D.store.toB64(bytes) };
      }
      const data = JSON.stringify({ app: 'draw-plan-order', v: 1, name: this.board.name, doc, assets });
      download(new Blob([data], { type: 'application/json' }), safeName(this.board.name) + '.board');
    }

    exportSVG() {
      const b = this.scene.contentBounds();
      if (!b) return this.toast('Nothing to export');
      download(new Blob([this.renderer.toSVG(this.scene, b)], { type: 'image/svg+xml' }), safeName(this.board.name) + '.svg');
    }

    exportPNG() {
      const b = this.scene.contentBounds();
      if (!b) return this.toast('Nothing to export');
      const pad = 48, scale = 2;
      const c = document.createElement('canvas');
      c.width = Math.min(8000, (b.w + pad * 2) * scale);
      c.height = Math.min(8000, (b.h + pad * 2) * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(scale, 0, 0, scale, (-b.x + pad) * scale, (-b.y + pad) * scale);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const it of this.scene.items) this.renderer.drawItem(ctx, it);
      c.toBlob(blob => download(blob, safeName(this.board.name) + '.png'));
    }

    onFile(e) {
      const f = e.target.files[0];
      if (!f) return;
      const at = U.boxCenter(this.camera.viewport(innerWidth, innerHeight));
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) this.insertPdf(f, at);
      else if (f.type.startsWith('image/')) this.insertImageFile(f, at);
      else this.importFile(f);
      e.target.value = '';
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

  function deepAssign(target, src) {
    for (const k in src) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && target[k]) deepAssign(target[k], src[k]);
      else if (k in target) target[k] = src[k];
    }
  }

  /* ── go ─────────────────────────────────────────────────────────── */
  const app = new App();
  D.app = app;
  app.saveDebounced = U.debounce(() => app.saveNow(), 450);
  app.saveViewDebounced = U.debounce(() => app.saveView(), 500);
  app.savePrefs = U.debounce(app.savePrefs.bind(app), 400);
  app.start();

})(window.DPO);

/* ── taps.js ── finger taps, the way Procreate has them ───────────────
   Two fingers tapped together undo; three redo; two fingers held still
   keep undoing, faster the longer they stay down.

   Every one of those starts exactly as a pinch or a two-finger pan does,
   so a tap is only a tap once it is over: all the fingers came down
   close together, all lifted again quickly, and none of them travelled.
   A finger that moves, a pen or a mouse joining in, or a touch the
   system cancels, and it was a gesture after all. The fingers of a tap
   still nudge the view a little on their way down and up, so a tap puts
   the view back exactly where it was before doing anything.            */
(function (D) {
  'use strict';

  const TAP_MS = 320;          // first finger down to last finger up
  const JOIN_MS = 160;         // how far apart the fingers may land
  const SLOP = 14;             // CSS px a finger may wander and still be tapping
  const HOLD_MS = 550;         // two fingers still this long: start undoing
  const REPEAT_FIRST = 280, REPEAT_MIN = 90, REPEAT_FASTER = 0.82;

  class Taps {
    /**
     * @param app  { camera, undo(), redo(), requestDraw(), flash(text) }
     *             undo() and redo() return what they did, or null
     */
    constructor(app, now = () => performance.now()) {
      this.app = app;
      this.now = now;
      this.s = null;            // the touch sequence under way, if any
    }

    down(e) {
      if (e.pointerType !== 'touch') { if (this.s) this.s.dead = true; return; }
      const t = this.now();
      let s = this.s;
      if (!s) s = this.s = { t0: t, fingers: new Map(), live: 0, most: 0, moved: false, dead: false, cam: this.app.camera.toJSON(), repeats: 0 };
      if (t - s.t0 > JOIN_MS) s.dead = true;          // a finger arriving late: a gesture, not a tap
      s.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      s.live++;
      s.most = Math.max(s.most, s.live);
      clearTimeout(s.hold);
      if (s.live === 2 && !s.dead) s.hold = setTimeout(() => this.holding(), HOLD_MS);
    }

    move(e) {
      const s = this.s, f = s && s.fingers.get(e.pointerId);
      if (!f || s.moved) return;
      if (Math.hypot(e.clientX - f.x, e.clientY - f.y) > SLOP) {
        s.moved = true;
        this.stop();
      }
    }

    up(e, cancelled) {
      const s = this.s;
      if (!s || !s.fingers.has(e.pointerId)) return;
      s.fingers.delete(e.pointerId);
      if (cancelled) s.dead = true;
      s.live--;
      clearTimeout(s.hold);
      if (s.live > 0) return;

      this.stop();
      this.s = null;
      if (s.dead || s.moved || s.repeats || this.now() - s.t0 > TAP_MS) return;
      if (s.most === 2) this.act('undo', s);
      else if (s.most === 3) this.act('redo', s);
    }

    /** undo or redo, with the view back where the fingers found it */
    act(which, s) {
      const cam = this.app.camera;
      cam.x = s.cam.x; cam.y = s.cam.y; cam.zoom = s.cam.zoom;
      this.app.requestDraw();
      const op = this.app[which]();
      this.app.flash(op ? `${which === 'undo' ? 'Undo' : 'Redo'} ${describe(op)}` : `Nothing to ${which}`);
      return op;
    }

    /* two fingers held still: undo now, then again and again, faster */
    holding() {
      const s = this.s;
      if (!s || s.live !== 2 || s.moved || s.dead) return;
      let wait = REPEAT_FIRST;
      const step = () => {
        if (this.s !== s || s.live !== 2 || s.moved || s.dead) return;
        s.repeats++;
        if (!this.act('undo', s)) return;               // nothing left to undo: stop there
        wait = Math.max(REPEAT_MIN, wait * REPEAT_FASTER);
        s.repeat = setTimeout(step, wait);
      };
      step();
    }

    stop() {
      const s = this.s;
      if (!s) return;
      clearTimeout(s.hold);
      clearTimeout(s.repeat);
    }
  }

  /* history labels, as a person would say them */
  function describe(op) {
    const words = {
      draw: 'stroke', erase: 'erase', 'scribble erase': 'erase', 'snap shape': 'shape', shape: 'shape',
      move: 'move', resize: 'resize', delete: 'delete', duplicate: 'duplicate', paste: 'paste',
      'paste text': 'paste', text: 'text', 'edit text': 'text edit', note: 'sticky note', node: 'node',
      'add node': 'node', connector: 'connector', colour: 'colour', style: 'style change', group: 'group',
      image: 'picture', 'add pdf': 'PDF', label: 'label', edge: 'connector'
    };
    return words[op.label] || op.label || '';
  }

  Taps.TAP_MS = TAP_MS; Taps.HOLD_MS = HOLD_MS; Taps.SLOP = SLOP;
  D.Taps = Taps;
})(window.DPO);

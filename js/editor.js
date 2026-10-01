/* ── editor.js ── in-place text editing ─────────────────────────────
   A real <textarea> floats over the canvas, scaled to match the
   camera, so typing behaves exactly like typing anywhere else in
   Windows (IME, spellcheck off, selection, autorepeat…).            */
(function (D) {
  'use strict';
  const U = D.util;

  class TextEditor {
    constructor(app) {
      this.app = app;
      this.host = document.getElementById('overlay');
      this.ta = null;
      this.item = null;
      this.isNew = false;
    }

    get active() { return !!this.item; }

    open(item, opts = {}) {
      if (this.item === item) { this.ta.focus(); return; }
      this.close();
      this.item = item;
      this.isNew = !!opts.isNew;
      this.app.scene.begin('edit text');

      const ta = this.ta = document.createElement('textarea');
      ta.className = 'text-edit' + (item.type === 'node' || item.type === 'note' ? ' node' : '');
      ta.value = item.text || '';
      ta.spellcheck = false;
      ta.wrap = item.autoWidth ? 'off' : 'soft';
      this.host.appendChild(ta);
      this.place();

      ta.addEventListener('input', () => {
        item.text = ta.value;
        item._lines = null; item._b = null;
        if (item.type === 'text' && item.autoWidth) {
          const L = this.app.scene.layout(item);
          item.w = L.width;
        }
        this.place();
        this.app.requestDraw();
      });
      ta.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); this.close(); this.app.focusCanvas(); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.close(); }
        else if (e.key === 'Tab') {
          e.preventDefault();
          const it = this.item; this.close();
          if (it.type === 'node') this.app.tree.addChild(it);
        }
      });
      ta.addEventListener('pointerdown', e => e.stopPropagation());
      ta.addEventListener('blur', () => this.close());

      requestAnimationFrame(() => { ta.focus(); if (opts.selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length); });
      this.app.requestDraw();
    }

    /** keep the textarea glued to the item as the camera moves */
    place() {
      if (!this.item) return;
      const it = this.item, cam = this.app.camera, z = cam.zoom;
      const scene = this.app.scene;
      let x = it.x, y = it.y, w = it.w, size = it.size, color = it.color, align = it.align || 'left';

      if (it.type === 'note') { x += 14; y += 14; w -= 28; color = it.textColor || '#22252c'; }
      if (it.type === 'node') {
        const pad = it.kind === 'decision' ? it.w * 0.2 : 12;
        size = it.textSize || 15;
        const L = scene.layout({ text: it.text, size, w: it.w - pad * 2, font: it.font });
        x = it.x + pad; w = it.w - pad * 2;
        y = it.y + (it.h - L.lines.length * L.lh) / 2;
        color = it.textColor || it.color; align = 'center';
      }
      /* No nudging: the textarea's line boxes start where the painter's do,
         and the painter puts each baseline where CSS will (layout().base). */

      const p = cam.toScreen(x, y);
      const L = scene.layout(it.type === 'text' ? it : { text: it.text, size, w, font: it.font });
      const ta = this.ta;
      ta.style.left = p.x + 'px';
      ta.style.top = p.y + 'px';
      ta.style.width = Math.max(w, 30) + 'px';
      ta.style.height = Math.max(L.lines.length * L.lh, L.lh) + 'px';
      ta.style.font = L.font;
      ta.style.lineHeight = L.lh + 'px';
      ta.style.color = color;
      ta.style.textAlign = align;
      ta.style.transform = `scale(${z})`;
    }

    close() {
      if (!this.item) return;
      const it = this.item, ta = this.ta;
      this.item = null; this.ta = null;
      it.text = ta.value;
      it._lines = null; it._b = null;
      ta.remove();

      const scene = this.app.scene;
      // an empty text box is noise; an empty node or sticky is a placeholder
      if (!it.text.trim() && this.isNew && it.type === 'text') {
        // an abandoned empty box should leave no trace in the undo stack
        scene.cancel();
        scene.remove(it);
        const last = scene.undoStack[scene.undoStack.length - 1];
        if (last && last.adds.some(a => a.id === it.id)) scene.undoStack.pop();
        this.app.select([]);
      }
      else { scene.touch(it); scene.commit(); }
      this.app.requestDraw();
      this.app.markDirty();
    }
  }

  D.TextEditor = TextEditor;
})(window.DPO);

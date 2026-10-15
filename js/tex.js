/* ── tex.js ── typeset maths in text boxes and notes ───────────────────
   Write $…$ in a text box or a sticky note and what is between is set as
   maths: $\frac{F}{A} = \sigma$, $x^2 + y^2 = r^2$, $\sqrt{b^2-4ac}$.
   While the box is being edited it shows the source; the board shows it
   set. $$…$$ sets it in display style. A dollar is maths only the way
   Pandoc reads it — the opening $ not followed by a space, the closing
   one not after a space nor before a digit — so "$5 and $10" stays
   money; \$ is a dollar sign always.

   The setting is MathJax 3 (vendor/mathjax, Apache-2.0), SVG output, with
   every TeX extension built in so nothing is fetched. It is 2 MB of
   script, loaded the first time a board shows a $…$, never at start-up.
   Each expression is typeset once, kept as SVG, and drawn as a picture;
   the SVG export takes the SVG itself, so it stays vector there. Until
   the engine has done a piece, it is laid out as its source.

   D.tex.has(text)               does this text hold any maths?
   D.tex.split(text) → [{ s } | { tex, display }]
   D.tex.measure(tex, size, display) → { w, asc, desc } | null (not yet)
   D.tex.picture(tex, size, display, colour) → an image to draw, or null
   D.tex.svg(tex, size, display, colour) → SVG markup sized in px, or null
   D.tex.onready(fn)             fn() whenever more maths has been set
   D.tex.engine                  the MathJax object, once loaded; a test
                                 may put its own { tex2svg } here       */
(function (D) {
  'use strict';
  const U = D.util;
  const SRC = 'vendor/mathjax/tex-svg-full.js';
  const T = {};
  D.tex = T;
  /** @type {any} MathJax, once loaded; or a test's stand-in */
  T.engine = null;

  /* ── finding the maths ───────────────────────────────────────────── */
  T.has = text => typeof text === 'string' && text.includes('$') && T.split(text).some(p => p.tex != null);

  T.split = text => {
    const out = [];
    let buf = '', i = 0;
    const s = String(text);
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '$') { buf += '$'; i += 2; continue; }
      if (c === '$') {
        const display = s[i + 1] === '$';
        const open = display ? 2 : 1, start = i + open;
        const end = findClose(s, start, display);
        if (end > start && !/\s/.test(s[start])) {
          if (buf) { out.push({ s: buf }); buf = ''; }
          out.push({ tex: s.slice(start, end), display });
          i = end + open;
          continue;
        }
      }
      buf += c; i++;
    }
    if (buf) out.push({ s: buf });
    return out;
  };
  function findClose(s, from, display) {
    for (let j = from; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] !== '$') continue;
      if (display) { if (s[j + 1] === '$') return j; continue; }
      if (/\s/.test(s[j - 1]) || /[0-9]/.test(s[j + 1] || '')) continue;
      return j;
    }
    return -1;
  }

  /* ── the engine ──────────────────────────────────────────────────── */
  let loading = null;
  const listeners = [];
  T.onready = fn => listeners.push(fn);
  let tellQueued = false;
  function tell() {
    if (tellQueued) return;
    tellQueued = true;
    const run = () => { tellQueued = false; for (const fn of listeners) { try { fn(); } catch (err) { console.error('[dpo] tex', err); } } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
  }

  function load() {
    if (T.engine) return Promise.resolve(T.engine);
    if (loading) return loading;
    if (typeof document === 'undefined' || !document.head || !document.head.appendChild) return Promise.reject(new Error('no page to load MathJax into'));
    const g = window;
    g.MathJax = {
      loader: { load: [] },
      startup: { typeset: false },
      // everything is built in: never reach for the network
      tex: { packages: { '[-]': ['autoload', 'require'] } },
      svg: { fontCache: 'none' }
    };
    loading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = new URL(SRC, document.baseURI).href;
      sc.async = true;
      sc.onload = () => {
        const mj = g.MathJax;
        Promise.resolve(mj && mj.startup && mj.startup.promise).then(() => {
          T.engine = { tex2svg: (tex, display) => mj.tex2svg(tex, { display }) };
          resolve(T.engine);
          tell();
        }, reject);
      };
      sc.onerror = () => { loading = null; reject(new Error('Could not load the maths typesetter')); };
      document.head.appendChild(sc);
    });
    loading.catch(err => console.warn('[dpo] tex:', err.message));
    return loading;
  }

  /* One expression, set: its SVG with the colour left as currentColor, and
     its size in ex (MathJax's SVG output takes 1ex as half an em). */
  const set = new Map();                // tex|display → { svg, w, h, v, err } (ex)
  const EX = 0.5;
  function typeset(tex, display) {
    const key = (display ? 'D' : 'I') + tex;
    if (set.has(key)) return set.get(key);
    if (!T.engine) { load().catch(() => { }); return null; }
    let rec;
    try {
      const node = T.engine.tex2svg(tex, display);
      const svg = node.querySelector ? node.querySelector('svg') : node;
      const exOf = v => parseFloat(String(v || '0').replace('ex', '')) || 0;
      const style = (svg.getAttribute && svg.getAttribute('style')) || '';
      const v = /vertical-align:\s*(-?[\d.]+)ex/.exec(style);
      const err = !!(svg.querySelector && svg.querySelector('[data-mjx-error]'));
      rec = { svg: svg.outerHTML, w: exOf(svg.getAttribute('width')), h: exOf(svg.getAttribute('height')), v: v ? parseFloat(v[1]) : 0, err };
    } catch (e) {
      rec = { svg: null, w: 0, h: 0, v: 0, err: true };
    }
    set.set(key, rec);
    return rec;
  }

  /** its size in px at text size `size`: width, and how far it reaches above and below the baseline */
  T.measure = (tex, size, display = false) => {
    const r = typeset(tex, display);
    if (!r || !r.svg) return null;
    const ex = size * EX;
    const desc = Math.max(0, -r.v) * ex;
    return { w: r.w * ex, asc: r.h * ex - desc, desc, err: r.err };
  };

  /** the SVG, sized in px and in one colour, for the SVG export or a picture */
  T.svg = (tex, size, display, colour) => {
    const r = typeset(tex, display);
    if (!r || !r.svg) return null;
    const ex = size * EX;
    return r.svg
      .replace(/width="[^"]*ex"/, `width="${U.round(r.w * ex, 2)}"`)
      .replace(/height="[^"]*ex"/, `height="${U.round(r.h * ex, 2)}"`)
      .replace(/style="[^"]*"/, '')
      .replace(/currentColor/g, colour);
  };

  /* Pictures to draw: decoded once per expression, size bucket and
     colour. The size is snapped so a pinch does not decode a new one
     every frame; drawImage scales the rest. */
  const pics = new Map();
  T.picture = (tex, size, display, colour) => {
    const k = Math.max(8, Math.round(size * 2) / 2);
    const key = colour + '|' + k + '|' + (display ? 'D' : 'I') + tex;
    const have = pics.get(key);
    if (have) return have.ready ? have.img : null;
    const svg = T.svg(tex, k * 4, display, colour);     // drawn at 4× its size, so it stays sharp zoomed in
    if (!svg || typeof Image === 'undefined') return null;
    const img = new Image();
    const rec = { img, ready: false };
    pics.set(key, rec);
    img.onload = () => { rec.ready = true; tell(); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
    return null;
  };

  T.load = load;
  T._reset = () => { set.clear(); pics.clear(); };

  /* More maths set: the boxes holding it are laid out again (now that its
     size is known) and painted. Not an edit — nothing is in the history. */
  D.ext.on('ready', app => T.onready(() => {
    for (const it of app.scene.items) if ((it.type === 'text' || it.type === 'note') && T.has(it.text)) app.scene.dirty(it);
    app.requestDraw();
  }));

  /* ── the other way: what is on the board, as LaTeX ─────────────────
     A calc block, a handwritten answer or a graph, as LaTeX to paste into
     a report — or set beside it on the board. math.js writes the TeX
     (Node.toTex); an answer it cannot read back (a unit math.js does not
     know) goes in as \text{…}. */
  const READER = s => String(s).replace(/−/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/√/g, 'sqrt').replace(/π/g, 'pi').replace(/θ/g, 'theta');
  /* A name the working defines is a variable (F, L), not the unit math.js
     would take it for (farad, litre); everything else — "3 m", an
     answer's "kN·m" — is left to math.js, which knows its units. `vars`
     is those names, or true for "every lone letter" (a handwritten line,
     whose letters are always variables). Braced, so \cdot{L} stays TeX. */
  const MARK = '\u0001';
  const variables = vars => node => node.type === 'SymbolNode' && (vars === true ? /^[A-Za-z]$/.test(node.name) : vars && vars.has(node.name)) ? MARK + node.name : undefined;
  function texOf(M, src, vars) {
    try {
      const tex = M.parse(READER(src)).toTex({ parenthesis: 'auto', implicit: 'hide', handler: vars ? variables(vars) : undefined });
      // a variable straight after a command needs a space (\cdot L, not \cdotL); anywhere else, nothing
      return tex.replace(new RegExp('(\\\\[a-zA-Z]+)' + MARK, 'g'), '$1 ').split(MARK).join('');
    }
    catch (_) { return '\\text{' + String(src).replace(/[\\{}$&#^_%~]/g, c => '\\' + c) + '}'; }
  }
  async function latexOf(it) {
    const M = await D.math.ready();
    if (it.type === 'calc') {
      const lines = String(it.text || '').split('\n'), res = it.res || [];
      const rows = [];
      const DEF = /^([A-Za-zα-ωΑ-Ω_][\w′']*)\s*=(?!=)\s*(.+)$/;
      // the names the block sets: those are its variables
      const names = new Set(lines.map(l => DEF.exec(l.replace(/#.*$/, '').trim())).filter(Boolean).map(m => m[1]));
      lines.forEach((line, i) => {
        const src = line.replace(/#.*$/, '').trim();
        if (!src) return;
        const ans = res[i] && res[i].t;
        const def = DEF.exec(src);
        if (def) {
          const rhs = texOf(M, def[2], names), a = ans ? texOf(M, ans) : null;
          rows.push(`${texOf(M, def[1], names)} &= ${rhs}${a && a !== rhs ? ' = ' + a : ''}`);
        } else rows.push(`${texOf(M, src, names)}${ans ? ' &= ' + texOf(M, ans) : ''}`);
      });
      return rows.length > 1 ? `\\begin{aligned}\n${rows.join(' \\\\\n')}\n\\end{aligned}` : (rows[0] || '').replace(' &= ', ' = ');
    }
    if (it.type === 'inkresult') return `${texOf(M, it.expr || '', true)} = ${texOf(M, it.text || '')}`;
    if (it.type === 'graph') return (it.fns || []).map(f => 'y = ' + texOf(M, f, true)).join(',\\quad ');
    return '';
  }
  T.latexOf = latexOf;
  const CAN = new Set(['calc', 'inkresult', 'graph']);
  const one = ctx => ctx.selection.length === 1 && CAN.has(ctx.selection[0].type);
  const TEX_ICON = 'M5 6h8|M9 6v12|M14 10l5 8|M19 10l-5 8';
  D.ext.pressActions.push({
    id: 'copy-latex', label: 'Copy as LaTeX', icon: TEX_ICON, order: 70, when: one,
    run: async ctx => {
      const tex = await latexOf(ctx.selection[0]);
      try { await navigator.clipboard.writeText(tex); ctx.app.toast('Copied as LaTeX'); }
      catch (_) { ctx.app.toast('Could not reach the clipboard'); }
    }
  }, {
    id: 'typeset', label: 'Typeset beside it', icon: TEX_ICON, order: 71, when: one,
    run: async ctx => {
      const app = ctx.app, it = ctx.selection[0], tex = await latexOf(it);
      if (!tex) return;
      const b = app.scene.bbox(it);
      const box = D.make.text({ x: b.x2 + 30, y: b.y, w: 420, autoWidth: true, text: '$$' + tex + '$$', size: it.size || 18, color: 'ink' });
      app.scene.begin('typeset'); app.scene.add(box); app.scene.commit();
      app.setTool('select'); app.select([box]); app.afterEdit();
    }
  });

  /* ── laying out a line of words and maths ──────────────────────────
     scene.layout calls this for text that holds maths. `measure(s)` is
     the text's width in the box's font. Returns the lines as runs, each
     line with its baseline from the top of the box and its height; a
     line of plain words is as tall as it always was, and one with maths
     in it grows to fit. */
  T.layout = (text, size, maxW, autoWidth, measure, lh, base) => {
    const lines = [];
    const space = measure(' ');
    /* atoms: words, line breaks, and each piece of maths whole — found
       across the whole text first, so $$…$$ may run over several lines */
    /** @type {any[]} */
    const atoms = [];
    for (const part of T.split(text)) {
      if (part.tex != null) {
        const m = T.measure(part.tex, size, part.display);
        const src = (part.display ? '$$' : '$') + part.tex + (part.display ? '$$' : '$');
        if (m && !m.err) atoms.push({ tex: part.tex, display: part.display, w: m.w, asc: m.asc, desc: m.desc, src });
        // not set yet, or not TeX: its source, line by line, as typed
        else src.split('\n').forEach((s, k) => { if (k) atoms.push({ br: true }); if (s) atoms.push({ s, w: measure(s), src: s, pending: !m }); });
        continue;
      }
      part.s.split('\n').forEach((para, k) => {
        if (k) atoms.push({ br: true });
        para.split(' ').forEach((w, j) => {
          if (j > 0) atoms.push({ gap: true, src: ' ' });
          if (w) atoms.push({ s: w, w: measure(w), src: w });
        });
      });
    }
    let line = [], width = 0;
    const flush = () => {
      while (line.length && line[line.length - 1].gap) line.pop();
      lines.push(line); line = []; width = 0;
    };
    for (const a of atoms) {
      if (a.br) { flush(); continue; }
      if (a.gap) { if (line.length) { line.push(a); width += space; } continue; }
      if (!autoWidth && line.length && width + a.w > maxW) flush();
      line.push(a); width += a.w;
    }
    flush();
    // place each line: its runs' x, its baseline, its height
    let top = 0, widest = 0;
    const out = lines.map(atoms => {
      let x = 0, asc = base, desc = lh - base;
      const runs = [];
      for (const a of atoms) {
        if (a.gap) { x += space; continue; }
        if (a.tex != null) { runs.push({ tex: a.tex, display: a.display, x, w: a.w, asc: a.asc, desc: a.desc }); asc = Math.max(asc, a.asc + 2); desc = Math.max(desc, a.desc + 2); }
        else {
          // consecutive words go as one run, as fillText would draw them
          const last = runs[runs.length - 1];
          if (last && last.s != null && last.end === x - space) { last.s += ' ' + a.s; last.w = x + a.w - last.x; last.end = x + a.w; }
          else if (last && last.s != null && last.end === x) { last.s += a.s; last.w = x + a.w - last.x; last.end = x + a.w; }
          else runs.push({ s: a.s, x, w: a.w, end: x + a.w });
        }
        x += a.w;
      }
      const ln = { runs, w: x, y: top + asc, top, h: asc + desc, src: atoms.map(a => a.src).join('') };
      top += asc + desc;
      widest = Math.max(widest, x);
      return ln;
    });
    return { lines: out, width: widest, height: top };
  };

})(window.DPO);

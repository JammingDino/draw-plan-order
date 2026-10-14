/* ── ext.js ── the extension registry ─────────────────────────────────
   Features plug in here instead of editing the core. A feature file
   (js/calc.js, js/cad.js, …) loads after ui.js and before app.js, pushes
   what it adds onto D.ext, and the core picks it up as it starts: the App
   constructor reads opts and tools, the UI reads tools, buttons and
   settings as it builds, and the scene and the painter consult `items`
   whenever they meet a type they do not know themselves.

   Nothing registered costs nothing. The core only looks an item type up
   here in the branch it used to fall through to, and an event nobody
   listens to is one property read.

   ── The contract ─────────────────────────────────────────────────────

   D.ext.opts[name] = { …defaults }
       Merged into app.opts in the App constructor, before saved prefs
       are applied, so saved prefs win. A name the core already has
       (e.g. 'general') gets only the keys it lacks. app.opts[name] is
       saved with the rest of the prefs; a tool whose name matches gets
       the 1–8 colour keys for free if it has a `color`.

   D.ext.tools.push({ name, create(app) → tool, rail, panel(ui) })
       create(app)  returns an object with the tools.js interface:
                    down(ev) move(ev) up(ev) cancel() paint(renderer).
                    Set `incremental` + `item` only if paint() appends to
                    the live layer without clearing it (see PenTool).
                    The instance lands in app.tools[name]; app.setTool(name)
                    selects it.
       rail         optional { icon, key, title, after, flyout, get, set }.
                    icon: an <svg> string, or path data in the ICON map's
                    style ('M…|M…', 24×24, stroked). key: a single plain
                    key ('m'), case-insensitive; it is asked before the
                    built-in letters, so it can take B (only an alias for
                    the pen) — and could take P, so don't. after: the
                    id of the rail entry to follow ('connector', 'pen', or
                    another registered tool); otherwise it goes before the
                    laser/pan group. flyout/get/set work as in UI.buildRail.
       panel(ui)    optional; builds the style panel while the tool is
                    active, with ui.add(…) and ui.group/swatches/sizes/seg/
                    slider/check. Without it the panel shows the general one.

   D.ext.items[type] = handlers                        (for item.type === type)
       bbox(it) → {x,y,w,h}       REQUIRED. World units. The core adds x2/y2
                                  and caches the result in it._b until the
                                  item next changes.
       draw(ctx, it, renderer)    REQUIRED. World space, like the built-in
                                  painters; drawItem has already done
                                  ctx.save(), set globalAlpha from it.alpha,
                                  and restores afterwards. renderer.app.scene,
                                  renderer.tokens(), renderer.paintZoom and
                                  renderer.editing(ctx, it) are there to use.
       hit(it, x, y, tol) → bool  Pointer hit test. Only called once (x,y) is
                                  within the bbox grown by tol. Default: true,
                                  i.e. anywhere inside the bbox.
       translate(it, dx, dy)      Default: it.x += dx; it.y += dy. During a
                                  select-tool drag it is applied to a fresh
                                  copy of the item as it was when the drag
                                  began (the drag re-applies from the start
                                  every frame), so it must be absolute, not
                                  cumulative state. Grid snapping is skipped
                                  for items with their own translate.
       scale(it, origin, sx, sy)  Resize. origin is {x,y}, the world point
                                  that stays put; sx/sy are factors and may
                                  be negative (a flip). Like translate, the
                                  item has been restored to its state at the
                                  start of the resize first. Default: x/y/w/h
                                  scaled about origin, as notes and images are.
       solid                      true (default): the eraser and scribble test
                                  it by its whole bbox, like a note. false: by
                                  outline(it), else hit(), else its bbox edge.
       erasable                   false (default). true lets the eraser and
                                  scribble-erase take it (D.erasable).
       svg(it, renderer) → string SVG markup for the export, in world units,
                                  in the export's theme (U.color('ink') is
                                  right). The core wraps it in <g opacity>
                                  when it.alpha < 1. Default: left out of
                                  the export.
       edit(app, it)              Double-click and F2. The item is selected
                                  first. Default: nothing.
       panel(ui, items)           The style panel when every selected item is
                                  of this type. The Arrange row (front, back,
                                  duplicate, group, delete) is added after it.
                                  ui.apply(items, fn) restyles them as one
                                  undo step. Default: the generic panel.
     Additions beyond issue #1, all optional:
       outline(it) → [x,y,x,y,…]  The item as a flat polyline: what the lasso
                                  and a non-solid erase test against.
                                  Default: the bbox rectangle.
       backdrop                   true: treated like a PDF page or picture —
                                  the select tool only picks it up on a hold
                                  or a tap (D.backdrop). Default false.
       label                      The style panel's heading for one of these.
       rotate                     How it turns (Scene.rotateItem). 'box': it keeps
                                  an angle in it.rot, about the middle of its box,
                                  and is painted, hit, outlined, snapped to and
                                  exported turned — draw, hit and outline work
                                  unturned and the core turns them. A function
                                  (it, origin, ang, scene): it turns itself (ang
                                  in radians, clockwise on screen). Default: it
                                  is only carried round, by the middle of its box.
       enclose                    true: a lasso takes it only when it goes all the
                                  way round its outline (a page), not when it
                                  merely holds its middle. Default false.

     Caches: anything on an item whose key starts with '_' is left out of
     saves, undo and copies. Of those, the core clears _b, _path, _lod,
     _lines and _json whenever an item changes, so derived geometry belongs
     in _path or _lines; any other _field is never invalidated. _z, _b,
     _json, _ends and _at are the core's own.
     An item type nobody has registered still round-trips through save,
     load, copy, paste and undo untouched; it is simply not drawn, and if
     it has no x/y/w/h it boxes to nothing (never hit, never in bounds).
     Also worth knowing: connectors attach only to built-in types
     (Scene.hitNode); draw() is called for the board, the live layer (a
     tool may r.drawItem(r.liveWorld(), item) its item in progress), the
     boards-sheet preview — whose renderer.app is a stand-in with only
     scene, camera and getAsset — and the PNG export; a type's own fields
     are free-form, but `id`, `type`, `group` and `alpha` mean what they
     mean for every item.

   D.ext.buttons.push({ id, icon, title, where: 'top' | 'view', onClick(app) })
       A button in the top bar (before the theme button) or the zoom bar.
       icon as for rail.icon. id becomes the element id.

   D.ext.pressActions.push({ id, label, icon, order, when(ctx) → bool, run(ctx) })
       Long-press actions. Only collected here; the touch step (js/press.js)
       decides what ctx holds and when they are offered.

   D.ext.settings.push({ id, title, sub, icon, render(ui) → Element[] })
       An extra Settings section, listed after Export and before Help.
       render builds the body with ui.setGroup/setRow/setToggle/setSeg/
       setStack/setLabel/setNote/setButton. icon is optional.

   D.ext.on(name, fn) / off(name, fn) / emit(name, …args) → bool
       Handlers run in the order they were added. emit stops at the first
       handler that returns true and returns true; otherwise false. A
       handler that throws is logged and skipped, so one feature cannot
       take the core down with it. has(name) says whether anyone listens.

     event    args          emitted
     ready    app           end of App.start(), once the UI is up
     board    app, board    end of App.setBoard
     tool     app, name     end of App.setTool
     select   app, items    end of App.select (also the quiet ones a
                            marquee makes on every move)
     change   app           App.afterEdit, after every committed edit
     stroke   app, item     after the pen tool commits a stroke (not the
                            highlighter, nor a snapped shape or a scribble
                            that erased)
     key      app, e        App.onKey, straight after the input/textarea
                            guard — so also while the boards sheet is open.
                            Return true to consume the key.
     frame    app, ctx      after a full repaint of the live layer, with
                            ctx in screen space (CSS px), for overlays.
                            Not while the pen is appending ink to it; call
                            app.requestDrawLive() to get another one.   */
(function (D) {
  'use strict';

  /* name → handler list. Lists are replaced, never edited in place, so a
     handler that calls on() or off() while an event is going round does
     not upset the loop that is calling it — and emit() never has to copy
     anything to be safe, which matters for 'frame'. */
  const listeners = Object.create(null);

  D.ext = {
    opts: {},
    tools: [],
    /* no prototype: an item type is a free-form string from a saved file,
       and must not find 'constructor' or 'toString' in here */
    items: Object.create(null),
    buttons: [],
    pressActions: [],
    settings: [],

    on(name, fn) {
      listeners[name] = (listeners[name] || []).concat(fn);
      return fn;
    },

    off(name, fn) {
      const list = listeners[name];
      if (!list) return;
      const rest = list.filter(f => f !== fn);
      if (rest.length) listeners[name] = rest; else delete listeners[name];
    },

    has(name) { return !!listeners[name]; },

    emit(name, ...args) {
      const list = listeners[name];
      if (!list) return false;
      for (const fn of list) {
        try { if (fn(...args) === true) return true; }
        catch (err) { console.error('[dpo] ' + name + ' handler', err); }
      }
      return false;
    }
  };

})(window.DPO);

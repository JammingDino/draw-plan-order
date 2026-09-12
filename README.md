# Draw · Plan · Order

An endless canvas for pen, keyboard and decision trees. Plain HTML/CSS/JS —
no build step, no dependencies, no account. Everything lives on your machine.

## Running it

Double-click **`start.cmd`**. It serves the folder on <http://localhost:5273>
and opens your browser. (Serving over `http://` rather than opening
`index.html` directly is what lets the app use IndexedDB, so boards survive a
restart; opened as a file it falls back to `localStorage`.)

### The desktop app

```bash
npm install
npm run app:build
```

Produces a Windows installer at
`src-tauri/target/release/bundle/nsis/Draw Plan Order_0.1.0_x64-setup.exe`,
and the bare `.exe` next to it. It is a Tauri shell — a few megabytes, using
the WebView2 runtime Windows already ships, so pen pressure and coalesced
pointer events behave exactly as they do in Edge. `npm run app:dev` runs it
against the live source.

`tools/pack.py` mirrors the web files into `dist/` first, so the bundle never
picks up `src-tauri/`, `node_modules/` or the tooling. Native file
drag-and-drop is switched off in `tauri.conf.json` so the canvas keeps
handling dropped images itself.

The desktop app keeps its boards in its own WebView2 profile — separate from
whatever you have in the browser. Move work across with ↧ Export .board / ↥
Import.

### Making it a standalone app in the browser instead

Open the ☰ menu and press **Install as an app** (or use Edge's ⋯ → *Apps →
Install this site as an app*). You get a real window with no browser
chrome, its own taskbar and Start-menu entry, and it opens straight into the
canvas.

A service worker caches the whole app on first run, so the installed app
launches **without `start.cmd` running and with no network**. Your boards
live in the browser profile's IndexedDB, on your machine only.

Add `?scratch=1` to the URL for a throwaway board that never touches your
saved work — handy for trying something out.

## Pen behaviours worth knowing

| Gesture | What happens |
| --- | --- |
| Draw a rough shape and **hold the pen still** at the end | It snaps to a clean rectangle, ellipse, diamond, triangle, line or arrow. A label tells you what it recognised; keep moving to carry on drawing instead. |
| **Scribble** back and forth over ink | The ink underneath is rubbed out, with an *Undo* toast. Handwriting and normal loops are not mistaken for scribbles. |
| **Flip the Surface Pen** and rub | Erases, whatever tool you had selected. Let go and you are back on your previous tool. A ring shows the eraser's size, and appears as soon as the blunt end is in range — before you touch the glass — so you can see what you are about to take off. |
| Draw a near-straight line | It is quietly straightened, and snapped to 0/45/90° if it is close. |
| Erase over a PDF, image, sticky or node | Only your ink comes off. Those are hit-tested by their whole area, so an eraser stroke *across* one would otherwise delete the lot — remove them deliberately, with the select tool and <kbd>Delete</kbd>. |
| **Finger** on the canvas | Always pans and pinch-zooms, whatever tool is selected — so you can sketch, shove the page along, and sketch some more without putting the pen down. Your palm can rest anywhere, and a mouse or pen still draws normally. Turn it off under ☰ → Settings if you would rather draw with a finger. |

Both of the "clever" behaviours can be switched off in the style panel under
the pen tool.

## Tools

Pen (pressure-sensitive, tapered), highlighter, eraser (whole-stroke or
pixel), rectangle/ellipse/diamond/triangle/line/arrow, text boxes, sticky
notes, flow-chart nodes (process, decision, start/end, data), connectors that
stay attached as you move things, laser pointer, lasso and marquee select,
images by paste or drag-and-drop.

### PDFs

Drag a PDF onto the canvas (or ☰ → **Add a PDF**) and its pages are laid out
down the board for you to write on. They go behind whatever is already there,
so annotations always sit on top.

Pages are not flattened into pictures at import. The file is stored once and
each page is rendered on demand at a resolution that suits the current zoom —
so a 40-page PDF costs one copy of the file rather than forty bitmaps, and
zooming in to annotate gives you a sharper page rather than a blurry one. A
`.board` export carries its PDFs inside it, so the file still stands alone.

On a dark board the pages are rendered dark rather than left as white
floodlights: each page is luminance-inverted as it is rendered, so the paper
goes near-black and the text goes light while colours keep their hue — a red
stamp stays red instead of turning cyan. Flipping the theme re-renders the
handful of pages on screen; the document itself is never re-read.

pdf.js is vendored under `vendor/pdfjs` (including the base-14 font data and
CJK cmaps) so this works with no network at all, in the desktop app too.

### Decision trees

Draw a node, then with it selected press <kbd>Tab</kbd> for a child or
<kbd>Enter</kbd> for a sibling. The box is placed in free space, connected
with an elbow connector, and put straight into text-edit mode — so a whole
tree is Tab, type, Tab, type. Connectors re-route themselves whenever a node
moves; double-click a connector to label it (*yes* / *no*).

## Keyboard

`V` select · `G` lasso · `P` pen · `H` highlighter · `E` eraser · `R` rectangle ·
`O` ellipse · `L` line · `A` arrow · `D` diamond · `T` text · `K` sticky ·
`N` node · `C` connector · `Q` laser · `Space` pan

`1`–`8` colour · `[` `]` z-order · `F2` edit text · `Ctrl+D` duplicate ·
`Ctrl+G` group · `Ctrl+A` select all · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo ·
`Ctrl+0` reset zoom · `Shift+1` zoom to fit · `Ctrl+'` cycle grid ·
`Ctrl+M` boards · `Alt`+drag duplicates · `Shift` constrains

## Boards and files

The ☰ menu (<kbd>Ctrl</kbd>+<kbd>M</kbd>) is a dashboard of every board as a
card with a live thumbnail, item count and when you last touched it, newest
first — so it doubles as a recents list. Type to filter by name. Thumbnails
are re-rendered when you leave a board and every few seconds while you work.

It also holds export to `.board` (loss-free JSON), PNG and SVG, and import of
anything exported. Autosave runs about half a second
after you stop working; the top bar says `saved` when it is done.

If the tab is closed or reloaded inside that window, the pending changes are
mirrored to `localStorage` on the way out (synchronous, so it always
completes) and replayed on the next start, with a *Recovered N unsaved items*
toast. Hiding the tab also forces a full save.

## Layout of the code

| File | Role |
| --- | --- |
| `js/util.js` | Geometry, hit-testing maths, semantic `ink`/`paper` colours |
| `js/freehand.js` | Pressure → stroke outline (one filled polygon per stroke) |
| `js/recognize.js` | Shape recognition and scribble detection |
| `js/scene.js` | Document model, undo/redo, bounding boxes, edge routing |
| `js/camera.js` | Infinite-canvas viewport |
| `js/render.js` | Canvas painting and SVG export |
| `js/tools.js` | One small state machine per tool |
| `js/pdf.js` | Lazy page rendering for dropped PDFs |
| `js/editor.js` | In-place text editing |
| `js/store.js` | IndexedDB / localStorage persistence |
| `js/ui.js` | Tool rail, contextual style panel, sheets |
| `js/app.js` | Input plumbing, selection, files, decision-tree helpers |
| `js/perf.js` | Frame counter, off unless asked for |

Two stacked canvases keep it quick: `#base` holds the committed scene and is
only redrawn when something changes, `#live` holds the stroke currently under
the pen. Opaque strokes are appended to the live layer incrementally, so ink
latency does not grow with the size of the board.

Scene queries — what to repaint, what you just tapped, what the eraser
crossed — go through a uniform grid over bounding boxes rather than a walk
of every item. The grid is rebuilt whenever `scene.version` moves rather
than patched on each edit: the rebuild is one pass over cached boxes, and
it leaves the index unable to disagree with the scene.

Strokes drop to a cheaper form once the nib is thinner than about a pixel
on screen. A stroke is normally a filled outline — a quad per segment plus
a disc at every join — which is what gives it pressure, taper and round
ends, and is wasted effort when none of that can land on a pixel. Below
the threshold it is drawn as its centreline instead, simplified to the
resolution actually on offer, and consecutive strokes of the same colour
are stroked as one path. A page of dense working zoomed out costs about a
fifteenth of the geometry it used to, in one draw call rather than a
thousand. Nothing changes at reading size, and highlighters keep their
outline at every scale — theirs is a single path precisely so that
overlapping itself does not darken.

### How ink is drawn

A stroke is the region swept by a moving disc. Tracing a single outline round
that region is the obvious approach and it breaks in two ways when you zoom
in: the digitiser keeps sampling in screen pixels, so samples crowd together
in world space until the offset points overtake each other (beading), and on
a tight turn the inner side of the outline runs past the centreline, folding
the polygon over itself so a non-zero fill punches holes.

So `freehand.js` instead emits one quad per segment plus a disc at each
corner, all wound the same way, as a single `Path2D`. Non-zero fill unions
them, there is nothing to fold, and because it stays one path a translucent
highlighter composites in one pass instead of darkening everywhere it crosses
itself. The quads are grown a fraction of a nib past their ends so they
overlap rather than merely touch — abutting shapes each get partial
anti-aliased coverage on the shared edge, which shows up as a ribbed seam.
Samples closer together than about an eighth of the nib are dropped first: a
fat nib cannot record detail finer than itself.

Roughly 400 handwriting-sized strokes redraw in ~4 ms, and only on pan/zoom —
the stroke under the pen goes to its own canvas.

### Adding a tool

Write a class with `down(ev) move(ev) up(ev) cancel() paint(r)` in
`js/tools.js`, register it in `App.tools`, add a rail entry in `UI.buildRail`
and a `panelX()` for its options. Nothing else needs to know about it.

Icons live in one `ICON` map at the top of `js/ui.js` — 24×24 stroked SVG
paths, `|` separating subpaths. `python tools/make-icons.py` regenerates the
app icons.

## Tests

```
npm test        the geometry, document and ink layers, plus the PDF cache
npm run bench   the numbers behind the performance work
```

`test/harness.mjs` runs the browser-global modules under node with a small
DOM stub, so the source needs no build step and no module loader to be
testable. Anything touching the canvas is asserted on the numbers behind
the painting, never on pixels.

### When it feels slow

Add `?perf` to the URL, or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>.
The counter splits the frame into scene repaint, live layer, and everything
that is not painting, and shows the worst recent frame beside the average —
an occasional 200ms stall feels worse than a steady 45fps, and an average
hides exactly that. `items drawn / items held` says whether the spatial
index is doing its job; the `lod` line says how many strokes dropped to
their centreline and how few draw calls that took; the `pdf` line says
whether the page cache is keeping up.

## Layout

```
index.html  css/  js/          the app — this alone runs in a browser
sw.js  manifest.webmanifest    the PWA/offline half
start.cmd                      serve it locally
src-tauri/                     the desktop shell (Rust, ~250 lines of config)
tools/pack.py                  web files → dist/, for the bundler
tools/make-icons.py            regenerates every icon from one description
test/                          node tests and the benchmark
```

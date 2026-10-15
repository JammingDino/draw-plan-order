# Workings

*Show your workings.* (Formerly Draw · Plan · Order.)

An endless canvas for pen, keyboard and decision trees. Plain HTML/CSS/JS —
no build step, no dependencies, no account. Everything lives on your machine.

It is built for working through engineering problems with a pen: a
calculator that understands units, phasors, matrices and calculus, typed
worksheets on the board, handwritten sums that answer themselves when you
write `=`, and drawing tools with real arrowheads, dimensions, a drawing
scale and snapping. Every part of it works with only a stylus or a finger
— press and hold anywhere for a menu.

What is planned next, and what is known to be missing, is in
[ROADMAP.md](ROADMAP.md).

## Running it

Double-click **`start.cmd`**. It serves the folder on <http://localhost:5273>
and opens your browser. (Serving over `http://` rather than opening
`index.html` directly is what lets the app use IndexedDB, so boards survive a
restart; opened as a file it falls back to `localStorage`.)

### The desktop app

Download the `_x64-setup.exe` from
[Releases](https://github.com/JammingDino/draw-plan-order/releases/latest)
and run it. It updates itself: on start it checks GitHub for a newer
release and offers to install it (Settings → Updates turns that off, or
checks on demand).

To build it yourself:

```bash
npm install
npm run app:build
```

Produces a Windows installer at
`src-tauri/target/release/bundle/nsis/Draw Plan Order_<version>_x64-setup.exe`,
and the bare `.exe` next to it. It is a Tauri shell — a few megabytes, using
the WebView2 runtime Windows already ships, so pen pressure and coalesced
pointer events behave exactly as they do in Edge. `npm run app:dev` runs it
against the live source.

`tools/pack.py` mirrors the web files into `dist/` first, so the bundle never
picks up `src-tauri/`, `node_modules/` or the tooling. Native file
drag-and-drop is switched off in `tauri.conf.json` so the canvas keeps
handling dropped images itself.

The desktop app saves boards as plain files in a folder you choose under
**Settings → Saving** (<kbd>Ctrl</kbd>+<kbd>,</kbd>), one `.dpo` file per
board. Point it at an Obsidian vault and it uses the Draw · Plan · Order
Obsidian plugin's layout and folder, so the same boards open in either. Until a
folder is chosen, boards live in the app's own WebView2 profile, and they
are copied into the folder the first time one is set. The browser keeps its
own boards; move work across with ↧ Export .board / ↥ Import.

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
| **Smoothing** (pen and highlighter panels) | Steadies a shaky hand. While you draw it pulls hardest when the pen moves slowly, where a tremor shows; when you lift, the stroke is smoothed along its length, keeping its ends and its sharp corners. 50% to start with; *Off* is the old feel. |
| **Low-latency ink** (☰ → Settings → Pen and touch) | The ink is drawn a few milliseconds ahead of the nib, along the path the browser predicts the pen will take, and redrawn for real a frame later; and the layer under the pen skips the page's compositor on its way to the screen. On by default. If the ink flickers or tears on your screen, turn it off (the second half changes the next time the app starts). `?perf` says which is in use. |
| Erase over a PDF, image, sticky or node | Only your ink comes off. Those are hit-tested by their whole area, so an eraser stroke *across* one would otherwise delete the lot — remove them deliberately, with the select tool and <kbd>Delete</kbd>. |
| With the select tool, **drag** across a PDF page or picture | Selects the notes and ink written on it, rather than dragging the page out from under them. **Press and hold** (about a third of a second) to pick up the page itself, or tap it to select it — once selected, it drags straight away. Keep holding, still, and the long-press menu follows. |
| **Finger** on the canvas | Always pans and pinch-zooms, whatever tool is selected — so you can sketch, shove the page along, and sketch some more without putting the pen down. Your palm can rest anywhere, and a mouse or pen still draws normally. Turn it off under ☰ → Settings if you would rather draw with a finger. |
| **Hold the pen or a finger still** where it landed, for half a second, and lift | A menu opens there: paste, paste here, a picture or PDF, select all, undo and redo. On something, that thing is selected — whatever tool you have out — and the menu is what you can do with it. A ring fills while you hold, then locks; move off before it locks and you carry on as normal, with nothing drawn. Keep holding past the lock and the menu opens without waiting for the lift. Holding still at the *end* of a stroke is the shape snap above, never the menu, and a finger soon after the pen was near the glass is taken for your palm. A right click, or the pen's barrel button, opens the same menu. |
| **Hold still, then drag** without lifting | Once the ring locks, dragging draws a selection from where you held — a box or a lasso, shown by the little icon in the ring — whatever tool you have out. Let go and what it enclosed is selected, by the select tool's rules (across a PDF page, the ink on it rather than the page), with the action bar above it. |
| Pen down **inside a selection** made with another tool out | Drags it, as one undo step, or resizes it from a handle — so a selection made by holding, or from the menu, moves with the same pen. Down outside it lets go and draws as normal; a finger outside it pans. |
| Anything **selected** | A bar of big buttons sits just above it — copy, cut, duplicate, delete, front, back, group, edit — and follows it as you pan and zoom. It appears once a pen or finger has touched the screen; the mouse keeps to the style panel. |
| **Double-tap** with the pen or a finger | Edits text, notes, nodes and connector labels, as a double-click does. A connector's label is typed in a field on the line itself. The two dots the pen's taps drew are taken back. |
| With the select tool, **tap with a finger** | Selects what it lands on, and a finger on the selection drags or resizes it. Anywhere else a finger still pans, and a tap on bare board lets go. |

Both of the "clever" behaviours can be switched off in the style panel under
the pen tool. The long-press menu — for fingers, for the pen, and how long
the hold is — whether holding and dragging draws a box or a lasso, and when
the action bar shows are under ☰ → Settings → **Touch and hold**. Hold and
drag follows the select tool by default: whichever of rectangle and lasso
you last picked for it. Features add their own entries to the menu and the bar
through `D.ext.pressActions`; the comment at the top of `js/press.js` says
what they are handed.

## Tools

Pen (pressure-sensitive, tapered), highlighter, eraser (whole-stroke or
pixel), rectangle/ellipse/diamond/triangle, lines and arrows (straight,
bent, polyline, force and moment arrows), text boxes, sticky notes,
flow-chart nodes (process, decision, start/end, data), connectors that
stay attached as you move things, dimensions, a measuring tool, laser
pointer, lasso and marquee select, images by paste or drag-and-drop.

### Engineering drawing

Built for free-body diagrams, circuit sketches, mechanisms and marked-up
drawings, and for a pen alone — nothing needs a key held down.

- **Arrows and lines.** Each end takes its own head — none, open,
  filled, half, tick or dot — sized from the stroke, with S/M/L/XL to
  override. Line styles include **centre** (dash-dot) and **hidden**
  lines. Select a line and drag the diamond in its middle to **bend**
  it; drag either end to move it. The shapes flyout also has a
  **polyline** (lift the pen at each corner, tap the last point again
  or press Enter to finish), a heavy **force** arrow and a circular
  **moment** arrow (press at the centre, lift where the head goes;
  anticlockwise or clockwise in the panel).
- **Snapping.** Ends, corners, midpoints, centres, quadrant points,
  intersections and the edges of things, then 15° steps, then the
  grid — with a marker and a word saying what it caught. An arrow end
  that snaps onto something **stays attached** and follows it when it
  moves; drag the arrow alone and it lets go. The panel switches each
  kind of snap, and has *Square / circle*, *From the centre* and *Only
  15° steps* for what Shift and Alt do on a keyboard.
- **Readouts and exact sizes.** Length and angle (and Δx/Δy, or W × H)
  ride beside the pen while you draw. Select a line for **Length** and
  **Angle** fields, anything else for **W, H, X, Y** — big fields with −
  and + either side (hold to keep going), that also take sums and units:
  `1200/4`, `2.5 m`. Angles run anticlockwise from east and Y counts up
  the page, as on paper.
- **Drawing scale.** Each board has its own units (mm, cm, m, in, ft),
  "1 board unit = …", a 1 : N ratio and the decimals shown — in the
  measure and dimension panels, saved with the board and undone like an
  edit. To scale a PDF or picture, draw a line over a length you know
  (or measure it), and type its real length under **Calibrate**.
- **Dimensions** (the measure flyout). Drag between two points, lift,
  then tap where the dimension line goes — horizontal, vertical or
  aligned by how you dragged. Tap a line to dimension it, or a circle
  for its diameter (or radius); angles go corner, arm, other arm.
  Dimensions on snapped points follow the drawing as it changes;
  dragging one on its own moves its line clear. The text can be
  overridden, with `<>` standing for the value.
- **Measure** (`M`). Distance, angle, path length or area, read out on
  screen and in the panel and gone when you move on — unless you press
  **Pin to board**.

Long-press anywhere for *Measure from here*; on a line, *Dimension this*
and *Set drawing scale…*.

### Circuit and mechanics symbols

The symbol tool (<kbd>S</kbd>) is built to be quicker than drawing the
parts by hand. While it is out, a strip along the bottom holds the parts
— resistor, capacitor, inductor, DC and AC sources, diode, switch,
ground, op-amp, junction; *Mech* swaps in springs, dampers, a mass,
supports and a pulley — and **Wire**.

- **Drag to lay a part.** Drag from one point to another and a
  two-terminal part spans exactly that: its leads stretch, its body
  stays its proper size, and it lies along the drag (square to the page
  when the drag nearly is). Ends snap to terminals first, so parts chain
  end to end — a source dragged upwards, a resistor dragged on from its
  top, a capacitor dragged down. A tap drops a part at its usual size; a
  ground or a support tapped on a terminal hangs from it. Drag a source
  from its + end.
- **Wire** (or <kbd>W</kbd>): drag from a terminal to a terminal for a
  square-cornered wire, attached at both ends, whose corner moves as the
  parts do. Where three or more conductors meet — a wire ending on the
  middle of another, or two wires on one terminal — a junction dot is
  drawn, as a wiring diagram has it.
- Parts are **named as they are placed** — R1, R2, C1, V1, k1 — and a
  double-tap edits the label (`R1 = 4.7 kΩ`), by keys or by pen; it
  stays upright however the part is turned. *Change to* in the panel
  swaps a part for another in place, keeping its span.

### Turning and lining things up

The selection box turns with what it holds: select a turned box (or
several turned alike) and it is framed at its angle, with its handles on
its turned corners, and resizing stretches it along its own sides; turn
a selection and its box goes round with it rather than growing.
Drag the ring on a stalk above any selection to **turn** it about its
middle; it settles on 15° steps as it passes them (always, with Shift),
and the angle rides beside the pen. **Ctrl+R** turns a quarter
clockwise, **Ctrl+Shift+R** back, and the style panel's *Turn* row and
the action bar's turn button do the same with a pen. One selected box
has a **Turn** field beside W, H, X and Y, anticlockwise like every
other angle on the board. Ink, lines and arrows have their points
turned; shapes, text, notes, nodes, pictures and PDF pages keep the
angle and are drawn, picked, erased, snapped to and exported turned.

With two or more things selected, **Align** (in the style panel, or
*Align…* on the action bar and the long-press menu) lines up their left
edges, centres, right edges, tops, middles or bottoms, and with three or
more **spaces them evenly** across or down, keeping the outermost where
they are. A group moves as one piece, and connectors follow what they
join.

### Pages

The page tool (<kbd>F</kbd>) lays a sheet on the board: tap for A4, A3,
A5, Letter or a 16:9 slide, upright or on its side, or drag out a page
of your own size. A page can be plain or ruled with dots, a 5 mm grid,
lines and a margin, or an engineering pad (5 mm squares, every fifth
heavier). Pages sit behind everything and are picked only by their edge
or their name, so you write, box-select and lasso on them as on the
board — a lasso takes the page itself only when it goes all the way
round. *Select with what is on it* (in its panel, its long-press menu,
or a double-tap on its edge) picks up the page with its contents, to
move them together.

The **Pages** button in the zoom bar lists the pages, jumps to one,
and adds the next, laid below the last (beside it, for one on its
side). <kbd>Page Down</kbd> and <kbd>Page Up</kbd> step through them.
The pages of an imported PDF are pages too: they come in at the same
scale (an A4 PDF is exactly an A4 page), are listed by their document
and page number, are stepped through with the rest, and *Add a page*
after one gives a blank page its size. A PDF added from the menu to a
board that has pages goes on after the last of them. Pages are what
**Export PDF** prints, one sheet each, in reading order — so a marked-up
PDF goes back as the same pages, at their own size, with your writing
on them.

### PDFs

Drag a PDF onto the canvas (or ☰ → **Add a PDF**) and its pages are laid out
down the board for you to write on. They go behind whatever is already there,
so annotations always sit on top.

Pages are not flattened into pictures at import. The file is stored once and
each page is rendered on demand at a resolution that suits the current zoom —
so a 40-page PDF costs one copy of the file rather than forty bitmaps, and
zooming in to annotate gives you a sharper page rather than a blurry one. A
`.board` export carries its PDFs and pictures inside it, so the file still
stands alone. Pasted and dropped pictures are kept the same way — stored once,
at full resolution, outside the board itself — so a board full of screenshots
saves as quickly as an empty one.

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

### Calculator and calc blocks

The calculator button in the top bar (<kbd>Ctrl</kbd>+<kbd>K</kbd>) opens a
floating keypad, built for a pen with no keyboard: 44px keys in tabs
(Basic, Functions, Calculus, Matrix, Units, Constants), the answer shown
while you type, a history you can tap to reuse, and the variables you have
set as chips. Variables and `ans` last as long as the board is open. Drag
it by its title, or fold the keypad away and type.

It speaks the maths of a second-year tutorial:

| Type | Get |
| --- | --- |
| `F = 2 kN`, `L = 3 m`, `M = F*L` | `6 kN·m` — a moment, not `6 kJ` |
| `10 kN / (20 mm * 50 mm)` · `3 in to mm` | `10 MPa` · `76.2 mm` |
| `10 V / 4.7 kΩ` | `2.1277 mA` (prefixes chosen for you) |
| `10∠30° + 5∠-45°` | `12.283∠6.8473°`, with `12.196 + 1.4645i` |
| `inv([1,2;3,4])` · `[2,1;1,3] \ [3;5]` · `eigs(A)` | matrices, `A \ b`, eigenvalues |
| `d/dx(x^2 sin(x))` · `diff(x^3, x = 2)` | `2x·sin(x) + x²·cos(x)` · `12` |
| `int(exp(-x^2), x, -inf, inf)` · `lim(sin(x)/x, x = 0)` | `1.7725` · `1` |
| `2x + 3 = 11` · `40 kN/m * x = 2 kN` | `x = 4` · `x = 50 mm` |
| `roots(x^3 - 6x^2 + 11x - 6)` · `taylor(sin(x), x, 0, 7)` | `x = 1, 2, 3` · the series |
| `linreg(xs, ys)` · `mean`, `std` · `g`, `c`, `ε0`, `R`, `kB` … | fits, statistics, constants with units |

**Settings → Calculator** sets degrees or radians, the number format (auto,
engineering `4.7k`, scientific, fixed), significant figures, and exact
answers (`1/3`, `3π/4`, `√3/2`). Calculus always works in radians. `g` is
gravity, so grams are written `gram` or `kg`; Planck's constant is `hP`.

A **calc block** (<kbd>B</kbd>, or *Insert block* from the calculator) is a
worksheet on the board: each line is worked out and its answer set
right-aligned, and variables carry down the lines. Double-click it, or
double-tap it with the pen, to edit; the keypad types into it while it is
open. *Insert block* brings along the lines that define the variables it
uses, so the block works out on its own.

The engine is [math.js](https://mathjs.org) (Apache-2.0), vendored under
`vendor/mathjs` and loaded the first time it is needed, never at start-up.
A block keeps its answers with it, so a board full of them opens and draws
without loading the engine at all; they are worked out again when you edit
the block or change the settings they were made under. `D.math` (in
`js/math.js`) and `D.calc` (in `js/calc.js`) are documented at the top of
each file, for anything else that wants an answer worked out.

### Typeset maths

Write `$…$` in a text box or a sticky note and what is between is set as
maths — `$\sigma = \frac{F}{A}$`, `$x^2 + y^2 = r^2$`,
`$\sqrt{b^2 - 4ac}$` — and `$$…$$` sets it in display style, over several
lines if you like (`\begin{aligned} … \end{aligned}`). Editing shows the
source; the board shows it set, and the SVG export keeps it vector. A
dollar is maths only the way Pandoc reads it, so "$5 and $10" stays money;
`\$` is always a dollar sign.

Select a calc block, a handwritten answer or a graph and the action bar
(or the long-press menu) offers **Copy as LaTeX**, for a report, and
**Typeset beside it**, which sets it on the board next to the original. A
calc block comes out as aligned working — `M &= F\cdot L = 6~\mathrm{kN}\cdot\mathrm{m}` —
with the names it sets written as variables, not the units math.js
would take them for.

The typesetter is MathJax 3 (Apache-2.0, vendored under `vendor/mathjax`
with every TeX extension built in, so nothing is fetched), loaded the
first time a board shows some maths.

### Graphs

The graph tool (<kbd>Y</kbd>), *New graph here* on the long-press menu,
or **Plot** in the calculator puts a graph of y = f(x) on the board.
It plots anything the calculator reads — `sin(x)`, `3x² − 2`,
`e^(−x/2)·cos(3x)`, constants such as `g` and `π` — several functions
at once, each in its own colour with its formula over it, on a grid
with ticks at 1, 2 and 5 steps. Double-tap it for the functions, the
x range, radians or degrees, and a y range that either follows the
curves (ignoring the spikes beside an asymptote, so `tan(x)` is
readable) or is set by hand; the whole edit is one undo step. Its panel
zooms x in and out and fits y again. A graph moves, resizes, turns and
exports to SVG and PDF like anything else.

**Prompted, and by pen.** A curve you ask for offers to graph itself:
write `y = x² − 3` with the pen and a **Graph** chip appears beside it;
type `y = x^2/4 − 3` in the calculator and it offers *Graph y = …*; a
calc-block line like that puts a *Graph* button on the editing bar. A
bare `12x =` is a sum, not a curve: it is answered from an `x = …`
above, never offered as a graph. A pen tapped on a text field — the
calculator's line, a graph's function, a label, a page's name — opens
the app's own write pad rather than Windows' handwriting panel. In the graph editor, the pen button by each function (and
*Write one*) opens a pad to write it on — it is read as you write, into a
field to put right with a tap — the calculator's keypad types into the
function last tapped, and the x range has one-tap presets (±1, ±10,
±100, 0…10, ±2π, 0…2π).

The same pad is on the calculator (*Write*) and on a calc block's editing
bar (*Write*, several lines at once). And **To calc block**, on the
long-press menu or the action bar over selected writing, reads it a line
at a time into a calc block beside it.

### Handwritten maths

Write a sum with the pen, finish it with **=**, and lift the pen for a
moment: the board reads the line and writes the answer beside the `=`,
in a handwriting face and the accent colour. `12 + 30 =` gets `42`;
stacked fractions, exponents written raised and small, roots with a
roof over what they hold, brackets, decimals and implicit
multiplication (`3x²`, `2(3 + 4)`) are understood. A line such as
`x = 2` defines `x` for the lines below it — `3x² + 2 =` gets `14` —
and when you rub out the `2` and write a `3`, the answers that use `x`
change to match.

The answer follows its ink. Rub out part of the sum, or write more of
it, and it is worked out again when you pause; rub out the `=` and it
goes; move the line and it moves too. It is not an edit of its own:
undo the stroke that finished the `=` and the answer disappears with
it, redo it and the answer comes back. Erasing or moving an answer
yourself is an ordinary edit, undone like one.

To check a reading, select the ink (lasso or marquee) and long-press
it, or use the selection's action bar: **Solve this ink** shows what the
strokes were read as, in a field to correct with one tap, with the
answer, and **Insert result**, **Open in calculator** and **Teach**.
Under the field, each symbol is shown with its own ink: tap one that was
misread and pick what it really is, and it is learnt on the spot. Teach
does the same for a correction typed into the field. Double-tap an
answer for the same panel.

**Train** (in that panel, or **Settings → Handwritten maths → Train…**)
opens a pad that walks through every symbol, asking for each three
times, and takes a sample when the pen rests; tap a symbol in its strip
to jump to it. **Try it** reads whatever you write on the pad and says
what it saw — tap the right symbol if it is wrong. Whatever you teach is
a template of your own, kept on this device (at most twelve per symbol).
Teaching is easy to take back: **Undo** in the trainer, on the toast
after a correction, or in Settings takes back the last thing taught (a
correction that fixed several symbols is one step); the trainer shows
the samples of the symbol in hand, each with a cross to forget it, and
*Forget all* for that symbol; and *Forget everything taught…* (two
taps) starts again. What you teach is
and it comes first: ahead of the built-in shapes and even of the rules
that settle the look-alikes, so a 1 you lean like a slash is read as a
1 once you have taught it. It only takes over when it is plainly the
closer match, so teaching a few odd symbols leaves the rest of your
writing read as before. **Settings → Handwritten maths** also turns
solving as you write off, sets the decimal places and the answer colour,
and forgets what you taught.

It keeps out of the way. Nothing is read until the pen rests; a line
that uses a letter nothing defines, or does not work out, is left
alone without a word; and the pen's own behaviours — hold to snap a
shape, scribble to erase — are untouched. A sum of numbers it found
but could not read with confidence gets a faint **?** beside its `=`
instead of an answer: tap it, and Solve this ink opens on its best
guess, so a misreading is one correction away. **Show why it didn't
answer**, in the same Settings section, is for when it misses one: a
small **?** sits above each `=` it found and could not answer, off the
line you are writing on, and fades after a few seconds. Tap it and
*Solve this ink* opens saying why (no operator, a letter nothing
defines, not sure of the reading); hover over it with a mouse for the
same. An `=` that starts a line (the next step of a working) and a line
with letters but nothing to work out (`f_y = ½(…`) are left alone on
purpose, so they get no mark. The marks are not part of the board:
never saved, never undone.

How it reads, in `js/inkmath.js`: each symbol is matched as a cloud of
32 points against templates (the $P recogniser, Vatavu et al. 2012), so
the order, direction and number of strokes do not matter — a 5 in one
stroke or two, a + either way round. The templates are not shipped as
data: about fifty glyph outlines for `0–9 + − × ÷ = ( ) . ^ √` and
`x y z a b c n t θ π` are bent into slanted, squeezed and wobbled
copies the first time something is read. Dots, dashes, `=`, `+`, `x`,
`1` and `/`, which look alike once scaled to a box, are settled by
rules; fraction bars, roofs, exponents and the difference between `x`
and `×` by where things sit on the line. Measured against a second,
independently drawn hand with jitter, slant, uneven pen speed and
shuffled strokes (`test/inkmath.test.mjs`), it reads **99.3%** of
single symbols and **97.9%** of whole lines exactly and confidently;
the weakest case is a slash leaning only a little more than a 1.
Everything runs offline, in under ten milliseconds a line.

A real pen is harder than any synthetic hand, and the thresholds are
set from one: a Surface board of lecture notes (5,500 strokes, kept
out of the repository). There, the second bar of an `=` is usually
bowed or hooked where the pen lifts, so bars are judged as dashes, not
ruled lines, and by their size on the screen rather than on the board;
a stroke reaching from one bar to the other (an F, an E) rules a pair
out. A line whose letters nothing defines is read again as a sum of
numbers — digits, operators, brackets — so a 2 half taken for a z is a
2; a bracket with no partner is the bowed 1 it nearly always is; and
a loose match with a close runner-up is not trusted, which is where
the **?** comes in. Sums put together from that hand's own digits and
`=` signs are answered about half the time and offered with a **?**
most of the rest, against one in twelve before; the notes themselves —
`y² = 4ax`, `c = 9`, `z = x² + y² = 1` — get no answers at all.

## Keyboard

`V` select · `G` lasso · `P` pen · `H` highlighter · `E` eraser · `R` rectangle ·
`O` ellipse · `L` line · `A` arrow · `D` diamond · `T` text · `K` sticky ·
`N` node · `C` connector · `M` measure (hold its button for dimensions) · `F` page · `Y` graph · `S` symbols ·
`Q` laser · `Space` pan · `Enter` finishes a polyline or a measured path

`1`–`8` colour · `[` `]` z-order · `F2` edit text · `Ctrl+D` duplicate ·
`Ctrl+G` group · `Ctrl+R` / `Ctrl+Shift+R` turn 90° · `Ctrl+A` select all · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo ·
`Ctrl+0` reset zoom · `Shift+1` zoom to fit · `Ctrl+'` cycle grid ·
`Ctrl+F` search the board (`Enter` / `Shift+Enter` next and previous, `F3` too) ·
`Ctrl+M` boards · `Alt`+drag duplicates · `Shift` constrains (15° steps
for lines; square or circle for shapes) · `Alt` draws from the centre

## Searching the board

<kbd>Ctrl</kbd>+<kbd>F</kbd>, the magnifier in the zoom bar, or *Search the
board* on the long-press menu opens a bar at the top right. Type, and
everything on the board that says it is found: text boxes, notes, nodes,
connector labels, calc blocks (their working and their answers),
handwritten answers, part labels, page names, graphs' functions and
dimensions — and the words of imported PDFs, each found where it sits on
its page. <kbd>Enter</kbd> or ↓ goes to the next, <kbd>Shift</kbd>+<kbd>Enter</kbd>
or ↑ to the one before; the view moves to each, outlines it, and shades
the others in view. A search starts from where you are looking. A
scanned PDF has no words to find (it is a picture of them), and
handwriting is not searched yet.

## Boards and files

The ☰ menu (<kbd>Ctrl</kbd>+<kbd>M</kbd>) is a dashboard of every board as a
card with a live thumbnail, item count and when you last touched it, newest
first — so it doubles as a recents list. Type to filter by name. Thumbnails
are re-rendered when you leave a board and every few seconds while you work.

It also holds export to **PDF**, `.board` (loss-free JSON), PNG and SVG,
and import of anything exported.

**Export → Document (.pdf)** prints a sheet for each page on the board
(see *Pages*), in their order and at their size, or one sheet round
everything if the board has no pages; a page's own panel has *This page
as PDF*. Sheets are on light paper, whatever the theme, and as much of
them as can be is vector: a page of an imported PDF goes back as the
original page, so its words stay words — sharp, selectable and
searchable, and no bigger than they were — and ink goes in as the
outlines it is drawn with, highlighters see-through and multiplied over
what is under them. Everything else (text boxes, notes, graphs, ruled
paper) is painted at 200 dpi into see-through pictures cropped to what
they hold, in their place between the rest. A two-page handout marked up
with a pen comes out at a few kilobytes. The file is made by pdf-lib
(MIT, vendored under `vendor/pdf-lib`, loaded the first time you
export); a PDF it cannot copy from (encrypted or damaged), or a page
turned on the board, is painted instead. PNG and SVG come out on a transparent background by
default; **Settings → Export** switches to the paper colour, and picks the
theme they are drawn in — matching the app, or always light or always dark —
which sets the colour of default ink and of PDF pages. Autosave runs about
half a second after you stop working (or after you lift the pen); the top bar
says `saved` when it is done.

If the tab is closed or reloaded inside that window, the pending changes are
mirrored to `localStorage` on the way out (synchronous, so it always
completes) and replayed on the next start, with a *Recovered N unsaved items*
toast. Hiding the tab also forces a full save.

### A board changed on two machines

Boards saved as files (the desktop app's **Settings → Saving**) are often
in a synced folder — OneDrive, Dropbox, an Obsidian vault — and the same
board can be changed on two machines between syncs. The desktop app
remembers each board file as it last read or wrote it, and will not save
over one that has changed since. Instead it reads the other copy and
merges the two, item by item, against the board as both started
(`js/merge.js`): what either side added, moved or rubbed out is kept, and
a toast says how much came in. Where the same thing was changed both
ways, yours stays on the board and theirs is kept as a separate board,
*… (changed elsewhere, date)*, so nothing is lost. Coming back to the
window checks too, so a board changed on the laptop is up to date on the
Surface before you write on it. After a merge that changed anything, undo
starts again.

The browser keeps boards in its own storage, which nothing else writes
to, so this is the desktop app's alone.

### The saved format

A board is saved as plain JSON, `{ v, meta, items }`, and `v` says which
version of that shape it is. When a change would make an older copy of
the app misread a board — a field that changes meaning, a unit, an item
type renamed — the version goes up and an upgrade step is added in
`js/format.js`, so every board ever saved still opens: it is brought up to
date as it loads. Adding an optional field or a new kind of item is not
such a change. `test/fixtures/boards/` keeps a board as each version
saved it, with one of every kind of item, and the tests open, draw and
save every one. The comment at the top of `js/format.js` has the steps.

A board saved by a *newer* version still opens, with nothing it does not
understand thrown away. The app says so, and keeps the board as it
arrived as a separate board, *… (as saved by a newer version)*, before
anything is written over it.

## Layout of the code

| File | Role |
| --- | --- |
| `js/util.js` | Geometry, hit-testing maths, semantic `ink`/`paper` colours |
| `js/ext.js` | The extension registry, `D.ext`: how features plug into the core |
| `js/freehand.js` | Pressure → stroke outline (one filled polygon per stroke) |
| `js/recognize.js` | Shape recognition and scribble detection |
| `types/globals.d.ts` | What the type check is told about `window` |
| `js/merge.js` | Two copies of a board, changed on two machines, merged item by item |
| `js/tex.js` | Typeset maths in text boxes and notes; LaTeX out of calc blocks and answers |
| `js/format.js` | The saved format's version, and the steps that upgrade an old board |
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
| `js/desktop.js` | What the desktop shell adds: folders, links, updates |
| `js/math.js`, `js/calc.js` | The maths engine and the calculator (one `css/` file each, as below) |
| `js/cad.js` | Engineering drawing: dimensions, measuring, scale, snapping |
| `js/press.js` | The long-press menu and the selection action bar |
| `js/inkmath.js` | Handwritten maths, recognised and answered |
| `js/frames.js` | Pages: sheets on the board, their rulings and the Pages list |
| `js/exportpdf.js` | Export to PDF, a sheet per page, written by hand |
| `js/graph.js` | Graphs of y = f(x), plotted through the maths engine |
| `js/symbols.js` | Circuit and mechanics symbols, with terminals to wire to |
| `js/search.js` | Search the board, PDFs' words included |

The last four rows are features: each registers with `D.ext` and touches
no core file, so they can be worked on side by side. They load after
`ui.js` and before `app.js`, which builds the app as it loads, and each
has a stylesheet of its own (`css/calc.css`, `css/cad.css`,
`css/press.css`, `css/inkmath.css`).

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

A tool is an object with `down(ev) move(ev) up(ev) cancel() paint(r)`.
The built-in ones are classes in `js/tools.js`; anything new is better
written in a feature file of its own and registered with `D.ext`
(`js/ext.js`), which plugs it into the core without editing any of it:

```js
D.ext.opts.stamp = { color: 'ink', size: 24 };           // saved with the prefs
D.ext.tools.push({
  name: 'stamp',
  create: app => new StampTool(app),                      // lands in app.tools.stamp
  rail: { icon: 'M5 19h14|M12 5v10', key: 'j', title: 'Stamp · J', after: 'note' },
  panel: ui => ui.add(ui.group('Colour', ui.swatches(ui.palette(), ui.app.opts.stamp.color,
    c => ui.app.opts.stamp.color = c)))
});
```

The rail button, the shortcut and the style panel follow from that. A
tool that makes a new kind of thing registers the type too —
`D.ext.items.stamp = { bbox, draw, … }` — and the scene, the spatial
index, hit-testing, moving, resizing, painting, SVG export, the eraser's
rules, double-click/F2 and the style panel all consult it wherever they
would otherwise not know the type. Only `bbox` and `draw` are required;
the rest have defaults that treat it like a sticky note.

The same registry takes top-bar and zoom-bar buttons (`D.ext.buttons`),
long-press actions (`D.ext.pressActions`), Settings sections
(`D.ext.settings`), and listeners for what the app is doing —
`D.ext.on('stroke' | 'change' | 'select' | 'tool' | 'board' | 'key' |
'frame' | 'ready', fn)`. The comment at the top of `js/ext.js` is the
contract: every handler, its arguments and its default, and where each
event is emitted. With nothing registered the core does exactly what it
did before, and the lookups sit only in the branches a built-in type
falls through to.

Icons live in one `ICON` map at the top of `js/ui.js` — 24×24 stroked SVG
paths, `|` separating subpaths. `python tools/make-icons.py` regenerates the
app icons.

## Ideas and bugs

Settings → **Suggest a feature** (also at the foot of the ☰ menu) opens the
[feature request form](https://github.com/JammingDino/draw-plan-order/issues/new?template=feature_request.yml);
**Report a problem** opens the
[bug form](https://github.com/JammingDino/draw-plan-order/issues/new?template=bug_report.yml).

## Releases

Every push to `master` that changes the app is released automatically:
the release workflow builds the installer on Windows, signs the update,
and publishes it with the `latest.json` that installed copies check on
start. Pushes that only touch docs, tests or the issue forms just run the
tests.

The version comes from `package.json`. If it has not been released yet,
that is the version shipped — so for a minor or major release (`0.4.0`,
`1.0.0`), bump it there and push. Otherwise the workflow takes the newest
release, adds one to the patch number (`0.3.0` → `0.3.1`), and commits that
bump back to `master`, so pull before your next change. A build that fails
leaves its version unreleased, and the next push (or **Run workflow** on the
Actions tab) ships it. `tauri.conf.json` reads its version from
`package.json`, so that is the only number to change.

Updates are signed with a key pair made by `npx tauri signer generate`.
The public half is in `tauri.conf.json`; the private half and its password
are the `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. Lose the private
key and installed copies can no longer be updated, only reinstalled.

## Tests

```
npm test           the geometry, document and ink layers, plus the PDF cache
npm run bench      the numbers behind the performance work
npm run bench:ink  how well handwritten maths is read, on real handwriting
```

`bench:ink` runs the handwritten-maths reader over a folder of InkML —
the `test/` folder of Google's [MathWriting](https://github.com/google-research/google-research/tree/master/mathwriting)
set, or CROHME's — and says how many symbols it read right, how many
expressions it read whole, how many work out to the right value, and how
often it answered one it had wrong. The data is not in the repository
(it is large, and MathWriting is CC BY-NC-SA): download it and pass the
folder, `npm run bench:ink -- path/to/mathwriting-2024/test`. Only
expressions the reader could get right are counted — written with the
symbols it knows — and it says what share of the set that is. Run it
before and after a change to `js/inkmath.js`.

```
npm run typecheck   TypeScript reads js/ as it is, with no build step
```

The source stays plain JavaScript. `jsconfig.json` has TypeScript check it
as it stands — class fields, DOM calls, JSDoc types — and CI runs it with
the tests. It checks each file on its own terms: the `D.*` namespace that
joins the files is untyped for now (`types/globals.d.ts`), so a call into
another file is not checked yet. Write `@param {type} name  what it is`
when a comment gives a type; braces straight after the name are read as
a type too, so `@param o {size, …}` breaks the check.

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
src-tauri/                     the desktop shell: window, vault storage, updater
.github/                       issue forms, test and release workflows
tools/pack.py                  web files → dist/, for the bundler
tools/make-icons.py            regenerates every icon from one description
test/                          node tests and the benchmark
```

# Roadmap

What is planned next for Workings, and what is known to be
missing. Newest decisions at the top of each section. Open an issue for
anything you pick up, so two people do not build the same thing.

## Done, waiting for the next release

These are merged into `engineering` and go out together when it is merged
into `master` (every push to `master` ships an update to installed copies).

| Feature | PR |
| --- | --- |
| Teach the reader your handwriting: a training pad, a chip for each symbol in *Solve this ink*, and taught shapes read ahead of the built-in rules | #20 |
| Turn anything (a handle, `Ctrl+R`, a Turn field), and align or distribute a selection | #21 |
| Pages: A4/A3/A5/Letter/16:9 sheets with plain, dot, grid, ruled or engineering-pad paper; a Pages list; `PgUp`/`PgDn` | #22 |
| Export to PDF, a sheet per page | #23 |
| Graphs of y = f(x) through the maths engine | #24 |
| Circuit and mechanics symbols, whose terminals wires attach to | #25 |
| Pen smoothing (50% by default) | #27 |
| Undo for training: last step, one sample, one symbol, everything | #28 |
| The selection box turns with what it holds; resize along its own sides | #29 |
| Imported PDF pages are pages: same scale, listed, exported page for page | #30 |
| Prompts to graph functions of x (pen, calculator, calc blocks); a write pad; keypad into graphs; range presets; To calc block | #31 |
| Symbols rebuilt: drag to lay a part, wire mode, a strip of parts, automatic names | #32 |

## Next

Roughly in order of how much each would help a student working with a pen.

- **Search the board.** Find text in text boxes, notes, nodes, calc blocks,
  answers and the text layer of imported PDFs, and step through the hits.
  The current search only filters the list of boards.
- **Lock.** Pin a PDF page, a picture, a page or a background in place so
  that writing over it never moves or selects it.
- **Crop pictures.** Pasted screenshots of lecture slides nearly always
  need it.
- **Version history.** "This board as it was yesterday": keep snapshots on
  each save (thinned out with age) and let one be opened or restored.
- **Present.** Step through the pages full screen (16:9 slide pages exist
  now), with the laser pointer.
- **Ruler and protractor.** Stencils laid on the board that the pen draws
  along, as in OneNote.
- **Any colour.** A custom colour picker and an eyedropper; the palette is
  fixed at eight.
- **Handwriting to text.** Generalise the handwritten-maths reader to turn
  selected writing into a text box.
- **Typeset maths.** LaTeX in text boxes, and *Copy as LaTeX* for an answer
  or a calc block.
- **Links.** From an item to another board, or to a place on this one.

## Follow-ups to this release

### Pen

- Smoothing that learns: steady more for a hand that shakes more, from
  how much the last few strokes wobbled.

### Handwriting

- Carry what you taught between devices: export and import the samples
  (they live in each browser's or app's own storage).
- See and delete single samples in the trainer, not only *Forget* all.
- Teach the dot, the dash and `=` too. Today these are left to the rules,
  because a whole line's reading depends on them.

### Turning and aligning

- Connectors attach to a turned node's unturned box. They should meet its
  turned outline.
- Flip horizontally and vertically.
- A selection of things turned to different angles is framed square; it
  could keep the angle it was last turned to after being picked up again.

### Pages

- Move what is written on a page when the page itself is dragged, without
  *Select with what is on it* first.
- Reorder pages by dragging them in the Pages list.
- Page numbers and a header or footer on export.
- More page templates: Cornell notes, an engineering drawing title block,
  graph paper with axes.

### PDF export

- Vector output, with ink, shapes and text as paths and text, for smaller
  files that stay sharp at any zoom. Today each sheet is a 200 dpi picture.

### Graphs

- Trace the curve to read off a point; mark roots, turning points and
  intersections.
- Parametric and polar curves, and points from a list (`linreg` data).
- `plot(...)` in a calc block.
- Drag inside a selected graph to pan it, and pinch to zoom it.

### Symbols

- More parts: BJT and MOSFET transistors, LED, potentiometer, transformer,
  ammeter and voltmeter, logic gates; a hinge, a slider, and a beam with a
  distributed load.
- Recognise parts drawn by hand: a zigzag held still becomes a resistor,
  two bars a capacitor, as shapes snap today.
- Drop a part onto a wire to break the wire and put the part in it.
- A junction dot added where three wires meet.
- Parts laid end to end are placed together but not joined: moving one
  leaves the other. Bind a part's ends as wires' are.

## Housekeeping

- The tool rail has nineteen entries now. Gather the page, graph, symbol and
  calc-block tools into one *Insert* flyout, or let the rail scroll on short
  screens.
- `js/app.js` (about 2,000 lines) is the file features most often need to
  touch. Split selection and input handling out of it.
- Rename the app (see below). Keep the updater identifier
  `nz.co.aec.drawplanorder` and keep reading `.dpo` files, or installed
  copies stop updating and old boards stop opening.

## The name

The app is **Workings** from 0.6.0 ("show your workings"), chosen in
October 2026 from the shortlist below, which was checked with web searches
only, not a trademark search. What still says Draw Plan Order, on purpose:

- `productName` in `src-tauri/tauri.conf.json`, so the Windows installer
  updates the app where it is instead of installing a second copy; the
  Start-menu entry keeps the old name until this moves, with an installer
  that removes the old copy.
- The updater identifier `nz.co.aec.drawplanorder`, the `.dpo` files, the
  `draw-plan-order` tag in exported boards, the PWA `id`, the GitHub repo,
  and the Obsidian plugin, so installs keep updating and old boards open.

Also checked: Sketch & Solve, Inkulate and Proofpad (nothing found);
Freebody, Quire, Tute (in use nearby); Margin, Inkwell, Napkin, Slate,
Chalk, Scratchpad (taken).

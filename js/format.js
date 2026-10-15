/* ── format.js ── the saved board's version, and how to bring an old one up ─
   A board is saved as { v, meta?, items, …}. `v` is the version of that
   shape, and it moves only when a change would make an older copy of the
   app misread a board, or a newer one misread an old board: a field that
   changes meaning, a unit that changes, an item type renamed or split.
   Adding an optional field, or a new item type, is not such a change —
   an older app keeps fields and items it does not know (Scene.load keeps
   unknown top-level keys too), and draws nothing for a type it lacks.

   ── Making a change to the format ─────────────────────────────────────

   1. Add a step to UP below, under the version it upgrades *from*:
        UP[1] = doc => { …turn a v1 doc into a v2 doc, in place… }
      A step is handed a doc it may change, and must cope with any v1
      board ever saved: missing keys, items written by older features.
   2. Bump VERSION.
   3. Save a board from the new version as a fixture in
      test/fixtures/boards/, named v<N>-…json, beside the older ones.
      test/format.test.mjs opens every fixture there, upgraded to the
      newest version, and checks each one draws and saves again.

   Never edit an old step once it has shipped: boards out in the world
   were upgraded by it, and the next step expects what it made.

   ── A board from a newer version ──────────────────────────────────────

   It is opened, as well as this copy can, and `newer` says so. Its
   fields and items survive, but anything whose meaning changed may be
   saved back wrong, so the app keeps the board as it arrived before the
   first save writes over it (see App.setBoard).

   D.format.VERSION                 the version this copy saves
   D.format.upgrade(doc) → { doc, from, newer }
       doc    the board brought up to VERSION (the same object, changed)
       from   the version it said it was (a doc with no `v` is a 1)
       newer  true when it came from a later version than this copy's   */
(function (D) {
  'use strict';

  const VERSION = 1;

  /* UP[n] turns a version n doc into a version n + 1 doc, in place. */
  const UP = [];

  function versionOf(doc) {
    const v = doc && doc.v;
    return Number.isInteger(v) && v >= 1 ? v : 1;
  }

  function upgrade(doc) {
    if (!doc || typeof doc !== 'object') doc = { v: VERSION, items: [] };
    if (!Array.isArray(doc.items)) doc.items = [];
    const from = versionOf(doc);
    if (from > VERSION) return { doc, from, newer: true };
    for (let v = from; v < VERSION; v++) {
      const step = UP[v];
      if (!step) throw new Error(`no upgrade from board format ${v} to ${v + 1}`);
      step(doc);
      doc.v = v + 1;
    }
    doc.v = VERSION;
    return { doc, from, newer: false };
  }

  D.format = { VERSION, UP, upgrade, versionOf };

})(window.DPO);

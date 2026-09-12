/* ── store.js ── board persistence ──────────────────────────────────
   IndexedDB when it is available (it is not, on file:// in Chrome),
   localStorage otherwise, memory as a last resort — and, when a host
   application is embedding the board, the host itself. Same tiny KV API
   behind all four, so nothing above this file knows the difference. */
(function (D) {
  'use strict';
  const U = D.util;

  const KEY = 'dpo';
  let backend = null;

  /* ── backends ───────────────────────────────────────────────────── */
  const memory = (() => {
    const m = new Map();
    return {
      name: 'memory',
      get: async k => m.get(k) ?? null,
      set: async (k, v) => { m.set(k, v); },
      del: async k => { m.delete(k); },
      keys: async () => [...m.keys()]
    };
  })();

  const local = {
    name: 'localStorage',
    get: async k => { const v = localStorage.getItem(KEY + ':' + k); return v ? JSON.parse(v) : null; },
    set: async (k, v) => localStorage.setItem(KEY + ':' + k, JSON.stringify(v)),
    del: async k => localStorage.removeItem(KEY + ':' + k),
    keys: async () => Object.keys(localStorage).filter(k => k.startsWith(KEY + ':')).map(k => k.slice(KEY.length + 1))
  };

  function idb() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(KEY, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onerror = () => rej(rq.error);
      rq.onsuccess = () => {
        const db = rq.result;
        const run = (mode, fn) => new Promise((ok, no) => {
          const t = db.transaction('kv', mode), s = t.objectStore('kv');
          const r = fn(s);
          t.oncomplete = () => ok(r && r.result);
          t.onerror = () => no(t.error);
        });
        res({
          name: 'indexedDB',
          get: k => run('readonly', s => s.get(k)),
          set: (k, v) => run('readwrite', s => s.put(v, k)),
          del: k => run('readwrite', s => s.delete(k)),
          keys: () => run('readonly', s => s.getAllKeys())
        });
      };
    });
  }

  /* ── host backend ─────────────────────────────────────────────────
     When a host application embeds the board in an iframe (the Obsidian
     plugin does), persistence belongs to the host: boards are vault
     files that sync with everything else, not rows in this browser
     profile's IndexedDB. The host answers the same five-method contract
     over postMessage, so every layer above here is unchanged.

     Uint8Array survives the structured clone intact, which is what lets
     a dropped PDF stay binary the whole way to disk. */
  function hostBackend() {
    const pending = new Map();
    let seq = 0;

    addEventListener('message', e => {
      const m = e.data;
      if (!m || m.channel !== 'dpo-store' || m.reply === undefined) return;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.reply);
    });

    const call = (op, key, value) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      parent.postMessage({ channel: 'dpo-store', id, op, key, value }, '*');
      /* A host that never answers must not leave the board wedged
         mid-load with no way to tell the user why. */
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`host did not answer ${op} ${key ?? ''}`));
      }, 15000);
    });

    return {
      name: 'host',
      get: k => call('get', k),
      set: (k, v) => call('set', k, v),
      del: k => call('del', k),
      keys: () => call('keys')
    };
  }

  const S = D.store = {};

  S.init = async () => {
    // ?scratch — a throwaway board that never touches your saved work.
    // Handy for trying something out, and for automated checks.
    if (/[?&]scratch\b/.test(location.search)) { backend = memory; S.backend = 'scratch'; return S.backend; }
    /* ?host — a host application owns persistence. Checked before the
       browser backends because inside the Obsidian plugin IndexedDB is
       available but wrong: boards belong in the vault. */
    if (/[?&]host=/.test(location.search) && parent !== self) {
      backend = hostBackend();
      S.backend = backend.name;
      return S.backend;
    }
    try {
      if (self.indexedDB && location.protocol !== 'file:') {
        backend = await Promise.race([idb(), new Promise((_, r) => setTimeout(r, 1200))]);
      }
    } catch (e) { /* fall through */ }
    if (!backend) {
      try { localStorage.setItem(KEY + ':probe', '1'); localStorage.removeItem(KEY + ':probe'); backend = local; }
      catch (e) { backend = memory; }
    }
    S.backend = backend.name;
    return backend.name;
  };

  /* ── board index ────────────────────────────────────────────────── */
  const INDEX = 'index';

  S.list = async () => (await backend.get(INDEX)) || [];

  S.touchIndex = async (board) => {
    const list = await S.list();
    const i = list.findIndex(b => b.id === board.id);
    const entry = {
      id: board.id, name: board.name, updated: Date.now(),
      count: board.doc.items.length, thumb: board.thumb, thumbTheme: board.thumbTheme
    };
    if (i < 0) list.unshift(entry); else list[i] = entry;
    list.sort((a, b) => b.updated - a.updated);
    await backend.set(INDEX, list);
    return list;
  };

  S.load = async id => backend.get('b:' + id);

  S.save = async board => {
    board.updated = Date.now();
    await backend.set('b:' + board.id, board);
    await S.touchIndex(board);
  };

  S.remove = async id => {
    await backend.del('b:' + id);
    const list = (await S.list()).filter(b => b.id !== id);
    await backend.set(INDEX, list);
    return list;
  };

  /* ── binary assets (dropped PDFs) ───────────────────────────────── */
  /* Kept out of the board record: a board is re-serialised on every
     autosave, and dragging a few megabytes of PDF through that on each
     keystroke would be daft. Assets are written once, by id. */

  S.putAsset = async (id, bytes, meta = {}) => {
    const store = backend.name === 'localStorage' ? { ...meta, b64: toB64(bytes) } : { ...meta, bytes };
    await backend.set('a:' + id, store);
  };

  S.getAsset = async id => {
    const rec = await backend.get('a:' + id);
    if (!rec) return null;
    return rec.bytes ? new Uint8Array(rec.bytes) : fromB64(rec.b64);
  };

  S.assetMeta = async id => {
    const rec = await backend.get('a:' + id);
    return rec ? { name: rec.name, type: rec.type } : null;
  };

  S.removeAsset = async id => backend.del('a:' + id);

  /** drop assets no board refers to any more */
  S.sweepAssets = async () => {
    const keys = (await backend.keys()).filter(k => String(k).startsWith('a:'));
    if (!keys.length) return 0;
    const used = new Set();
    for (const b of await S.list()) {
      const full = await S.load(b.id);
      for (const it of (full?.doc?.items || [])) if (it.asset) used.add('a:' + it.asset);
    }
    let n = 0;
    for (const k of keys) if (!used.has(k)) { await backend.del(k); n++; }
    return n;
  };

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  S.toB64 = toB64; S.fromB64 = fromB64;

  S.lastId = async () => backend.get('last');
  S.setLast = async id => backend.set('last', id);

  S.prefs = async () => (await backend.get('prefs')) || {};
  S.setPrefs = async p => backend.set('prefs', p);

  S.newBoard = (name = 'Untitled board') => ({
    id: U.uid(), name, created: Date.now(), updated: Date.now(),
    camera: { x: 0, y: 0, zoom: 1 }, doc: { v: 1, items: [] }
  });

})(window.DPO);

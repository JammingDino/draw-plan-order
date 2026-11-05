/* ── audio.js ── record what is said, and hear it again from the ink ────
   As OneNote and Samsung Notes do: the microphone in the top bar records,
   and every stroke written while it records remembers when it was
   written. The recording lands on the board as a clip; play it, and the
   ink written at each moment is picked out as the sound reaches it. A
   stroke's long-press menu has "Play from here", which starts the
   recording a couple of seconds before that stroke was written — the
   lecturer's explanation of the line you were writing.

   The clip is an item, type 'audio' — { asset, mime, dur (ms), label } —
   and the sound is one of the board's assets, so it is saved, synced,
   copied and exported in a .board like a picture. A stroke written while
   recording keeps `rec: { id, t }`: the clip's id and the milliseconds
   into the recording. Nothing else knows about either.

   D.audio.start(app) / stop(app) / recording()
   D.audio.play(app, clip, fromMs) / pause()                              */
(function (D) {
  'use strict';
  const U = D.util;
  const el = (tag, attrs, ...kids) => U.el(tag, attrs, ...kids);

  const MIC = 'M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3z|M6 11a6 6 0 0 0 12 0|M12 17v3.5|M8.5 20.5h7';
  const PLAY = 'M8 5.5v13l10.5-6.5z';
  const LEAD_MS = 2000;            // "Play from here" starts this much before the stroke
  const CLIP_W = 230, CLIP_H = 46;

  let rec = null;                  // { id, recorder, chunks, t0, at, stream, timer }
  let player = null;               // { audio, clip, url, bar, raf }

  const fmt = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  /* ── the clip ─────────────────────────────────────────────────────── */
  D.ext.items.audio = {
    label: 'Recording',
    bbox: it => ({ x: it.x, y: it.y, w: it.w || CLIP_W, h: it.h || CLIP_H }),
    draw(ctx, it, r) {
      const dark = r.tokens().dark, w = it.w || CLIP_W, h = it.h || CLIP_H;
      const playing = player && player.clip && player.clip.id === it.id;
      ctx.fillStyle = dark ? '#262b38' : '#eef1ff';
      ctx.strokeStyle = playing ? '#4f6bff' : (dark ? '#3b4256' : '#c9d2ff');
      ctx.lineWidth = playing ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(it.x, it.y, w, h, h / 2); ctx.fill(); ctx.stroke();
      // the play button
      const cx = it.x + h / 2, cy = it.y + h / 2, R = h / 2 - 6;
      ctx.fillStyle = '#4f6bff';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      if (playing && !player.audio.paused) { ctx.rect(cx - R * 0.38, cy - R * 0.42, R * 0.26, R * 0.84); ctx.rect(cx + R * 0.12, cy - R * 0.42, R * 0.26, R * 0.84); }
      else { ctx.moveTo(cx - R * 0.3, cy - R * 0.45); ctx.lineTo(cx + R * 0.5, cy); ctx.lineTo(cx - R * 0.3, cy + R * 0.45); ctx.closePath(); }
      ctx.fill();
      ctx.fillStyle = dark ? '#e8ebf2' : '#1d2230';
      ctx.font = '600 14px "Segoe UI",system-ui,sans-serif';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(it.label || 'Recording', it.x + h + 4, cy - 8);
      ctx.font = '12px "Segoe UI",system-ui,sans-serif';
      ctx.fillStyle = dark ? '#98a0b0' : '#6b7180';
      const t = playing ? fmt(player.audio.currentTime * 1000) + ' / ' + fmt(it.dur) : fmt(it.dur);
      ctx.fillText(t, it.x + h + 4, cy + 9);
      // how far through, along the bottom
      if (playing && it.dur) {
        const f = U.clamp(player.audio.currentTime * 1000 / it.dur, 0, 1);
        ctx.fillStyle = '#4f6bff';
        ctx.fillRect(it.x + h, it.y + h - 5, (w - h - h / 3) * f, 2.5);
      }
    },
    svg(it) {
      const w = it.w || CLIP_W, h = it.h || CLIP_H;
      return `<g><rect x="${it.x}" y="${it.y}" width="${w}" height="${h}" rx="${h / 2}" fill="#eef1ff" stroke="#c9d2ff"/>` +
        `<circle cx="${it.x + h / 2}" cy="${it.y + h / 2}" r="${h / 2 - 6}" fill="#4f6bff"/>` +
        `<text x="${it.x + h + 4}" y="${it.y + h / 2 + 5}" font-family="Segoe UI, sans-serif" font-size="14" font-weight="600" fill="#1d2230">${U.escapeXml((it.label || 'Recording') + ' · ' + fmt(it.dur))}</text></g>`;
    },
    edit(app, it) { toggle(app, it); },
    searchText: it => it.label || 'Recording',
    panel(ui, items) {
      const app = ui.app, it = items[0];
      ui.add(ui.group(items.length > 1 ? items.length + ' recordings' : (it.label || 'Recording') + ' · ' + fmt(it.dur),
        items.length === 1 ? el('div', { class: 'actions' },
          el('button', { class: 'btn primary', type: 'button', onclick: () => toggle(app, it) }, player && player.clip === it && !player.audio.paused ? 'Pause' : 'Play'),
          el('button', { class: 'btn', type: 'button', onclick: () => rename(app, it) }, 'Rename')) : null));
    }
  };

  function rename(app, it) {
    const name = typeof prompt === 'function' ? prompt('Name this recording', it.label || 'Recording') : null;
    if (name == null) return;
    app.scene.begin('rename'); app.scene.touch(it); it.label = name.trim() || 'Recording'; app.scene.commit(); app.afterEdit();
  }

  /* ── recording ────────────────────────────────────────────────────── */
  async function start(app) {
    if (rec) return;
    const md = typeof navigator !== 'undefined' && navigator.mediaDevices;
    if (!md || !md.getUserMedia || typeof MediaRecorder !== 'function') { app.toast('This browser cannot record sound'); return; }
    let stream;
    try { stream = await md.getUserMedia({ audio: true }); }
    catch (err) { app.toast('No microphone: ' + (err && err.name === 'NotAllowedError' ? 'permission was refused' : (err && err.message) || err)); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    // where the clip will go: the top left of what is on screen as it starts
    const at = app.camera.toWorld(96, 84);
    const chunks = [];
    rec = { id: U.uid(), recorder, chunks, t0: performance.now(), at, stream, board: app.board, timer: 0 };
    // the last piece arrives after stop() is asked for, so it goes to this recording's own list
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start(1000);
    rec.timer = setInterval(() => mark(app), 1000);
    mark(app);
    app.toast('Recording — the ink you write is kept in step with it. Tap the microphone again to stop.');
  }

  async function stop(app) {
    if (!rec) return;
    const r = rec;
    rec = null;
    clearInterval(r.timer);
    const done = new Promise(res => { r.recorder.onstop = res; });
    try { r.recorder.stop(); } catch (_) { }
    await done;
    for (const t of r.stream.getTracks()) t.stop();
    mark(app);
    const dur = performance.now() - r.t0;
    const mime = (r.recorder.mimeType || 'audio/webm').split(';')[0];
    const blob = new Blob(r.chunks, { type: mime });
    if (!blob.size) { app.toast('Nothing was recorded'); return; }
    // on the board open now; on another than it started on, at the top left of the view
    if (app.board !== r.board) r.at = app.camera.toWorld(96, 84);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const asset = U.uid();
    await app.putAsset(asset, bytes, { name: 'recording', type: mime });
    const n = app.scene.items.filter(i => i.type === 'audio').length + 1;
    const clip = { id: r.id, type: 'audio', x: r.at.x, y: r.at.y, w: CLIP_W, h: CLIP_H, asset, mime, dur: Math.round(dur), label: 'Recording ' + n, alpha: 1 };
    app.scene.begin('recording'); app.scene.add(clip); app.scene.commit();
    app.afterEdit();
    app.toast(`Recorded ${fmt(dur)} — long-press any of the ink for "Play from here"`);
  }

  /* each pen stroke written while recording keeps when it was written */
  D.ext.on('stroke', (app, item) => {
    if (!rec || !item) return;
    // when the pen went down, not when it lifted: the stroke started as the words were said
    const t = Math.max(0, (item._t0 || performance.now()) - rec.t0);
    item.rec = { id: rec.id, t: Math.round(t) };
    item._json = null;
    app.markDirty();
  });

  /* ── playing ──────────────────────────────────────────────────────── */
  async function play(app, clip, fromMs = 0) {
    if (!clip || !clip.asset) return;
    if (!player || player.clip !== clip) {
      pause(); closePlayer(app);
      const bytes = await app.getAsset(clip.asset);
      if (!bytes) { app.toast('The recording is missing from this board'); return; }
      const url = URL.createObjectURL(new Blob([bytes], { type: clip.mime || 'audio/webm' }));
      const audio = new Audio(url);
      // the ink written while it was recorded, in the order it was written
      const ink = app.scene.items.filter(i => i.type === 'stroke' && i.rec && i.rec.id === clip.id);
      player = { audio, clip, url, raf: 0, ink };
      audio.onended = () => { tick(app); app.requestDraw(); };
    }
    const a = player.audio;
    try { a.currentTime = Math.max(0, fromMs / 1000); } catch (_) { }
    try { await a.play(); } catch (err) { app.toast('Could not play it: ' + ((err && err.message) || err)); return; }
    const loop = () => { if (!player) return; tick(app); if (!a.paused) player.raf = requestAnimationFrame(loop); };
    loop();
  }
  function pause() { if (player && !player.audio.paused) player.audio.pause(); }
  function closePlayer(app) {
    if (!player) return;
    cancelAnimationFrame(player.raf);
    player.audio.pause();
    URL.revokeObjectURL(player.url);
    player = null;
    if (app) { app.renderer.invalidate(); app.requestDraw(); app.requestDrawLive(); }
  }
  function toggle(app, clip) {
    if (player && player.clip === clip && !player.audio.paused) { pause(); tick(app); app.requestDraw(); return; }
    play(app, clip, player && player.clip === clip && !player.audio.ended ? player.audio.currentTime * 1000 : 0);
  }
  /** repaint the clip (its clock) and the ink being said now */
  function tick(app) {
    app.renderer.invalidate(); app.requestDraw(); app.requestDrawLive();
  }

  /* While a recording plays, the ink written in the last few seconds before
     the moment playing is picked out, so the writing follows the voice. */
  D.ext.on('frame', (app, ctx) => {
    if (!player || player.audio.paused) return;
    const now = player.audio.currentTime * 1000, c = app.camera;
    ctx.save();
    for (const it of player.ink) {
      if (it.rec.t > now || it.rec.t < now - 4000 || app.scene.get(it.id) !== it) continue;
      const b = app.scene.bbox(it), a = c.toScreen(b.x, b.y), e = c.toScreen(b.x2, b.y2);
      const fresh = 1 - (now - it.rec.t) / 4000;
      ctx.fillStyle = `rgba(79,107,255,${(0.22 * fresh).toFixed(3)})`;
      ctx.beginPath(); ctx.roundRect(a.x - 4, a.y - 4, e.x - a.x + 8, e.y - a.y + 8, 6); ctx.fill();
    }
    ctx.restore();
  });

  /* ── where to reach it ────────────────────────────────────────────── */
  function mark(app) {
    const b = typeof document !== 'undefined' && document.getElementById('btn-record');
    if (!b) return;
    b.classList.toggle('recording', !!rec);
    b.title = rec ? 'Stop recording · ' + fmt(performance.now() - rec.t0) : 'Record sound — the ink you write is kept in step with it';
  }
  D.ext.buttons.push({ id: 'btn-record', icon: MIC, title: 'Record sound — the ink you write is kept in step with it', where: 'top',
    onClick: app => (rec ? stop(app) : start(app)) });

  const recOf = ctx => {
    const it = ctx.hit && ctx.hit.rec ? ctx.hit : ctx.selection.length === 1 && ctx.selection[0].rec ? ctx.selection[0] : null;
    return it && ctx.app.scene.get(it.rec.id) ? it : null;
  };
  D.ext.pressActions.push({
    id: 'audio-from-here', label: 'Play from here', icon: PLAY, order: 10,
    when: ctx => !!recOf(ctx),
    run: ctx => { const it = recOf(ctx); play(ctx.app, ctx.app.scene.get(it.rec.id), it.rec.t - LEAD_MS); }
  });

  // a recording goes on across boards, and lands on the one open when it stops
  D.ext.on('board', app => closePlayer(app));

  D.audio = { start, stop, play, pause, recording: () => !!rec, playing: () => player && !player.audio.paused ? player.clip : null };
})(window.DPO);

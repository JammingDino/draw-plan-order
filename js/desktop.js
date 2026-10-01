/* ── desktop.js ── what the desktop shell adds: folders, links, updates ─
   The Tauri build answers these through src-tauri/src/main.rs. In the
   browser there is no shell to ask, so `on` is false and the settings
   page leaves those rows out; the links work in both.                  */
(function (D) {
  'use strict';
  const REPO = 'https://github.com/JammingDino/draw-plan-order';
  const invoke = self.__TAURI_INTERNALS__ && self.__TAURI_INTERNALS__.invoke;
  const AUTO = 'dpo:auto-update';

  D.desktop = {
    on: !!invoke,

    links: {
      feature: REPO + '/issues/new?template=feature_request.yml',
      bug: REPO + '/issues/new?template=bug_report.yml',
      releases: REPO + '/releases'
    },

    /** vault, folder, dir (where boards land), obsidian, version */
    config: () => invoke('dpo_config'),
    /** null if the picker was cancelled, else the new config */
    chooseFolder: () => invoke('dpo_choose_folder'),
    revealFolder: () => invoke('dpo_reveal_folder'),

    /** null when this is the newest version, else { version, notes } */
    checkUpdate: () => invoke('dpo_check_update'),
    /** downloads, installs and restarts: save before calling */
    installUpdate: () => invoke('dpo_install_update'),

    /* Whether to look for an update on start. Per machine rather than in
       the board prefs, which live in the vault and so travel with it. */
    get autoUpdate() {
      try { return localStorage.getItem(AUTO) !== 'off'; } catch (_) { return true; }
    },
    set autoUpdate(v) {
      try { localStorage.setItem(AUTO, v ? 'on' : 'off'); } catch (_) { }
    },

    /** one of this project's pages, in the real browser rather than in here */
    open(url) {
      if (invoke) return invoke('dpo_open_url', { url }).catch(err => console.error('[dpo] open', err));
      window.open(url, '_blank', 'noopener');
    }
  };
})(window.DPO);

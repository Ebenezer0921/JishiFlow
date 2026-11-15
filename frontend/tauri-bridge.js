(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const unlisteners = new Set();
  let unloading = false;
  function subscribe(name, callback) {
    return listen(name, event => callback(event.payload)).then(unlisten => {
      if (unloading) unlisten(); else unlisteners.add(unlisten);
      return () => { if (unlisteners.delete(unlisten)) unlisten(); };
    });
  }
  window.addEventListener('beforeunload', () => { unloading = true; unlisteners.forEach(unlisten => unlisten()); unlisteners.clear(); });
  window.jishi = {
    loadState: () => invoke("state_load"),
    saveState: (state) => invoke("state_save", { state }),
    onStateChanged: (callback) => subscribe("state-changed", callback),
    getPopupReminder: () => invoke("popup_get"),
    onPopupChanged: (callback) => subscribe("popup-changed", callback),
    closePopup: () => invoke("popup_close"),
    collapseAllPopups: () => invoke("popup_collapse_all"),
    completeReminder: (id) => invoke("popup_complete", { id }),
    disableReminder: (id) => invoke("popup_disable", { id }),
    snoozeReminder: (id, dueAt) => invoke("popup_snooze", { id, dueAt }),
    updateFromPopup: (id, title, note, priority) => invoke("popup_update", { id, title, note, priority: priority ?? null }),
    showMainWindow: () => invoke("window_show"),
    testReminder: () => invoke("popup_test"),
    previewReminder: () => invoke("popup_preview"),
    resizePopup: (height) => invoke("popup_resize", { height }),
    startPopupDrag: () => invoke("popup_start_drag"),
    raisePopup: () => invoke("popup_raise"),
  };
})();

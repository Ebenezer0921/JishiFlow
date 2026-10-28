(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  window.jishi = {
    loadState: () => invoke("state_load"),
    saveState: (state) => invoke("state_save", { state }),
    onStateChanged: (callback) => { listen("state-changed", (event) => callback(event.payload)); },
    getPopupReminder: () => invoke("popup_get"),
    onPopupChanged: (callback) => { listen("popup-changed", (event) => callback(event.payload)); },
    closePopup: () => invoke("popup_close"),
    completeReminder: (id) => invoke("popup_complete", { id }),
    disableReminder: (id) => invoke("popup_disable", { id }),
    snoozeReminder: (id, dueAt) => invoke("popup_snooze", { id, dueAt }),
    updateFromPopup: (id, title, note, priority) => invoke("popup_update", { id, title, note, priority: priority ?? null }),
    showMainWindow: () => invoke("window_show"),
    testReminder: () => invoke("popup_test"),
    previewReminder: () => invoke("popup_preview"),
    resizePopup: (height) => invoke("popup_resize", { height }),
    startPopupDrag: () => invoke("popup_start_drag"),
  };
})();

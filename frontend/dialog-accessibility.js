/* Modal keyboard/focus behavior only; persistence and parsing remain in renderer.js. */
(() => {
  const overlays = [...document.querySelectorAll('.dialog-overlay')];
  const shell = document.querySelector('.app-shell');
  const openers = new WeakMap();
  const open = (overlay) => !overlay.classList.contains('hidden');
  const focusables = (overlay) => [...overlay.querySelectorAll('button, input, textarea, select, a[href], [tabindex]')]
    .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0);
  const syncBackground = () => {
    const hasDialog = overlays.some(open);
    shell.inert = hasDialog;
    document.body.classList.toggle('has-open-dialog', hasDialog);
  };
  document.querySelectorAll('#positionGrid button').forEach((button) => {
    const syncPosition = () => button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    syncPosition();
    new MutationObserver(syncPosition).observe(button, { attributes: true, attributeFilter: ['class'] });
  });
  overlays.forEach((overlay) => {
    let wasOpen = open(overlay);
    new MutationObserver(() => {
      const isOpen = open(overlay);
      if (isOpen === wasOpen) return;
      wasOpen = isOpen;
      if (isOpen) {
        openers.set(overlay, document.activeElement);
        syncBackground();
        const firstInput = overlay.querySelector('input:not([type="file"]), textarea, select');
        (firstInput || focusables(overlay)[0])?.focus();
      } else {
        syncBackground();
        const opener = openers.get(overlay);
        if (!overlays.some(open) && opener?.isConnected) opener.focus({ preventScroll: true });
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  });
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.defaultPrevented) return;
    const overlay = overlays.find(open);
    if (!overlay) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      overlay.querySelector('[data-close]')?.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = focusables(overlay);
    const first = elements[0], last = elements[elements.length - 1];
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  syncBackground();
})();

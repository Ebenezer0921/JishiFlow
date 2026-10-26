let reminder = null;
let settings = { defaultSnooze: 10 };
const $ = (selector) => document.querySelector(selector);
function toLocalInput(date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function applyTextSize(value) { document.body.dataset.textSize = String(Math.max(1, Math.min(5, Number(value) || 3))); }
function applyAppearance(value) {
  applyTextSize(value.textSize);
  const fonts = { pingfang: '"PingFang SC","苹方-简","Microsoft YaHei",sans-serif', system: 'var(--md-font)', yahei: '"Microsoft YaHei","Microsoft YaHei UI",sans-serif', simsun: 'SimSun,"宋体",serif' };
  document.documentElement.style.setProperty("--popup-font", fonts[value.popupFont] || fonts.system);
  document.documentElement.style.setProperty("--popup-alpha", String(1 - Math.max(0, Math.min(40, Number(value.popupTransparency) || 0)) / 100));
  document.documentElement.style.setProperty("--popup-secondary", Number(value.popupTransparency) > 0 ? 'var(--md-on-surface)' : 'var(--md-on-surface-variant)');
}
function startPreviewCountdown(seconds) {
  ['completeButton', 'laterButton', 'editButton'].forEach((id) => { $(`#${id}`).disabled = true; });
  $('.repeat-note').textContent = '外观预览，不会创建或修改提醒';
  $('#closeButton').setAttribute('aria-label', '关闭外观预览');
  $('#closeButton').title = '关闭外观预览';
  const duration = Math.max(1, Math.min(30, Number(seconds) || 5));
  const bar = $("#previewCountdown"), fill = bar.querySelector("span"), label = $("#previewCountdownText");
  bar.classList.remove("hidden"); fill.style.animationDuration = `${duration}s`;
  const started = Date.now();
  const update = () => { const left = Math.max(0, Math.ceil(duration - (Date.now() - started) / 1000)); label.textContent = `${left} 秒后关闭`; };
  update(); const ticker = setInterval(update, 200);
  setTimeout(() => { clearInterval(ticker); window.jishi.closePopup(); }, duration * 1000);
}
let fitFrame = null;
let lastRequestedHeight = null;
function fitPopup() {
  if (fitFrame !== null) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = null;
    const card = document.querySelector('.popup');
    const style = getComputedStyle(card);
    const number = (value) => parseFloat(value) || 0;
    const children = [...card.children].filter((child) => !child.classList.contains('hidden'));
    const naturalHeight = number(style.paddingTop) + number(style.paddingBottom) + number(style.borderTopWidth) + number(style.borderBottomWidth)
      + Math.max(0, children.length - 1) * number(style.rowGap)
      + children.reduce((sum, child) => {
        const childStyle = getComputedStyle(child);
        return sum + Math.max(child.scrollHeight, child.getBoundingClientRect().height) + number(childStyle.marginTop) + number(childStyle.marginBottom);
      }, 0);
    // Rust keeps width=396*scale and height=clamp(request,220,430)*scale in physical pixels.
    // The measured viewport width accounts for the actual DPI and native WebView zoom.
    const requested = Math.max(220, Math.min(430, Math.ceil(naturalHeight * 396 / Math.max(1, window.innerWidth))));
    if (requested === lastRequestedHeight) return;
    lastRequestedHeight = requested;
    window.jishi.resizePopup(requested).catch(() => { lastRequestedHeight = null; });
  });
}
function show(panel) { ["viewPanel", "snoozePanel", "editPanel"].forEach((id) => $(`#${id}`).classList.toggle("hidden", id !== panel)); $(`#${panel}`).scrollTop = 0; if (panel === "editPanel") $("#editTitle").focus(); fitPopup(); }
function render(item) { reminder = item; if (!item) return; $("#title").textContent = item.title; $("#note").textContent = item.note || "提醒时间到了"; }
$("#dragHandle").addEventListener("mousedown", (event) => { if (event.button === 0 && !event.target.closest("button")) window.jishi.startPopupDrag(); });
$("#closeButton").addEventListener("click", () => window.jishi.closePopup());
$("#completeButton").addEventListener("click", () => window.jishi.completeReminder(reminder.id));
$("#laterButton").addEventListener("click", () => { $("#defaultButton").textContent = `默认 · ${settings.defaultSnooze} 分钟后`; $("#customTime").value = toLocalInput(new Date(Date.now() + settings.defaultSnooze * 60000)); $("#customTime").min = toLocalInput(new Date()); show("snoozePanel"); });
$("#defaultButton").addEventListener("click", () => window.jishi.snoozeReminder(reminder.id, new Date(Date.now() + settings.defaultSnooze * 60000).toISOString()));
$("#customButton").addEventListener("click", () => { if ($("#customTime").value) window.jishi.snoozeReminder(reminder.id, new Date($("#customTime").value).toISOString()); });
$("#disableButton").addEventListener("click", () => window.jishi.disableReminder(reminder.id));
$("#snoozeBack").addEventListener("click", () => show("viewPanel"));
$("#editButton").addEventListener("click", () => { $("#editTitle").value = reminder.title; $("#editNote").value = reminder.note || ""; show("editPanel"); });
$("#editBack").addEventListener("click", () => show("viewPanel"));
$("#saveEdit").addEventListener("click", async () => { const title = $("#editTitle").value.trim(); if (!title) return; const note = $("#editNote").value.trim(); await window.jishi.updateFromPopup(reminder.id, title, note); reminder = { ...reminder, title, note }; render(reminder); show("viewPanel"); });
window.jishi.onPopupChanged((item) => { render(item); show("viewPanel"); });
Promise.all([window.jishi.getPopupReminder(), window.jishi.loadState()]).then(([item, state]) => { settings = state.settings; applyAppearance(settings); render(item); if (item?.id?.startsWith("__preview__")) startPreviewCountdown(settings.previewSeconds); fitPopup(); });
new ResizeObserver(fitPopup).observe(document.querySelector(".popup"));
window.addEventListener('resize', fitPopup);

let reminder = null;
let settings = { defaultSnooze: 10 };
const $ = (selector) => document.querySelector(selector);
function toLocalInput(date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function applyTextSize(value) { document.body.dataset.textSize = String(Math.max(1, Math.min(5, Number(value) || 3))); }
function applyAppearance(value) {
  document.body.dataset.priorityPalette = value.priorityPalette || "";
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
        const content = child.querySelector?.('.reminder-content');
        const hiddenContent = content ? Math.max(0, content.scrollHeight - content.clientHeight) : 0;
        return sum + Math.max(child.scrollHeight, child.getBoundingClientRect().height) + hiddenContent + number(childStyle.marginTop) + number(childStyle.marginBottom);
      }, 0);
    // Rust keeps width=396*scale and height=clamp(request,220,430)*scale in physical pixels.
    // The measured viewport width accounts for the actual DPI and native WebView zoom.
    const requested = Math.max(220, Math.min(430, Math.ceil(naturalHeight * 396 / Math.max(1, window.innerWidth))));
    if (requested === lastRequestedHeight) return;
    lastRequestedHeight = requested;
    window.jishi.resizePopup(requested).catch(() => { lastRequestedHeight = null; });
  });
}
function show(panel) { ["viewPanel", "snoozePanel", "editPanel"].forEach((id) => $(`#${id}`).classList.toggle("hidden", id !== panel)); $(`#${panel}`).scrollTop = 0; const focus = panel === "editPanel" ? $("#editTitle") : panel === "snoozePanel" ? $("#defaultButton") : $(".reminder-content"); focus.focus({preventScroll:true}); fitPopup(); }
function render(item) {
  reminder = item;
  if (!item) return;
  $("#title").textContent = item.title;
  const names = { urgent: "紧急", medium: "中等", normal: "一般" };
  const badge = $("#popupPriority");
  badge.textContent = names[item.priority] || "";
  badge.className = "priority-badge priority-" + (item.priority || "none");
  badge.classList.toggle("hidden", settings.priorityEnabled === false || !names[item.priority]);
  $("#note").textContent = item.note || "提醒时间到了";
  const image = $("#reminderImage");
  const hasImage = typeof item.imageData === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(item.imageData);
  image.src = hasImage ? item.imageData : "";
  image.classList.toggle("hidden", !hasImage);
  if (hasImage) image.addEventListener("load", fitPopup, { once: true });
  fitPopup();
}
$("#dragHandle").addEventListener("mousedown", (event) => { if (event.button === 0 && !event.target.closest("button")) window.jishi.startPopupDrag(); });
$("#closeButton").addEventListener("click", () => window.jishi.closePopup());
$("#completeButton").addEventListener("click", () => window.jishi.completeReminder(reminder.id));
$("#laterButton").addEventListener("click", () => { resetTomorrow(); $("#defaultButton").textContent = `默认 · ${settings.defaultSnooze} 分钟后`; $("#customTime").value = toLocalInput(new Date(Date.now() + settings.defaultSnooze * 60000)); $("#customTime").min = toLocalInput(new Date()); show("snoozePanel"); });
$("#defaultButton").addEventListener("click", () => performSnooze(new Date(Date.now() + settings.defaultSnooze * 60000)));
$("#customButton").addEventListener("click", () => { if ($("#customTime").reportValidity() && $("#customTime").value) performSnooze(new Date($("#customTime").value)); });
$("#disableButton").addEventListener("click", () => window.jishi.disableReminder(reminder.id));
$("#snoozeBack").addEventListener("click", () => show("viewPanel"));
$("#editButton").addEventListener("click", () => { $("#editTitle").value = reminder.title; $("#editNote").value = reminder.note || ""; $("#editPriority").value = reminder.priority || ""; $("#editPriorityField").classList.toggle("hidden", settings.priorityEnabled === false); show("editPanel"); });
$("#editBack").addEventListener("click", () => show("viewPanel"));
$("#saveEdit").addEventListener("click", async () => { const title = $("#editTitle").value.trim(); if (!title) return; const note = $("#editNote").value.trim(), priority = $("#editPriority").value; await window.jishi.updateFromPopup(reminder.id, title, note, priority); reminder = { ...reminder, title, note, priority }; render(reminder); show("viewPanel"); });
window.jishi.onPopupChanged((item) => { render(item); show("viewPanel"); });
Promise.all([window.jishi.getPopupReminder(), window.jishi.loadState()]).then(([item, state]) => { settings = state.settings; applyAppearance(settings); render(item); if (item?.id?.startsWith("__preview__")) startPreviewCountdown(settings.previewSeconds); fitPopup(); });
new ResizeObserver(fitPopup).observe(document.querySelector(".popup"));
window.addEventListener('resize', fitPopup);
document.addEventListener('keydown', event => { if(event.key === 'Escape' && !snoozeBusy && $("#viewPanel").classList.contains('hidden')) { event.preventDefault(); show('viewPanel'); } });

let snoozeBusy = false;
async function performSnooze(due) {
  if (snoozeBusy || !reminder) return;
  const error = $("#snoozeError"); error.textContent = "";
  if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) { error.textContent = "请选择未来的提醒时间"; return; }
  snoozeBusy = true;
  const buttons = [...$("#snoozePanel").querySelectorAll("button")]; buttons.forEach(button => button.disabled = true);
  try { await window.jishi.snoozeReminder(reminder.id, due.toISOString()); }
  catch (_) { error.textContent = "未能保存提醒时间，请重试。事项仍然保留。"; }
  finally { snoozeBusy = false; buttons.forEach(button => button.disabled = false); }
}
function updateTomorrowLabel() { $("#tomorrowButton").textContent = "明天 " + ($("#tomorrowTime").value || settings.tomorrowReminderTime || "09:00") + " 提醒"; fitPopup(); }
function resetTomorrow() { $("#snoozeError").textContent = ""; $("#tomorrowTime").value = settings.tomorrowReminderTime || "09:00"; $("#tomorrowOptions").classList.add("hidden"); $("#adjustTomorrow").setAttribute("aria-expanded","false"); updateTomorrowLabel(); }
$("#tomorrowTime").addEventListener("change", updateTomorrowLabel);
$("#adjustTomorrow").addEventListener("click", () => { const expanded = $("#tomorrowOptions").classList.toggle("hidden") === false; $("#adjustTomorrow").setAttribute("aria-expanded",String(expanded)); if(expanded) $("#tomorrowTime").focus(); fitPopup(); });
$("#tomorrowButton").addEventListener("click", () => { if (!$("#tomorrowTime").reportValidity()) return; performSnooze(window.JishiTime.tomorrow(new Date(), $("#tomorrowTime").value)); });
window.jishi.onStateChanged(state => { settings = state.settings; document.body.dataset.priorityPalette = settings.priorityPalette || ""; if(reminder) render(state.reminders.find(item=>item.id===reminder.id) || reminder); });

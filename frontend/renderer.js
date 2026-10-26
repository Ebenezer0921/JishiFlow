let state = { reminders: [], settings: { defaultSnooze: 10, popupSize: 3, textSize: 3, popupFont: "system", popupTransparency: 0, searchScope: "all", searchHighlightSeconds: 3, previewSeconds: 5 } };
let currentView = "pending";
let editingId = null;
let batchRows = [];
const reminderIcon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
const positionNames = { "top-left": "左上", "top-center": "顶部居中", "top-right": "右上", "center-left": "左侧居中", center: "屏幕中央", "center-right": "右侧居中", "bottom-left": "左下", "bottom-center": "底部居中", "bottom-right": "右下" };
const sizeNames = ["", "很小", "较小", "标准", "较大", "很大"];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
function toLocalInput(date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function formatDue(value) {
  const date = new Date(value), now = new Date();
  const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  if (date.toDateString() === now.toDateString()) return `今天 ${clock}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `明天 ${clock}`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function escapeHtml(value) { return String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function refreshSearchResults() {
  const query = $("#searchInput").value.trim().toLocaleLowerCase();
  $("#clearSearch").classList.toggle("hidden", !query);
  if (!query) { $("#searchResults").classList.add("hidden"); $("#searchResults").innerHTML = ""; return; }
  const searchNotes = (state.settings.searchScope || "all") === "all";
  const matches = state.reminders.filter((item) => item.title.toLocaleLowerCase().includes(query) || (searchNotes && (item.note || "").toLocaleLowerCase().includes(query))).slice(0, 30);
  $("#searchResults").innerHTML = matches.length ? matches.map((item) => `<button class="search-result" data-search-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.note || formatDue(item.dueAt))}</small><em>${item.status === "done" ? "已完成" : "待提醒"}</em></button>`).join("") : '<div class="search-empty">没有找到相关提醒</div>';
  $("#searchResults").classList.remove("hidden");
}
function locateSearchResult(id) {
  const item = state.reminders.find((entry) => entry.id === id); if (!item) return;
  currentView = item.status === "done" ? "done" : "pending";
  $("#searchInput").value = ""; refreshSearchResults(); render();
  requestAnimationFrame(() => {
    const row = document.querySelector(`.reminder-row[data-id="${CSS.escape(id)}"]`); if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" }); row.classList.add("search-highlight");
    setTimeout(() => row.classList.remove("search-highlight"), (state.settings.searchHighlightSeconds || 3) * 1000);
  });
}
function batchError(lineNumber, source, message) { return { lineNumber, source, status: "error", message }; }
function parseBatchLine(source, lineNumber) {
  const text = source.trim();
  const timeMatch = text.match(/(?:^|\s)(\d{1,2}:\d{2}|\d{4})\s*$/);
  if (!timeMatch) return batchError(lineNumber, text, "缺少时间，请在末尾填写 19:00 或 1900");
  const timeText = timeMatch[1];
  const hour = timeText.includes(":") ? Number(timeText.split(":")[0]) : Number(timeText.slice(0, 2));
  const minute = timeText.includes(":") ? Number(timeText.split(":")[1]) : Number(timeText.slice(2));
  if (hour > 23 || minute > 59) return batchError(lineNumber, text, "时间无效，请检查小时和分钟");
  const beforeTime = text.slice(0, timeMatch.index).trim();
  const dateMatch = beforeTime.match(/(?:^|\s)(今天|明天|后天|\d{4}[.-]\d{1,2}[.-]\d{1,2}|\d{1,2}[.-]\d{1,2})\s*$/);
  const dateText = dateMatch?.[1] || "今天";
  const title = (dateMatch ? beforeTime.slice(0, dateMatch.index) : beforeTime).trim();
  if (!title) return batchError(lineNumber, text, "缺少提醒事项");
  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth() + 1, day = now.getDate();
  if (["明天", "后天"].includes(dateText)) {
    const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (dateText === "明天" ? 1 : 2));
    year = shifted.getFullYear(); month = shifted.getMonth() + 1; day = shifted.getDate();
  } else if (!["今天"].includes(dateText)) {
    const parts = dateText.split(/[.-]/).map(Number);
    if (parts.length === 3) [year, month, day] = parts;
    else [month, day] = parts;
  }
  const due = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (due.getFullYear() !== year || due.getMonth() !== month - 1 || due.getDate() !== day) return batchError(lineNumber, text, "日期无效，请检查月份和日期");
  const status = due.getTime() <= Date.now() ? "past" : "valid";
  return { lineNumber, source: text, title, dueAt: due.toISOString(), status, message: status === "past" ? "该时间已经过去，需要确认后创建" : "识别成功" };
}
function formatBatchDue(value) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function refreshBatchPreview() {
  const sourceLines = $("#batchInput").value.split(/\r?\n/);
  batchRows = sourceLines.map((line, index) => ({ line, index: index + 1 })).filter((item) => item.line.trim()).map((item) => parseBatchLine(item.line, item.index));
  const errors = batchRows.filter((item) => item.status === "error").length;
  const past = batchRows.filter((item) => item.status === "past").length;
  const ready = batchRows.length - errors;
  $("#batchLineCount").textContent = batchRows.length ? `识别到 ${batchRows.length} 行，空行已忽略` : "一行一条，空行会自动忽略";
  $("#previewSummary").textContent = batchRows.length ? `${ready} 条可创建${errors ? ` · ${errors} 条有错误` : ""}` : "等待输入";
  $("#batchPreview").innerHTML = batchRows.length ? batchRows.map((item) => {
    if (item.status === "error") return `<div class="preview-row error"><span class="preview-icon">!</span><span class="preview-copy"><strong>第 ${item.lineNumber} 行：${escapeHtml(item.source)}</strong><small>${escapeHtml(item.message)}</small></span><span class="preview-time">无法识别</span></div>`;
    return `<div class="preview-row ${item.status}"><span class="preview-icon">${item.status === "past" ? "!" : "✓"}</span><span class="preview-copy"><strong>${escapeHtml(item.title)}</strong><small>第 ${item.lineNumber} 行 · ${escapeHtml(item.message)}</small></span><span class="preview-time">${formatBatchDue(item.dueAt)}</span></div>`;
  }).join("") : '<div class="preview-empty">输入提醒后，这里会显示解析结果。</div>';
  $("#pastConfirmRow").classList.toggle("hidden", past === 0);
  if (!past) $("#pastConfirm").checked = false;
  $("#createBatchButton").disabled = ready === 0 || (past > 0 && !$("#pastConfirm").checked);
  $("#createBatchButton").textContent = ready ? `创建 ${ready} 条提醒` : "创建提醒";
}
async function persist() { state = await window.jishi.saveState(state); render(); }
function setTransferStatus(message, isError = false) {
  const target = $("#transferStatus");
  target.textContent = message;
  target.classList.toggle("error", isError);
}
function exportReminders() {
  const payload = { format: "jishi-reminder", version: 1, exportedAt: new Date().toISOString(), reminders: state.reminders };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  const day = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.download = `及时提醒备份-${day}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setTransferStatus(`已导出 ${state.reminders.length} 条提醒`);
}
async function importReminders(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const source = Array.isArray(parsed) ? parsed : parsed?.reminders;
    if (!Array.isArray(source)) throw new Error("文件中没有提醒事项列表");
    const valid = source.filter((item) => item && typeof item.title === "string" && item.title.trim() && !Number.isNaN(Date.parse(item.dueAt)));
    if (!valid.length) throw new Error("没有找到可以导入的提醒事项");
    if (!window.confirm(`确认导入 ${valid.length} 条提醒？\n已有提醒不会被覆盖。`)) return;
    const existingIds = new Set(state.reminders.map((item) => item.id));
    let skipped = 0;
    const incoming = valid.flatMap((item) => {
      if (item.id && existingIds.has(item.id)) { skipped += 1; return []; }
      const id = item.id || crypto.randomUUID(); existingIds.add(id);
      return [{ id, title: item.title.trim(), note: typeof item.note === "string" ? item.note : "", dueAt: new Date(item.dueAt).toISOString(), status: item.status === "done" ? "done" : "pending", completedAt: item.completedAt || null }];
    });
    state.reminders.push(...incoming);
    await persist();
    setTransferStatus(`成功导入 ${incoming.length} 条${skipped ? `，跳过 ${skipped} 条重复事项` : ""}`);
  } catch (error) {
    setTransferStatus(`导入失败：${error.message || "文件格式不正确"}`, true);
  }
}
function render() {
  const pendingCount = state.reminders.filter((item) => item.status === "pending").length;
  $("#todayText").textContent = `今天 · ${pendingCount} 个待办`;
  const items = state.reminders.filter((item) => item.status === currentView).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  $("#listTitle").textContent = currentView === "pending" ? "接下来" : "已完成";
  $("#itemCount").textContent = items.length; $("#snoozeInput").value = state.settings.defaultSnooze;
  const popupSize = state.settings.popupSize || 3, textSize = state.settings.textSize || 3;
  $("#popupSizeInput").value = popupSize; $("#popupSizeName").textContent = sizeNames[popupSize];
  $("#textSizeInput").value = textSize; $("#textSizeName").textContent = sizeNames[textSize];
  $("#popupFontInput").value = state.settings.popupFont || "system";
  $("#popupTransparencyInput").value = state.settings.popupTransparency || 0; $("#popupTransparencyName").textContent = `${state.settings.popupTransparency || 0}%`;
  $("#searchScopeInput").value = state.settings.searchScope || "all"; $("#searchHighlightInput").value = state.settings.searchHighlightSeconds || 3;
  $("#previewSecondsInput").value = state.settings.previewSeconds || 5;
  const popupPosition = state.settings.popupPosition || "bottom-right";
  $$("#positionGrid button").forEach((button) => button.classList.toggle("active", button.dataset.position === popupPosition));
  $("#positionName").textContent = positionNames[popupPosition];
  $$(".segmented button").forEach((button) => { const selected = button.dataset.view === currentView; button.classList.toggle("active", selected); button.setAttribute("aria-pressed", String(selected)); });
  refreshSearchResults();
  if (!items.length) {
    $("#reminderList").innerHTML = `<div class="empty-state"><span class="empty-bell">${reminderIcon}</span><strong>${currentView === "pending" ? "现在没有待提醒事项" : "还没有完成的事项"}</strong><span>${currentView === "pending" ? "可以放心去做眼前的事。" : "完成一个提醒后会出现在这里。"}</span></div>`; return;
  }
  $("#reminderList").innerHTML = items.map((item) => `<div class="reminder-row ${item.status === "done" ? "is-done" : ""}" data-id="${item.id}"><button class="check-button" aria-label="${escapeHtml(item.status === "done" ? "重新启用提醒：" + item.title : "完成提醒：" + item.title)}" data-action="toggle">${item.status === "done" ? "✓" : ""}</button><button class="reminder-copy" data-action="edit"><strong>${escapeHtml(item.title)}</strong>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</button><button class="reminder-time" data-action="edit">${item.status === "done" ? "已完成" : formatDue(item.dueAt)} <span>›</span></button></div>`).join("");
}
function openEditor(item = null) {
  editingId = item?.id || null; $("#editorTitle").textContent = item ? "编辑提醒" : "新建提醒";
  $("#titleInput").value = item?.title || ""; $("#noteInput").value = item?.note || "";
  $("#dueInput").value = toLocalInput(item ? new Date(item.dueAt) : new Date(Date.now() + 30 * 60000)); $("#dueInput").min = toLocalInput(new Date());
  $("#deleteButton").classList.toggle("hidden", !item); $("#editorOverlay").classList.remove("hidden"); setTimeout(() => $("#titleInput").focus(), 50);
}
function closeDialog(name) { $(`#${name}Overlay`).classList.add("hidden"); }
$("#newButton").addEventListener("click", () => openEditor());
$("#batchButton").addEventListener("click", () => { $("#batchOverlay").classList.remove("hidden"); refreshBatchPreview(); setTimeout(() => $("#batchInput").focus(), 50); });
$("#settingsButton").addEventListener("click", () => $("#settingsOverlay").classList.remove("hidden"));
$("#searchInput").addEventListener("input", refreshSearchResults);
$("#searchInput").addEventListener("focus", refreshSearchResults);
$("#clearSearch").addEventListener("click", () => { $("#searchInput").value = ""; refreshSearchResults(); $("#searchInput").focus(); });
$("#searchResults").addEventListener("click", (event) => { const result = event.target.closest("[data-search-id]"); if (result) locateSearchResult(result.dataset.searchId); });
document.addEventListener("mousedown", (event) => { if (!event.target.closest(".reminder-search")) $("#searchResults").classList.add("hidden"); });
$("#testReminderButton").addEventListener("click", async () => { await window.jishi.testReminder(); });
$("#exportButton").addEventListener("click", exportReminders);
$("#importButton").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (event) => { const [file] = event.target.files; if (file) await importReminders(file); event.target.value = ""; });
$$('[data-close="editor"]').forEach((button) => button.addEventListener("click", () => closeDialog("editor")));
$$('[data-close="settings"]').forEach((button) => button.addEventListener("click", () => closeDialog("settings")));
$$('[data-close="batch"]').forEach((button) => button.addEventListener("click", () => closeDialog("batch")));
$$(".dialog-overlay").forEach((overlay) => overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) overlay.classList.add("hidden"); }));
$$(".segmented button").forEach((button) => button.addEventListener("click", () => { currentView = button.dataset.view; render(); }));
$("#reminderList").addEventListener("click", async (event) => {
  const row = event.target.closest(".reminder-row"), action = event.target.closest("button")?.dataset.action;
  if (!row || !action) return; const item = state.reminders.find((entry) => entry.id === row.dataset.id);
  if (action === "edit") openEditor(item);
  if (action === "toggle") {
    if (row.classList.contains("completing") || row.classList.contains("restoring")) return;
    if (item.status === "pending") {
      row.classList.add("completing");
      row.querySelector(".check-button").textContent = "✓";
      await new Promise((resolve) => setTimeout(resolve, 520));
      Object.assign(item, { status: "done", completedAt: new Date().toISOString() });
    } else {
      row.classList.add("restoring");
      row.querySelector(".check-button").textContent = "";
      await new Promise((resolve) => setTimeout(resolve, 520));
      Object.assign(item, { status: "pending", completedAt: null, dueAt: new Date(Date.now() + state.settings.defaultSnooze * 60000).toISOString() });
    }
    await persist();
  }
});
$("#reminderForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const record = { title: $("#titleInput").value.trim(), note: $("#noteInput").value.trim(), dueAt: new Date($("#dueInput").value).toISOString() };
  if (!record.title) return; if (editingId) Object.assign(state.reminders.find((item) => item.id === editingId), record); else state.reminders.push({ id: crypto.randomUUID(), ...record, status: "pending" });
  currentView = "pending"; await persist(); closeDialog("editor");
});
$("#deleteButton").addEventListener("click", async () => { if (!editingId) return; state.reminders = state.reminders.filter((item) => item.id !== editingId); await persist(); closeDialog("editor"); });
$("#snoozeInput").addEventListener("change", async (event) => { state.settings.defaultSnooze = Math.max(1, Math.min(525600, Math.round(Number(event.target.value) || 1))); await persist(); });
$("#positionGrid").addEventListener("click", async (event) => { const button = event.target.closest("button[data-position]"); if (!button) return; state.settings.popupPosition = button.dataset.position; await persist(); await window.jishi.previewReminder(); });
$("#popupSizeInput").addEventListener("input", (event) => { $("#popupSizeName").textContent = sizeNames[Number(event.target.value)]; });
$("#popupSizeInput").addEventListener("change", async (event) => { state.settings.popupSize = Number(event.target.value); await persist(); await window.jishi.previewReminder(); });
$("#textSizeInput").addEventListener("input", (event) => { $("#textSizeName").textContent = sizeNames[Number(event.target.value)]; });
$("#textSizeInput").addEventListener("change", async (event) => { state.settings.textSize = Number(event.target.value); await persist(); await window.jishi.previewReminder(); });
$("#popupFontInput").addEventListener("change", async (event) => { state.settings.popupFont = event.target.value; await persist(); await window.jishi.previewReminder(); });
$("#popupTransparencyInput").addEventListener("input", (event) => { $("#popupTransparencyName").textContent = `${event.target.value}%`; });
$("#popupTransparencyInput").addEventListener("change", async (event) => { state.settings.popupTransparency = Number(event.target.value); await persist(); await window.jishi.previewReminder(); });
$("#searchScopeInput").addEventListener("change", async (event) => { state.settings.searchScope = event.target.value; await persist(); refreshSearchResults(); });
$("#searchHighlightInput").addEventListener("change", async (event) => { state.settings.searchHighlightSeconds = Math.max(1, Math.min(10, Math.round(Number(event.target.value) || 3))); await persist(); });
$("#previewSecondsInput").addEventListener("change", async (event) => { state.settings.previewSeconds = Math.max(1, Math.min(30, Math.round(Number(event.target.value) || 5))); await persist(); await window.jishi.previewReminder(); });
$("#batchInput").addEventListener("input", refreshBatchPreview);
$("#pastConfirm").addEventListener("change", refreshBatchPreview);
$("#createBatchButton").addEventListener("click", async () => {
  const creatable = batchRows.filter((item) => item.status !== "error");
  if (!creatable.length || (creatable.some((item) => item.status === "past") && !$("#pastConfirm").checked)) return;
  state.reminders.push(...creatable.map((item) => ({ id: crypto.randomUUID(), title: item.title, note: "", dueAt: item.dueAt, status: "pending" })));
  currentView = "pending"; await persist(); $("#batchInput").value = ""; refreshBatchPreview(); closeDialog("batch");
});
window.jishi.onStateChanged((next) => { state = next; render(); });
window.jishi.loadState().then((loaded) => { state = loaded; render(); });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'frontend/renderer.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'frontend/popup.js'), 'utf8');
let checks = 0;
async function check(name, run) { await run(); checks++; console.log('PASS ' + name); }
function element(value = '', disabled = false) {
  const classes = new Set(['hidden']);
  return { value, disabled, textContent: '', innerHTML: '',
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, yes) { if (yes) classes.add(c); else classes.delete(c); } },
    setAttribute() {}, addEventListener() {} };
}
function mainContext() {
  const nodes = {}, handlers = {}, controls = [element(), element('', true)], writes = [];
  const ctx = { state: { reminders: [], settings: {} }, editingId: null, editorImageData: '', currentView: 'pending',
    editorDraftKey: 'draft', Date, crypto: { randomUUID: () => 'new-id' },
    $: selector => nodes[selector] ||= Object.assign(element(), { addEventListener(type, fn) { handlers[selector + ':' + type] = fn; } }),
    $$: () => controls, render() {}, closeDialog: name => ctx.closed.push(name), closed: [],
    localStorage: { removeItem: key => ctx.removed.push(key) }, removed: [],
    document: { activeElement: { isConnected: true, disabled: false, focus() { ctx.focusRestored = true; } } },
    window: { confirm: () => true, jishi: { saveState: value => new Promise((resolve, reject) => writes.push({ value: JSON.parse(JSON.stringify(value)), resolve, reject })) } } };
  vm.createContext(ctx);
  vm.runInContext(renderer.slice(renderer.indexOf('let saveBusy'), renderer.indexOf('function setTransferStatus')), ctx);
  vm.runInContext('lastSavedState = JSON.parse(JSON.stringify(state))', ctx);
  return { ctx, nodes, handlers, controls, writes };
}
(async () => {
  await check('save failure rolls back working state, restores controls and permits retry', async () => {
    const { ctx, controls, writes } = mainContext();
    ctx.state.reminders.push({ id: 'unsaved' });
    const pending = ctx.persist();
    assert(controls.every(c => c.disabled));
    assert.equal(await ctx.persist(), false); assert.equal(writes.length, 1);
    writes[0].reject(new Error('disk full')); assert.equal(await pending, false);
    assert.equal(ctx.state.reminders.length, 0); assert.deepEqual(controls.map(c => c.disabled), [false, true]);
    assert.equal(ctx.focusRestored, true);
    assert(!ctx.$('#saveError').classList.contains('hidden'));
    const retry = ctx.persist(); writes[1].resolve(writes[1].value); assert.equal(await retry, true);
    assert(ctx.$('#saveError').classList.contains('hidden'));
  });
  await check('new reminder failure preserves form, prevents double submit and retries once', async () => {
    const { ctx, handlers, writes } = mainContext();
    vm.runInContext(renderer.slice(renderer.indexOf('$("#reminderForm").addEventListener'), renderer.indexOf('$("#snoozeInput").addEventListener')), ctx);
    ctx.$('#titleInput').value = '保留输入'; ctx.$('#noteInput').value = '备注'; ctx.$('#dueInput').value = '2099-01-01T09:00';
    const submit = handlers['#reminderForm:submit'], event = { preventDefault() {} };
    const first = submit(event); await submit(event); assert.equal(writes.length, 1);
    writes[0].reject(new Error('save failed')); await first;
    assert.equal(ctx.closed.length, 0); assert.equal(ctx.removed.length, 0);
    assert.equal(ctx.$('#titleInput').value, '保留输入'); assert.equal(ctx.state.reminders.length, 0);
    const retry = submit(event); assert.equal(writes[1].value.reminders.length, 1);
    writes[1].resolve(writes[1].value); await retry;
    assert.deepEqual(ctx.closed, ['editor']); assert.deepEqual(ctx.removed, ['draft']);
  });
  await check('failed deletion retains reminder and leaves editor open', async () => {
    const { ctx, handlers, writes } = mainContext();
    ctx.editingId = 'existing'; ctx.state.reminders = [{ id: 'existing' }];
    vm.runInContext('lastSavedState = JSON.parse(JSON.stringify(state))', ctx);
    vm.runInContext(renderer.slice(renderer.indexOf('$("#deleteButton").addEventListener'), renderer.indexOf('$("#snoozeInput").addEventListener')), ctx);
    const pending = handlers['#deleteButton:click'](); writes[0].reject(new Error('denied')); await pending;
    assert.equal(ctx.state.reminders[0].id, 'existing'); assert.equal(ctx.closed.length, 0);
  });
  await check('batch failure preserves input and does not duplicate reminders on retry', async () => {
    const { ctx, handlers, writes } = mainContext();
    ctx.batchRows = [{ status: 'valid', title: '批量事项', dueAt: '2099-01-01T09:00:00Z' }];
    ctx.refreshBatchPreview = () => {}; ctx.$('#batchInput').value = '批量事项 明天 09:00';
    vm.runInContext(renderer.slice(renderer.indexOf('$("#createBatchButton").addEventListener'), renderer.indexOf('window.jishi.onStateChanged')), ctx);
    const pending = handlers['#createBatchButton:click'](); writes[0].reject(new Error('denied')); await pending;
    assert.equal(ctx.$('#batchInput').value, '批量事项 明天 09:00'); assert.equal(ctx.closed.length, 0);
    const retry = handlers['#createBatchButton:click'](); assert.equal(writes[1].value.reminders.length, 1);
    writes[1].resolve(writes[1].value); await retry; assert.equal(ctx.$('#batchInput').value, '');
  });
  await check('import validates ID/date types, normalizes completion and rejects prototype priorities', async () => {
    const { ctx } = mainContext();
    ctx.priorityNames = { urgent: '紧急', medium: '中等', normal: '一般' };
    ctx.isSupportedImageData = () => false; ctx.persist = async () => true;
    ctx.setTransferStatus = text => { ctx.status = text; };
    vm.runInContext(renderer.slice(renderer.indexOf('async function importReminders'), renderer.indexOf('function render()')), ctx);
    const row = { title: '导入测试', dueAt: '2099-01-01T09:00:00Z' };
    await ctx.importReminders({ text: async () => JSON.stringify({ reminders: [
      { ...row, id: 'quoted"id', completedAt: {}, priority: 'toString' },
      { ...row, id: 123 }, { ...row, id: {} }, { ...row, dueAt: 0 },
      { ...row, id: 'done', status: 'done', completedAt: '2026-11-10T00:00:00Z' },
      { ...row, id: 'quoted"id' }, { ...row }
    ] }) });
    assert.equal(ctx.state.reminders.length, 3);
    assert.equal(ctx.state.reminders[0].id, 'quoted"id'); assert.equal(ctx.state.reminders[0].completedAt, null);
    assert.equal(ctx.state.reminders[0].priority, ''); assert.equal(ctx.state.reminders[1].completedAt, '2026-11-10T00:00:00Z');
    assert(ctx.status.includes('3 条无效')); assert(ctx.status.includes('1 条重复'));
  });
  await check('list escapes imported ID attributes while retaining the ID value', () => {
    const { ctx } = mainContext();
    ctx.state.reminders = [{ id: 'x" data-extra="bad', title: '普通标题', status: 'pending', dueAt: '2099-01-01T00:00:00Z' }];
    Object.assign(ctx, { $$: () => [], document: { body: { dataset: {} } }, sizeNames: ['', '1', '2', '3'], positionNames: {}, refreshSearchResults() {},
      priorityMarkup: () => '', isSupportedImageData: () => false, formatDue: () => '明天', reminderIcon: '' });
    vm.runInContext(renderer.slice(renderer.indexOf('function escapeHtml'), renderer.indexOf('function isSupportedImageData')), ctx);
    vm.runInContext(renderer.slice(renderer.indexOf('function render()'), renderer.indexOf('function openImageViewer')), ctx);
    ctx.render(); const html = ctx.$('#reminderList').innerHTML;
    assert(html.includes('data-id="x&quot; data-extra=&quot;bad"')); assert(!html.includes('data-id="x" data-extra="bad"'));
  });
  await check('failed import reports failure and retry inserts only one copy', async () => {
    const { ctx, writes } = mainContext();
    ctx.priorityNames = {}; ctx.isSupportedImageData = () => false;
    ctx.setTransferStatus = text => { ctx.status = text; };
    vm.runInContext(renderer.slice(renderer.indexOf('async function importReminders'), renderer.indexOf('function render()')), ctx);
    const file = { text: async () => JSON.stringify([{ id: 'incoming', title: '新事项', dueAt: '2099-01-01T09:00:00Z' }]) };
    const first = ctx.importReminders(file); await new Promise(setImmediate);
    writes[0].reject(new Error('disk full')); await first;
    assert.equal(ctx.state.reminders.length, 0); assert(ctx.status.includes('未能确认保存'));
    const retry = ctx.importReminders(file); await new Promise(setImmediate);
    assert.equal(writes[1].value.reminders.length, 1); writes[1].resolve(writes[1].value); await retry;
    assert(ctx.status.includes('成功导入 1 条'));
  });
  await check('popup failure restores disabled states, retains edit panel and allows retry', async () => {
    const controls = [element(), element('', true)], error = element(), pending = [];
    const ctx = { reminder: { id: '__test__' }, $: () => error,
      document: { querySelectorAll: () => controls }, fitPopup() {} };
    vm.createContext(ctx); vm.runInContext(popup.slice(popup.indexOf('let popupBusy'), popup.indexOf('async function performSnooze')), ctx);
    const action = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    const first = ctx.runPopupAction(action); assert.equal(await ctx.runPopupAction(action), false); assert.equal(pending.length, 1);
    pending[0].reject(new Error('denied')); assert.equal(await first, false);
    assert.deepEqual(controls.map(c => c.disabled), [false, true]); assert(!error.classList.contains('hidden'));
    const retry = ctx.runPopupAction(action); pending[1].resolve(); assert.equal(await retry, true);
    assert(error.classList.contains('hidden'));
  });
  await check('popup edit handler retains text after failure and returns to view only on success', async () => {
    const nodes = {}, pending = [], handlers = {};
    const ctx = { reminder: { id: '__test__', title: '原标题', note: '原备注' },
      $: selector => nodes[selector] ||= Object.assign(element(), { addEventListener(type, fn) { handlers[selector + ':' + type] = fn; } }),
      document: { querySelectorAll: () => [] }, fitPopup() {}, render() {}, show: panel => ctx.shown.push(panel), shown: [],
      window: { jishi: { updateFromPopup: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) } } };
    vm.createContext(ctx); vm.runInContext(popup.slice(popup.indexOf('let popupBusy'), popup.indexOf('async function performSnooze')), ctx);
    vm.runInContext(popup.slice(popup.indexOf('$("#saveEdit").addEventListener'), popup.indexOf('window.jishi.onPopupChanged')), ctx);
    ctx.$('#editTitle').value = '原标题'; ctx.$('#editNote').value = '新备注';
    const first = handlers['#saveEdit:click'](); pending[0].reject(new Error('denied')); await first;
    assert.equal(ctx.$('#editNote').value, '新备注'); assert.equal(ctx.shown.length, 0); assert.equal(ctx.reminder.note, '原备注');
    const retry = handlers['#saveEdit:click'](); pending[1].resolve(); await retry;
    assert.equal(ctx.reminder.note, '新备注'); assert.deepEqual(ctx.shown, ['viewPanel']);
  });
  console.log(checks + ' save safety checks passed (simulated IPC/DOM, not desktop validation).');
})().catch(error => { console.error(error); process.exitCode = 1; });

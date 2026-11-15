const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const time = require('../frontend/time-controls.js');
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
    editorDraftKey: 'draft', imageBusy: false, syncSaveButton() {}, Date, crypto: { randomUUID: () => 'new-id' },
    $: selector => nodes[selector] ||= Object.assign(element(), { addEventListener(type, fn) { handlers[selector + ':' + type] = fn; } }),
    $$: () => controls, render() {}, closeDialog: name => ctx.closed.push(name), closed: [],
    localStorage: { removeItem: key => ctx.removed.push(key) }, removed: [],
    document: { activeElement: { isConnected: true, disabled: false, focus() { ctx.focusRestored = true; } } },
    window: { confirm: () => true, JishiTime: time, jishi: { saveState: value => new Promise((resolve, reject) => writes.push({ value: JSON.parse(JSON.stringify(value)), resolve, reject })) } } };
  vm.createContext(ctx);
  vm.runInContext(renderer.slice(renderer.indexOf('let saveBusy'), renderer.indexOf('function setTransferStatus')), ctx);
  vm.runInContext('lastSavedState = JSON.parse(JSON.stringify(state))', ctx);
  return { ctx, nodes, handlers, controls, writes };
}
function popupContext() {
  const nodes = {}, handlers = {}, frames = [];
  const item = { id: '__test__', title: '标题', note: '备注', priority: '', imageData: '' };
  const current = { reminders: [item], settings: { defaultSnooze: 10, tomorrowReminderTime: '09:00', collapseMinutes: 10 } };
  const ctx = { Date, console: { error() {} }, requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    document: { body: { dataset: {} }, documentElement: { style: { setProperty() {} } },
      querySelector: selector => nodes[selector] ||= Object.assign(element(), { isConnected: true, style: {}, focus() { ctx.document.activeElement = this; }, removeAttribute() {},
        addEventListener(name, fn) { (handlers[selector + ':' + name] ||= []).push(fn); }, getBoundingClientRect() { return { height: 320 }; }, reportValidity() { return /^\d{2}:\d{2}$/.test(this.value); } }),
      querySelectorAll: () => ['#laterButton','#defaultButton','#tomorrowButton','#customButton','#saveEdit'].map(s => ctx.document.querySelector(s)), addEventListener() {} },
    window: { innerWidth: 396, JishiTime: time, addEventListener() {}, jishi: {
      onStateChanged: fn => { ctx.emitState = fn; return Promise.resolve(() => {}); },
      onPopupChanged: fn => { ctx.emitPopup = fn; return Promise.resolve(() => {}); },
      loadState: async () => JSON.parse(JSON.stringify(current)), getPopupReminder: async () => ({ ...item }), resizePopup: async () => {},
      snoozeReminder: async (id, due) => { ctx.snoozed.push({ id, due }); }
    } }, snoozed: [] };
  vm.createContext(ctx);
  vm.runInContext(popup.replace(/initializePopup\(\);\s*$/, ''), ctx);
  ctx.document.querySelector('#viewPanel').classList.remove('hidden');
  return { ctx, current, item, handlers, frames, get: selector => ctx.document.querySelector(selector) };
}
function imageContext() {
  const nodes = {}, pending = [];
  const ctx = { saveBusy: false, editorImageData: 'old-image', renderEditorImage() {}, saveEditorDraft() {},
    $: selector => nodes[selector] ||= element(),
    encodeReminderImage: file => new Promise((resolve, reject) => pending.push({ name: file.name, resolve, reject })) };
  ctx.$('#editorOverlay').classList.remove('hidden');
  vm.createContext(ctx); vm.runInContext(renderer.slice(renderer.indexOf('let imageOperation'),renderer.indexOf('function refreshSearchResults')),ctx);
  return { ctx, pending };
}
(async () => {
  await check('corner and overflow failures keep saved settings and never create a preview', async () => {
    const {ctx,handlers,writes}=mainContext();ctx.state.settings={popupPosition:'bottom-right',popupOverflow:'smart'};
    vm.runInContext('lastSavedState=JSON.parse(JSON.stringify(state))',ctx);
    vm.runInContext(renderer.slice(renderer.indexOf('$("#positionGrid").addEventListener'),renderer.indexOf('$("#popupSizeInput").addEventListener')),ctx);
    let previews=0;ctx.window.jishi.previewReminder=()=>{previews++;};
    const event={target:{closest:()=>({dataset:{position:'top-left'}})}};
    const change=handlers['#positionGrid:click'](event);assert.equal(writes[0].value.settings.popupPosition,'top-left');writes[0].reject(Error('disk denied'));await change;
    assert.equal(ctx.state.settings.popupPosition,'bottom-right');assert.equal(previews,0);
    vm.runInContext(renderer.slice(renderer.lastIndexOf('$("#popupOverflow").addEventListener')),ctx);
    const overflow=handlers['#popupOverflow:change']({target:{value:'overlap'}});writes[1].reject(Error('disk denied'));await overflow;assert.equal(ctx.state.settings.popupOverflow,'smart');
    const retry=handlers['#popupOverflow:change']({target:{value:'overlap'}});writes[2].resolve(writes[2].value);await retry;assert.equal(ctx.state.settings.popupOverflow,'overlap');assert.equal(previews,0);
  });
  await check('title click raises without dragging; actual pointer movement starts one drag',async()=>{
    const {ctx,handlers}=popupContext();const events={};let raised=0,dragged=0;
    ctx.window.jishi.raisePopup=async()=>{raised++;};ctx.window.jishi.startPopupDrag=async()=>{dragged++;};
    ctx.window.addEventListener=(name,fn)=>events[name]=fn;ctx.window.removeEventListener=(name,fn)=>{if(events[name]===fn)delete events[name];};
    const down=handlers['#dragHandle:mousedown'][0];down({button:0,target:{closest:()=>null},clientX:10,clientY:10});events.mouseup();assert.equal(raised,1);assert.equal(dragged,0);
    down({button:0,target:{closest:()=>null},clientX:10,clientY:10});events.mousemove({buttons:1,clientX:12,clientY:10});assert.equal(dragged,0);events.mousemove({buttons:1,clientX:20,clientY:10});assert.equal(dragged,1);assert.equal(events.mousemove,undefined);
    down({button:0,target:{closest:()=>({})},clientX:10,clientY:10});assert.equal(raised,2);
  });
  await check('bridge returns listener rejection and cleans late subscriptions once', async () => {
    let reject, resolve, stopped=0; const events={};
    const ctx={window:{__TAURI__:{core:{invoke(){}},event:{listen:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})}},addEventListener:(name,fn)=>{events[name]=fn;}}};
    vm.runInNewContext(fs.readFileSync(path.join(root,'frontend/tauri-bridge.js'),'utf8'),ctx);
    const failed=ctx.window.jishi.onStateChanged(()=>{}); reject(new Error('ACL denied')); await assert.rejects(failed,/ACL denied/);
    const late=ctx.window.jishi.onPopupChanged(()=>{});events.beforeunload();resolve(()=>{stopped++;});const unlisten=await late;unlisten();assert.equal(stopped,1);
  });
  await check('existing popup refreshes defaults, preserves overrides and submits displayed clock once',async()=>{
    const {ctx,current,get,handlers}=popupContext();await ctx.initializePopup();
    current.settings={...current.settings,defaultSnooze:3,tomorrowReminderTime:'10:15'};
    await ctx.openSnooze();assert(get('#defaultButton').textContent.includes('3 分钟'));assert.equal(get('#tomorrowTime').value,'10:15');
    ctx.emitState({...current,settings:{...current.settings,defaultSnooze:4,tomorrowReminderTime:'11:20'}});
    assert(get('#defaultButton').textContent.includes('4 分钟'));assert.equal(get('#tomorrowTime').value,'11:20');
    get('#tomorrowTime').value='13:30';handlers['#tomorrowTime:change'][0]();get('#customTime').value='2099-12-31T12:34';handlers['#customTime:change'][0]();
    ctx.emitState({...current,settings:{...current.settings,tomorrowReminderTime:'15:00'}});
    assert.equal(get('#tomorrowTime').value,'13:30');assert.equal(get('#customTime').value,'2099-12-31T12:34');
    let release;ctx.window.jishi.snoozeReminder=(id,due)=>new Promise(resolve=>{ctx.snoozed.push({id,due});release=resolve;});
    handlers['#tomorrowButton:click'][0]();handlers['#tomorrowButton:click'][0]();assert.equal(ctx.snoozed.length,1);assert.equal(new Date(ctx.snoozed[0].due).getHours(),13);assert.equal(new Date(ctx.snoozed[0].due).getMinutes(),30);release();await new Promise(setImmediate);
  });
  await check('state changes preserve edit draft and unrelated events do not remeasure popup',async()=>{
    const {ctx,current,get,handlers,frames}=popupContext();await ctx.initializePopup();
    handlers['#editButton:click'][0]();get('#editTitle').value='未保存标题';get('#editNote').value='未保存备注';
    const before=frames.length;ctx.emitState({...current,settings:{...current.settings,defaultSnooze:4}});
    assert.equal(get('#editTitle').value,'未保存标题');assert.equal(get('#editNote').value,'未保存备注');assert(!get('#editPanel').classList.contains('hidden'));assert.equal(frames.length,before);
    await ctx.openSnooze();while(frames.length) frames.shift()();ctx.emitState({...current,reminders:[...current.reminders,{id:'unrelated',title:'other'}]});assert.equal(frames.length,0);
  });
  await check('popup initialization rejects stale snapshot after a newer settings event',async()=>{
    const {ctx,current,get}=popupContext();let finish;ctx.window.jishi.loadState=()=>new Promise(resolve=>{finish=resolve;});
    const init=ctx.initializePopup();await new Promise(setImmediate);ctx.emitState({...current,settings:{...current.settings,tomorrowReminderTime:'11:20'}});finish(current);await init;
    ctx.window.jishi.loadState=async()=>({...current,settings:{...current.settings,tomorrowReminderTime:'11:20'}});await ctx.openSnooze();assert.equal(get('#tomorrowTime').value,'11:20');
  });
  await check('settings read failure blocks stale scheduling, recovers and preserves input',async()=>{
    const {ctx,get}=popupContext();await ctx.initializePopup();ctx.window.jishi.loadState=async()=>{throw Error('read failed');};await ctx.openSnooze();
    assert(get('#snoozePanel').classList.contains('hidden'));assert(get('#popupError').textContent.includes('读取提醒设置失败'));
    await ctx.performSnooze(new Date(Date.now()+60000));assert.equal(ctx.snoozed.length,0);assert.equal(get('#laterButton').disabled,false);
    ctx.window.jishi.loadState=async()=>({reminders:[],settings:{defaultSnooze:7,tomorrowReminderTime:'12:00'}});await ctx.openSnooze();assert.equal(get('#tomorrowTime').value,'12:00');
  });
  await check('main initialization also preserves a newer event than its pending disk read',async()=>{
    const {ctx}=mainContext();let finish;ctx.window.jishi.onStateChanged=fn=>{ctx.emitState=fn;return Promise.resolve(()=>{});};ctx.window.jishi.loadState=()=>new Promise(resolve=>{finish=resolve;});
    vm.runInContext(renderer.slice(renderer.indexOf('let rendererEventRevision'),renderer.indexOf('$("#tomorrowReminderTime").addEventListener')),ctx);await new Promise(setImmediate);
    ctx.emitState({reminders:[{id:'new'}],settings:{}});finish({reminders:[],settings:{}});await new Promise(setImmediate);assert.equal(ctx.state.reminders[0].id,'new');
  });
  await check('latest image wins and stale remove/close results cannot replace attachments',async()=>{
    const {ctx,pending}=imageContext();const a=ctx.setEditorImage({name:'a'}),b=ctx.setEditorImage({name:'b'});pending[1].resolve('image-b');await b;pending[0].resolve('image-a');await a;assert.equal(ctx.editorImageData,'image-b');
    const late=ctx.setEditorImage({name:'late'});ctx.invalidateEditorImage();ctx.editorImageData='';pending[2].resolve('late-image');await late;assert.equal(ctx.editorImageData,'');
    const closed=ctx.setEditorImage({name:'closed'});ctx.invalidateEditorImage();ctx.$('#editorOverlay').classList.add('hidden');pending[3].resolve('closed-image');await closed;assert.equal(ctx.editorImageData,'');
  });
  await check('image failure keeps old data; image finally does not unlock a pending save',async()=>{
    const {ctx,pending}=imageContext();const failed=ctx.setEditorImage({name:'bad'});pending[0].reject(new Error('损坏图片'));await failed;assert.equal(ctx.editorImageData,'old-image');assert.equal(ctx.$('#reminderForm .save-button').disabled,false);
    const next=ctx.setEditorImage({name:'new'});ctx.saveBusy=true;pending[1].resolve('new-image');await next;assert.equal(ctx.$('#reminderForm .save-button').disabled,true);
    ctx.saveBusy=false;ctx.syncSaveButton();assert.equal(ctx.$('#reminderForm .save-button').disabled,false);
    await ctx.addEditorImageFiles([{name:'a'},{name:'b'}]);assert.equal(ctx.editorImageData,'new-image');assert.equal(ctx.$('#imageStatus').textContent,'一次添加一张图片');
  });
  await check('mixed import rejects calendar rollover, reports counts and writes once',async()=>{
    const {ctx,writes}=mainContext();ctx.priorityNames={urgent:'紧急'};ctx.isSupportedImageData=value=>value==='data:image/png;base64,AAAA';ctx.setTransferStatus=text=>{ctx.status=text;};
    vm.runInContext(renderer.slice(renderer.indexOf('async function importReminders'),renderer.indexOf('function render()')),ctx);
    const file={text:async()=>JSON.stringify([{id:'valid',title:'合法',dueAt:'2099-02-28T09:00:00+08:00',imageData:'data:image/png;base64,AAAA',priority:'urgent'},{id:'invalid',title:'不存在',dueAt:'2099-02-30T09:00:00+08:00'},{id:'bad',title:'无效',dueAt:'not-a-date'},{id:'done',title:'已完成',dueAt:'2099-03-01T09:00:00+08:00',status:'done',completedAt:'2099-02-30T00:00:00Z'}])};
    const pending=ctx.importReminders(file);await new Promise(setImmediate);assert.equal(writes.length,1);assert.equal(writes[0].value.reminders.length,2);assert.equal(writes[0].value.reminders[0].dueAt,'2099-02-28T01:00:00.000Z');assert.equal(writes[0].value.reminders[0].imageData,'data:image/png;base64,AAAA');assert.equal(writes[0].value.reminders[1].status,'done');assert.equal(writes[0].value.reminders[1].completedAt,null);writes[0].resolve(writes[0].value);await pending;assert(ctx.status.includes('忽略 2 条无效'));assert(ctx.status.includes('完成时间无效'));
    await ctx.importReminders(file);assert.equal(writes.length,1);assert(ctx.status.includes('跳过 2 条重复'));
  });
  await check('all-invalid import never saves or modifies an existing reminder',async()=>{
    const {ctx,writes}=mainContext();ctx.state.reminders=[{id:'keep'}];ctx.priorityNames={};ctx.setTransferStatus=text=>{ctx.status=text;};
    vm.runInContext(renderer.slice(renderer.indexOf('async function importReminders'),renderer.indexOf('function render()')),ctx);
    await ctx.importReminders({text:async()=>JSON.stringify([{id:'bad',title:'不存在',dueAt:'2099-02-30T09:00:00Z'}])});assert.equal(writes.length,0);assert.equal(ctx.state.reminders[0].id,'keep');assert(ctx.status.includes('日期不存在'));
  });
  await check('file drags are guarded globally, text drags remain intact and previews accept files',async()=>{
    const {ctx,pending}=imageContext();const handlers={},attachment=element();attachment.contains=()=>false;attachment.addEventListener=(name,fn)=>{handlers['attachment:'+name]=fn;};
    ctx.document={querySelector:()=>attachment,addEventListener:(name,fn)=>{handlers['document:'+name]=fn;}};
    for(const id of ['#editorOverlay'])ctx.$(id).addEventListener=(name,fn)=>{handlers[id+':'+name]=fn;};
    vm.runInContext(renderer.slice(renderer.indexOf('const imageAttachment'),renderer.indexOf('$("#testReminderButton")')),ctx);
    const drag=types=>({dataTransfer:{types,files:[{name:'replacement'}]},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
    const text=drag(['text/plain']);handlers['document:dragover'](text);assert.equal(text.defaultPrevented,false);
    const outside=drag(['Files']);handlers['document:drop'](outside);assert(outside.defaultPrevented);assert.equal(ctx.editorImageData,'old-image');assert(ctx.$('#imageStatus').textContent.includes('图片区域'));
    const dropped=drag(['Files']);const processed=handlers['attachment:drop'](dropped);handlers['document:drop'](dropped);assert.equal(pending.length,1);pending[0].resolve('replaced-image');await processed;assert.equal(ctx.editorImageData,'replaced-image');
    ctx.$('#editorOverlay').classList.add('hidden');const closed=drag(['Files']);handlers['document:drop'](closed);assert(closed.defaultPrevented);assert.equal(ctx.editorImageData,'replaced-image');
  });
  await check('shared image encoder validates empty MIME, size and releases decoded resources',async()=>{
    let closed=0,decodes=0;const ctx={createImageBitmap:async()=>{decodes++;return {width:2000,height:1000,close(){closed++;}};},document:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/webp;base64,AAAA'})}};
    vm.createContext(ctx);vm.runInContext(renderer.slice(renderer.indexOf('async function encodeReminderImage'),renderer.indexOf('let imageOperation')),ctx);
    assert.equal(await ctx.encodeReminderImage({type:'',name:'中文 图片(1).png',size:100}),'data:image/webp;base64,AAAA');assert.equal(closed,1);
    await assert.rejects(ctx.encodeReminderImage({type:'text/plain',name:'bad.txt',size:100}),/PNG/);await assert.rejects(ctx.encodeReminderImage({type:'image/png',name:'large.png',size:21*1024*1024}),/20 MB/);assert.equal(decodes,1);
  });
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
    vm.runInContext(renderer.slice(renderer.indexOf('$("#createBatchButton").addEventListener'), renderer.indexOf('let rendererEventRevision')), ctx);
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
    assert.equal(ctx.state.reminders[0].priority, ''); assert.equal(ctx.state.reminders[1].completedAt, '2026-11-10T00:00:00.000Z');
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
    vm.runInContext(popup.slice(popup.indexOf('$("#saveEdit").addEventListener'), popup.indexOf("window.addEventListener('resize'")), ctx);
    ctx.$('#editTitle').value = '原标题'; ctx.$('#editNote').value = '新备注';
    const first = handlers['#saveEdit:click'](); pending[0].reject(new Error('denied')); await first;
    assert.equal(ctx.$('#editNote').value, '新备注'); assert.equal(ctx.shown.length, 0); assert.equal(ctx.reminder.note, '原备注');
    const retry = handlers['#saveEdit:click'](); pending[1].resolve(); await retry;
    assert.equal(ctx.reminder.note, '新备注'); assert.deepEqual(ctx.shown, ['viewPanel']);
  });
  console.log(checks + ' save safety checks passed (simulated IPC/DOM, not desktop validation).');
})().catch(error => { console.error(error); process.exitCode = 1; });

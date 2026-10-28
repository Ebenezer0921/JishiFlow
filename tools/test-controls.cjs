const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname,'..');
const source = fs.readFileSync(path.join(root,'frontend/time-controls.js'),'utf8');
const time = require('../frontend/time-controls.js');
let checks = 0;
function check(name,fn) { fn(); checks++; console.log('PASS '+name); }
check('month end clamps to leap day',()=>assert.deepEqual(time.shift([2024,1,31,12,30],1,1),[2024,2,29,12,30]));
check('year clamps leap day',()=>assert.deepEqual(time.shift([2024,2,29,12,30],0,1),[2025,2,28,12,30]));
check('day wraps month',()=>assert.deepEqual(time.shift([2026,3,1,12,0],2,-1),[2026,2,28,12,0]));
check('minute wraps year',()=>assert.deepEqual(time.shift([2026,12,31,23,59],4,1),[2027,1,1,0,0]));
check('hours roll backward',()=>assert.deepEqual(time.shift([2026,1,1,0,30],3,-1),[2025,12,31,23,30]));
check('time-only preserves calendar',()=>assert.deepEqual(time.shift([2000,1,1,23,59],4,1,true),[2000,1,1,0,0]));
check('year lower bound',()=>assert.deepEqual(time.shift([1,1,1,12,0],0,-1),[1,1,1,12,0]));
check('tomorrow uses next calendar date at selected clock',()=>{
 const date=time.tomorrow(new Date(2026,11,31,23,59),'09:15');
 assert.deepEqual([date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes()],[2027,0,1,9,15]);
});
check('invalid clocks rejected',()=>{for(const value of ['24:00','09:60','9:00','','no'])assert(Number.isNaN(time.tomorrow(new Date(),value).getTime()));});
check('tomorrow handles DST as local calendar rather than 24h offset',()=>{
 const old=process.env.TZ; process.env.TZ='America/New_York';
 try { const now=new Date(2026,2,7,20); const date=time.tomorrow(now,'09:00'); assert.equal(date.getDate(),8); assert.equal(date.getHours(),9); assert.equal(date-now,12*3600000); }
 finally { if(old===undefined)delete process.env.TZ;else process.env.TZ=old; }
});
check('number wheel consumes both directions and limits without page scroll',()=>{
 let handler;const events=[];
 const input={value:'2',disabled:false,readOnly:false,focus(){},stepUp(){this.value=String(Math.min(3,+this.value+1));},stepDown(){this.value=String(Math.max(1,+this.value-1));},dispatchEvent(e){events.push(e.type);},addEventListener(name,fn,options){assert.equal(name,'wheel');assert.equal(options.passive,false);handler=fn;}};
 const document={querySelectorAll(selector){return selector.includes('number')?[input]:[];}};
 vm.runInNewContext(source,{document,Event:class{constructor(type){this.type=type;}}});
 for(const [delta,expected] of [[-120,'3'],[-120,'3'],[120,'2'],[120,'1'],[120,'1']]) {
  let blocked=0;handler({deltaY:delta,preventDefault(){blocked++},stopPropagation(){blocked++}});assert.equal(input.value,expected);assert.equal(blocked,2);
 }
 assert.deepEqual(events,['input','change','input','change','input','change']);
});
check('batch accepts optional priority while preserving date/time parse',()=>{
 const renderer=fs.readFileSync(path.join(root,'frontend/renderer.js'),'utf8');
 const start=renderer.indexOf('function batchError('), end=renderer.indexOf('function formatBatchDue(');
 const ctx={Date};vm.createContext(ctx);vm.runInContext(renderer.slice(start,end),ctx);
 for(const [label,value] of [['紧急','urgent'],['中等','medium'],['一般','normal']]) {
  const row=ctx.parseBatchLine('提交资料 ['+label+'] 2099-12-31 19:00',1);assert.equal(row.priority,value);assert.equal(row.title,'提交资料');assert.equal(row.status,'valid');
 }
 const row=ctx.parseBatchLine('取快递 明天 19:00',1);assert.equal(row.priority,'');assert.equal(row.title,'取快递');
 assert.equal(ctx.parseBatchLine('坏日期 2099-02-30 19:00',1).status,'error');
});
check('HTML keeps old control IDs and has no duplicate IDs',()=>{
 for(const page of ['index.html','popup.html']) {
  const html=fs.readFileSync(path.join(root,'frontend',page),'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  for(const asset of [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(m=>m[1]))assert(fs.existsSync(path.join(root,'frontend',asset)),asset);
 }
});
check('long content contributes hidden height while resize requests stay bounded and coalesced',()=>{
 const popup=fs.readFileSync(path.join(root,'frontend/popup.js'),'utf8');
 const geometry=popup.slice(popup.indexOf('let fitFrame'),popup.indexOf('function show('));
 const frames=[],requests=[],content={scrollHeight:500,clientHeight:60};
 const section={scrollHeight:180,getBoundingClientRect:()=>({height:180}),classList:{contains:()=>false},querySelector:()=>content};
 const card={children:[section]}; const ctx={window:{innerWidth:206,jishi:{resizePopup:h=>{requests.push(h);return Promise.resolve();}}},document:{querySelector:()=>card},getComputedStyle:el=>el===card?{paddingTop:'14',paddingBottom:'14',rowGap:'12'}:{marginTop:'0',marginBottom:'0'},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;}};
 vm.createContext(ctx);vm.runInContext(geometry,ctx);vm.runInContext('fitPopup();fitPopup()',ctx);assert.equal(frames.length,1);frames.shift()();assert.deepEqual(requests,[430]);vm.runInContext('fitPopup()',ctx);frames.shift()();assert.equal(requests.length,1);
});
(async()=>{
 const renderer=fs.readFileSync(path.join(root,'frontend/renderer.js'),'utf8');
 const chunk=renderer.slice(renderer.indexOf('function exportReminders('),renderer.indexOf('function render()'));
 const image='data:image/webp;base64,AAAA', payload={reminders:[{id:'existing',title:'不覆盖',dueAt:'2099-01-01T00:00:00Z'},{id:'new',title:'图片与紧急',dueAt:'2099-01-01T00:00:00Z',priority:'urgent',imageData:image},{id:'unknown',title:'未知等级',dueAt:'2099-01-01T00:00:00Z',priority:'other'},{id:'bad-date',title:'坏日期',dueAt:'invalid'}]};
 const blobs=[];const ctx={priorityNames:{urgent:'紧急',medium:'中等',normal:'一般'},state:{reminders:[{id:'existing',title:'原事项',dueAt:'2099-01-01T00:00:00Z'}],settings:{}},window:{confirm:()=>true},crypto:{randomUUID:()=> 'generated'},isSupportedImageData:value=>typeof value==='string'&&value.startsWith('data:image/webp;base64,'),persist:async()=>{},setTransferStatus:()=>{},Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:fixture';},revokeObjectURL(){}},document:{createElement:()=>({click(){}})},setTimeout(){},Date};
 vm.createContext(ctx);vm.runInContext(chunk,ctx);await ctx.importReminders({text:async()=>JSON.stringify(payload)});
 assert.equal(ctx.state.reminders.length,3);assert.equal(ctx.state.reminders[0].title,'原事项');assert.equal(ctx.state.reminders[1].priority,'urgent');assert.equal(ctx.state.reminders[1].imageData,image);assert.equal(ctx.state.reminders[2].priority,'');
 ctx.exportReminders();const exported=JSON.parse(await blobs[0].text());assert.equal(exported.reminders[1].priority,'urgent');assert.equal(exported.reminders[1].imageData,image);
 checks++;console.log('PASS import deduplicates without overwriting, export retains priority and image');
 console.log(checks+' control checks passed. Unit checks do not establish native UI/DPI correctness.');
})().catch(error=>{console.error(error);process.exitCode=1;});

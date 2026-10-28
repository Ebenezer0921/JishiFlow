(function (root) {
  'use strict';
  const pad = value => String(value).padStart(2, '0');
  function tomorrow(now, clock) {
    const match = /^(\d{2}):(\d{2})$/.exec(clock || '');
    if (!match || +match[1] > 23 || +match[2] > 59) return new Date(NaN);
    const next = new Date(now); next.setDate(next.getDate() + 1); next.setHours(+match[1], +match[2], 0, 0); return next;
  }
  function shift(parts, segment, step, timeOnly = false) {
    let [year, month, day, hour, minute] = parts;
    const date = new Date(2000, 0, 1); date.setFullYear(year, month - 1, day); date.setHours(hour, minute, 0, 0);
    if (segment === 0 || segment === 1) {
      date.setDate(1);
      if (segment === 0) date.setFullYear(Math.max(1, Math.min(9999, year + step)));
      else date.setMonth(date.getMonth() + step);
      const end = new Date(date); end.setMonth(end.getMonth() + 1); end.setDate(0);
      date.setDate(Math.min(day, end.getDate()));
    } else if (segment === 2) date.setDate(date.getDate() + step);
    else if (segment === 3) date.setHours(date.getHours() + step);
    else date.setMinutes(date.getMinutes() + step);
    if (date.getFullYear() < 1 || date.getFullYear() > 9999) return parts;
    return [timeOnly ? year : date.getFullYear(), timeOnly ? month : date.getMonth()+1, timeOnly ? day : date.getDate(), date.getHours(), date.getMinutes()];
  }
  const api = { tomorrow, shift }; root.JishiTime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  const document = root.document;
  function enhance(input) {
    const isTime = input.type === 'time';
    const wrapper = document.createElement('div'); wrapper.className = 'segmented-time';
    wrapper.setAttribute('role','group'); wrapper.setAttribute('aria-label', input.getAttribute('aria-label') || (isTime ? '时间' : '提醒日期和时间'));
    input.before(wrapper); wrapper.append(input); input.classList.add('native-time-backing'); input.tabIndex = -1; input.setAttribute('aria-hidden','true');
    const message = document.createElement('span'); message.className = 'time-error'; message.setAttribute('role','alert'); wrapper.after(message);
    const fields = []; const labels = ['年','月','日','小时','分钟'];
    const indexes = isTime ? [3,4] : [0,1,2,3,4];
    let syncing = false;
    function parts() {
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.value);
      if (!isTime && match) return match.slice(1).map(Number);
      if (isTime && /^\d{2}:\d{2}$/.test(input.value)) return [2000,1,1,...input.value.split(':').map(Number)];
      const now = new Date(); return [now.getFullYear(),now.getMonth()+1,now.getDate(),now.getHours(),now.getMinutes()];
    }
    function sync() {
      if(syncing) return;
      const values = parts();
      fields.forEach((field, i) => { field.value = input.value ? (indexes[i] === 0 ? String(values[0]).padStart(4,'0') : pad(values[indexes[i]])) : ''; field.disabled = input.disabled; field.required = input.required; });
    }
    function encode(values) { return isTime ? pad(values[3])+':'+pad(values[4]) : String(values[0]).padStart(4,'0')+'-'+pad(values[1])+'-'+pad(values[2])+'T'+pad(values[3])+':'+pad(values[4]); }
    function commit(values) {
      input.setCustomValidity('');
      const value = encode(values);
      const previous = input.value;
      syncing = true; input.value = value;
      if(!input.value || !input.validity.valid) { input.value = previous; syncing = false; sync(); wrapper.classList.add('has-error'); message.textContent='日期时间超出允许范围，请选择未来时间'; return false; }
      input.setCustomValidity(''); syncing = false; sync();
      wrapper.classList.remove('has-error'); message.textContent=''; fields.forEach(field=>field.removeAttribute('aria-invalid'));
      input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); return true;
    }
    function typed() {
      if(fields.some(field => !/^\d+$/.test(field.value))) { input.setCustomValidity('请填写完整日期和时间'); return false; }
      const values = parts(); fields.forEach((field,i) => values[indexes[i]] = Number(field.value));
      const [y,m,d,h,n] = values; const test = new Date(2000,0,1); test.setFullYear(y,m-1,d);
      if(y<1||y>9999||m<1||m>12||d<1||test.getMonth()!==m-1||test.getDate()!==d||h>23||n>59) { input.setCustomValidity('日期或时间无效'); return false; }
      input.setCustomValidity(''); return commit(values);
    }
    indexes.forEach((segment,i) => {
      if(i) { const separator = document.createElement('span'); separator.className='time-separator'; separator.textContent=segment === 3 ? ' ' : segment === 4 ? ':' : '-'; separator.setAttribute('aria-hidden','true'); wrapper.append(separator); }
      const field=document.createElement('input'); field.type='text'; field.inputMode='numeric'; field.className='time-segment'; field.maxLength=segment===0?4:2;
      field.setAttribute('aria-label',labels[segment]); field.setAttribute('title',labels[segment]+'：可滚轮或上下键调整'); field.size=segment===0?4:2;
      fields.push(field); wrapper.append(field);
      field.addEventListener('focus',()=>field.select());
      field.addEventListener('input',()=>{ input.setCustomValidity('请确认完整有效的日期和时间'); wrapper.classList.remove('has-error'); });
      field.addEventListener('change',()=>{ typed(); });
      function adjust(step) { input.setCustomValidity(''); commit(shift(parts(),segment,step,isTime)); field.focus({preventScroll:true}); field.select(); }
      field.addEventListener('wheel',event=>{ event.preventDefault(); event.stopPropagation(); if(!field.disabled && event.deltaY) adjust(event.deltaY<0?1:-1); },{passive:false});
      field.addEventListener('keydown',event=>{
        if(event.key==='ArrowUp'||event.key==='ArrowDown') { event.preventDefault(); adjust(event.key==='ArrowUp'?1:-1); }
        if(event.key==='Enter') typed();
        if(event.key==='ArrowLeft' && field.selectionStart===0 && i>0) { event.preventDefault(); fields[i-1].focus(); }
        if(event.key==='ArrowRight' && field.selectionEnd===field.value.length && i<fields.length-1) { event.preventDefault(); fields[i+1].focus(); }
      });
    });
    const picker=document.createElement('button'); picker.type='button'; picker.className='time-picker'; picker.textContent=isTime?'◷':'▦'; picker.setAttribute('aria-label',isTime?'打开系统时间选择器':'打开系统日期时间选择器');
    picker.addEventListener('click',()=>{ try { input.showPicker(); } catch (_) { fields[0].focus(); } }); wrapper.append(picker);
    const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    Object.defineProperty(input,'value',{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);this.setCustomValidity('');sync();}});
    input.addEventListener('input',()=>{ input.setCustomValidity(''); sync(); }); input.addEventListener('change',sync);
    input.addEventListener('invalid',event=>{ event.preventDefault(); wrapper.classList.add('has-error'); message.textContent=input.validationMessage || '请填写有效的日期和时间'; fields[0].focus(); fields[0].setAttribute('aria-invalid','true'); });
    new MutationObserver(sync).observe(input,{attributes:true,attributeFilter:['disabled','required']}); sync();
    input.addEventListener('focus',()=>fields[0].focus());
  }
  document.querySelectorAll('input[type="datetime-local"],input[type="time"]').forEach(enhance);
  document.querySelectorAll('input[type="number"]').forEach(input=>input.addEventListener('wheel',event=>{
    if(input.disabled||input.readOnly) return;
    event.preventDefault(); event.stopPropagation(); if(!event.deltaY) return;
    input.focus({preventScroll:true}); const previous=input.value;
    try { if(event.deltaY<0) input.stepUp(); else input.stepDown(); } catch (_) { return; }
    if(input.value!==previous) { input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); }
  },{passive:false}));
})(typeof window !== 'undefined' ? window : globalThis);

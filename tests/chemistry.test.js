import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {questions,DURATION,VARIANT} from '../src/chemistry/bank.js';
import * as engine from '../src/chemistry/engine.js';

test('FIPI structure and all perfect answers: 34 tasks, 36+20=56 points',()=>{
 assert.equal(questions.length,34);assert.equal(DURATION,210*60*1000);
 assert.deepEqual(questions.map(q=>q.id),Array.from({length:34},(_,i)=>i+1));
 assert.equal(questions.reduce((n,q)=>n+q.max,0),56);
 assert.equal(questions.filter(q=>q.kind!=='extended').reduce((n,q)=>n+engine.score(q,q.answer),0),36);
 assert.deepEqual(questions.slice(28).map(q=>q.max),[2,2,4,5,3,4]);
 assert.equal(questions[16].kind,'sequence');
});
test('set answers allow permutation, reject duplicates and extra digits',()=>{
 const q=questions[0];assert.equal(engine.score(q,' 5 1 '),1);assert.equal(engine.score(q,'11'),0);assert.equal(engine.score(q,'151'),0);assert.equal(engine.score(q,''),0);
});
test('two-point grading uses positional errors, never awards invalid lengths',()=>{
 const q=questions[6];assert.equal(engine.score(q,'3241'),2);assert.equal(engine.score(q,'3245'),1);assert.equal(engine.score(q,'3345'),0);assert.equal(engine.score(q,'324'),0);assert.equal(engine.score(q,'32411'),0);assert.equal(engine.score(q,'abcd'),0);
});
test('one-point ordered answers and numeric answers are strict and locale-friendly',()=>{
 assert.equal(engine.score(questions[1],'123'),0);
 for(const s of ['71,50','71.5',' 71.500 '])assert.equal(engine.score(questions[26],s),1);
 for(const s of ['71.49','71.5кДж','71+0.5','','Infinity','0x47'])assert.equal(engine.score(questions[26],s),0);
});
test('deadlines survive serialization; timeout is capped and finish is idempotent',()=>{
 const a=engine.createAttempt(1000);assert.equal(engine.remaining(a,2000),DURATION-1000);
 const b=engine.validateStore({schema:1,active:a,attempts:[]}).active;assert.equal(b.deadline,a.deadline);
 const done=engine.finish(b,b.deadline+50000);assert.equal(done.finishedAt,b.deadline);assert.equal(done.reason,'timeout');assert.strictEqual(engine.finish(done),done);
 assert.equal(engine.remaining(b,b.deadline+1),0);
});
test('provisional versus fully reviewed totals',()=>{
 const a=engine.createAttempt();for(const q of questions.filter(q=>q.answer))a.answers[q.id]=q.answer;
 assert.deepEqual(engine.totals(a),{auto:36,manual:0,total:36,pending:6,answered:28});
 for(const q of questions.slice(28))a.review[q.id]=q.criteria.map(()=>true);
 assert.equal(engine.totals(a).total,56);assert.equal(engine.totals(a).pending,0);
});
test('backup validation rejects corrupt scores, unknown versions and duplicate IDs',()=>{
 const a=engine.finish(engine.createAttempt());const valid={schema:1,active:null,attempts:[a]};assert.equal(engine.validateStore(valid).attempts.length,1);
 for(const mutate of [x=>x.schema=2,x=>x.attempts[0].variant='future',x=>x.attempts[0].answers[99]='a',x=>x.attempts[0].review[29]=[9,9],x=>x.attempts.push(x.attempts[0]),x=>x.attempts[0].deadline++]){const x=structuredClone(valid);mutate(x);assert.throws(()=>engine.validateStore(x));}
});
const source=readFileSync(new URL('../src/chemistry/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function harness(seed,{locked=false,failStorage=false}={}){
 const dom=new JSDOM('<div id="app"></div>',{url:'https://baseintellect.ru/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;let tick;let downloaded=null;
 if(seed)w.localStorage.setItem(engine.STORAGE_KEY,JSON.stringify(seed));
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.setInterval=fn=>{tick=fn;return 1;};w.setTimeout=()=>1;w.URL.createObjectURL=blob=>{downloaded=blob;return 'blob:backup';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
 Object.defineProperty(w.navigator,'locks',{value:{request:(name,opts,cb)=>{cb(locked?null:{});return Promise.resolve();}}});
 if(failStorage)w.Storage.prototype.setItem=()=>{throw new Error('quota');};
 Object.assign(w,{questions,DURATION,VARIANT,...engine});vm.runInContext(source,dom.getInternalVMContext());
 const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
 const input=(value)=>{const el=w.document.querySelector('#answer');el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 return {dom,w,click,input,tick:()=>tick(),read:()=>JSON.parse(w.localStorage.getItem(engine.STORAGE_KEY)),download:()=>downloaded};
}
test('exam journey: start, answer, flag, reload, submit, review and history',()=>{
 const h=harness();h.click('[data-action="start"]');assert.equal(h.w.document.querySelector('#timer').textContent,'03:30:00');
 h.input('51');h.click('[data-action="flag"]');const seed=h.read();assert.equal(seed.active.answers[1],'51');assert.deepEqual(seed.active.flags,[1]);
 const restored=harness(seed);restored.click('[data-action="start"]');assert.equal(restored.w.document.querySelector('#answer').value,'51');assert.equal(restored.read().active.deadline,seed.active.deadline);
 restored.click('[data-question="29"]');restored.input('2KMnO4 + 5Na2SO3 ...');restored.click('[data-action="finish"]');assert.equal(restored.w.document.querySelector('#dialog').open,true);restored.click('[data-action="close"]');assert.ok(restored.read().active);
 restored.click('[data-action="finish"]');restored.click('[data-action="confirm-finish"]');assert.equal(restored.read().active,null);assert.equal(restored.read().attempts.length,1);
 assert.equal(engine.totals(restored.read().attempts[0]).auto,1);
 restored.w.document.querySelector('[data-criterion="29"]').checked=true;restored.click('[data-review="29"]');assert.equal(engine.totals(restored.read().attempts[0]).manual,1);
 restored.click('[data-action="history"]');assert.match(restored.w.document.body.textContent,/История попыток/);assert.equal(restored.w.document.querySelectorAll('.history-item').length,1);
 restored.click('[data-action="export"]');assert.ok(restored.download());h.dom.window.close();restored.dom.window.close();
});
test('expired reloaded exam automatically submits once with preserved answers',()=>{
 const a=engine.createAttempt(Date.now()-DURATION-5000);a.answers[26]='9';const h=harness({schema:1,active:a,attempts:[]});h.tick();h.tick();const s=h.read();assert.equal(s.active,null);assert.equal(s.attempts.length,1);assert.equal(s.attempts[0].finishedAt,a.deadline);assert.equal(s.attempts[0].answers[26],'9');h.dom.window.close();
});
test('backup text is escaped in results and cannot create injected elements',()=>{
 const a=engine.finish(engine.createAttempt());a.answers[29]='<img src=x onerror="alert(1)">';const h=harness({schema:1,active:null,attempts:[a]});h.click('[data-action="history"]');h.click('[data-result]');assert.equal(h.w.document.querySelector('img[src="x"]'),null);assert.match(h.w.document.querySelector('#result-29 .response').textContent,/<img/);h.dom.window.close();
});
test('another tab receives read-only mode and cannot start an exam',()=>{
 const h=harness(undefined,{locked:true});assert.equal(h.w.document.querySelector('[data-action="start"]').disabled,true);h.click('[data-action="start"]');assert.equal(h.read(),null);h.dom.window.close();
});
test('storage failures show a visible error instead of claiming persistence',()=>{
 const h=harness(undefined,{failStorage:true});h.click('[data-action="start"]');assert.match(h.w.document.querySelector('#storage-notice').textContent,/не сохранил/);assert.equal(h.read(),null);h.dom.window.close();
});
test('reference opens a PDF without keys; calculator handles zero division',()=>{
 const h=harness();h.click('[data-action="start"]');h.click('[data-action="reference"]');assert.ok(h.w.document.querySelector('a[href="/chemistry-reference.pdf"]'));h.click('[data-action="close"]');h.click('[data-action="calculator"]');
 h.w.document.querySelector('#calc-a').value='5';h.w.document.querySelector('#calc-b').value='0';h.w.document.querySelector('#calc-op').value='÷';h.w.document.querySelector('#calc-b').dispatchEvent(new h.w.Event('input',{bubbles:true}));assert.match(h.w.document.querySelector('#calc-output').textContent,/ноль/);h.dom.window.close();
});
test('history import merges without duplicates and preserves local review',async()=>{
 const a=engine.finish(engine.createAttempt());a.review[29]=[true,false];const b=engine.finish(engine.createAttempt());
 const h=harness({schema:1,active:null,attempts:[a]});
 const backup={schema:1,active:null,attempts:[{...a,review:{}},b]};
 const load=h.w.eval('importHistory');await load({size:100,text:async()=>JSON.stringify(backup)});
 assert.equal(h.read().attempts.length,2);assert.deepEqual(h.read().attempts[0].review[29],[true,false]);
 await load({size:100,text:async()=>JSON.stringify(backup)});assert.equal(h.read().attempts.length,2);
 const previous=JSON.stringify(h.read());await load({size:100,text:async()=>'{"schema":99}'});assert.equal(JSON.stringify(h.read()),previous);h.dom.window.close();
});
test('importing an expired active attempt preserves the original deadline',async()=>{
 const a=engine.createAttempt(Date.now()-DURATION-10000);a.answers[27]='71,50';const h=harness();
 await h.w.eval('importHistory')({size:100,text:async()=>JSON.stringify({schema:1,active:a,attempts:[]})});
 assert.equal(h.read().active,null);assert.equal(h.read().attempts[0].finishedAt,a.deadline);assert.equal(engine.totals(h.read().attempts[0]).auto,1);h.dom.window.close();
});
test('input arriving after deadline is rejected and cannot change submitted answers',()=>{
 const a=engine.createAttempt();a.answers[1]='15';const h=harness({schema:1,active:a,attempts:[]});h.click('[data-action="start"]');
 h.w.eval('store.active.deadline = Date.now() - 1');h.input('11');assert.equal(h.read().attempts[0].answers[1],'15');assert.equal(h.read().active,null);h.dom.window.close();
});

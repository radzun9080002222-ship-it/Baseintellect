import { questions, VARIANT, DURATION } from './bank.js';
export const STORAGE_KEY = 'baseintellect.chemistry.sofia.v1';
export const emptyStore = () => ({schema:1, active:null, attempts:[]});
export function normalize(value) { return String(value ?? '').trim().replace(/\s/g,'').replace(/,/g,'.'); }
export function score(question, value) {
  const answer = normalize(value);
  if (!answer || question.kind === 'extended') return 0;
  if (question.kind === 'number') return /^\d+(\.\d+)?$/.test(answer) && Number(answer) === Number(question.answer) ? question.max : 0;
  if (!/^\d+$/.test(answer)) return 0;
  const expected = question.answer;
  if (answer.length !== expected.length) return 0;
  if (question.kind === 'set') return [...answer].sort().join('') === [...expected].sort().join('') ? question.max : 0;
  const errors = [...expected].filter((digit,i) => digit !== answer[i]).length;
  return errors === 0 ? question.max : question.max === 2 && errors === 1 ? 1 : 0;
}
export function createAttempt(now = Date.now()) {
  return {id:crypto.randomUUID(),variant:VARIANT,name:'Фомина София',startedAt:now,deadline:now+DURATION,finishedAt:null,reason:null,answers:{},flags:[],current:1,review:{}};
}
export function finish(attempt, now = Date.now()) {
  if (attempt.finishedAt !== null) return attempt;
  return {...attempt,finishedAt:Math.min(now,attempt.deadline),reason:now>=attempt.deadline?'timeout':'submitted'};
}
export function remaining(attempt, now = Date.now()) { return Math.max(0, attempt.deadline - now); }
export function totals(attempt) {
  const auto = questions.filter(q=>q.kind!=='extended').reduce((sum,q)=>sum+score(q,attempt.answers[q.id]),0);
  const reviewed = questions.filter(q=>q.kind==='extended' && Array.isArray(attempt.review[q.id]));
  const manual = reviewed.reduce((sum,q)=>sum+attempt.review[q.id].filter(Boolean).length,0);
  return {auto,manual,total:auto+manual,pending:6-reviewed.length,answered:questions.filter(q=>(attempt.answers[q.id]??'').trim()).length};
}
// Validate backup contents before touching storage. No HTML from a backup is trusted.
export function validateStore(raw) {
  if (!raw || raw.schema!==1 || !Array.isArray(raw.attempts) || raw.attempts.length>500) throw new Error('Неизвестный формат истории.');
  function attempt(a,active) {
    if (!a || typeof a.id!=='string' || a.id.length>100 || a.variant!==VARIANT || a.name!=='Фомина София' || !Number.isFinite(a.startedAt) || a.startedAt<0 || a.deadline!==a.startedAt+DURATION || !Number.isInteger(a.current) || a.current<1 || a.current>34) throw new Error('Некорректные данные попытки.');
    if (active ? a.finishedAt!==null : !Number.isFinite(a.finishedAt) || a.finishedAt<a.startedAt || a.finishedAt>a.deadline) throw new Error('Некорректное время попытки.');
    if (!a.answers || typeof a.answers!=='object' || !a.review || typeof a.review!=='object' || !Array.isArray(a.flags)) throw new Error('Некорректные ответы.');
    for (const [key,value] of Object.entries(a.answers)) if (!/^(?:[1-9]|[12]\d|3[0-4])$/.test(key) || typeof value!=='string' || value.length>20000) throw new Error('Некорректный ответ в файле.');
    if (a.flags.some(n=>!Number.isInteger(n)||n<1||n>34)) throw new Error('Некорректные отметки.');
    for (const [key,value] of Object.entries(a.review)) {
      const question=questions.find(q=>q.id===Number(key)&&q.kind==='extended');
      if (!question || !Array.isArray(value) || value.length!==question.max || value.some(v=>typeof v!=='boolean')) throw new Error('Некорректные критерии.');
    }
    if (active && Object.keys(a.review).length) throw new Error('Проверка незавершённой попытки недопустима.');
    return {id:a.id,variant:a.variant,name:a.name,startedAt:a.startedAt,deadline:a.deadline,finishedAt:a.finishedAt,reason:active?null:(a.reason==='timeout'?'timeout':'submitted'),answers:{...a.answers},flags:[...new Set(a.flags)],current:a.current,review:{...a.review}};
  }
  const attempts=raw.attempts.map(a=>attempt(a,false));
  if (new Set(attempts.map(a=>a.id)).size!==attempts.length) throw new Error('Повторяющиеся попытки в файле.');
  const active=raw.active?attempt(raw.active,true):null;
  if (active && attempts.some(a=>a.id===active.id)) throw new Error('Попытка уже завершена.');
  return {schema:1,active,attempts};
}

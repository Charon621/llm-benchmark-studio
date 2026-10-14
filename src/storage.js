import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = path.resolve(process.env.STUDIO_DATA_DIR || path.join(ROOT, 'data'));
export const RUNS = path.join(DATA, 'runs');
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const newId = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
export function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export function runDir(id) {
  if (!/^run-[a-zA-Z0-9-]+$/.test(id)) throw new Error('无效实验 ID');
  return path.join(RUNS, id);
}
function libraryFile(owner){return owner?path.join(DATA,'sessions',owner,'library.json'):path.join(DATA,'library.json');}
export function primaryOwner(){return read(path.join(DATA,'local-owner.json'),{})?.owner_hash;}
export function ensurePrimaryOwner(owner){fs.mkdirSync(DATA,{recursive:true});try{fs.writeFileSync(path.join(DATA,'local-owner.json'),JSON.stringify({owner_hash:owner,created_at:new Date().toISOString()}),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}}
export function library(owner=null) { return read(libraryFile(owner),owner?(owner===primaryOwner()?library():read(path.join(DATA,'library-templates.json'),{prompts:[],datasets:[]})):{ prompts: [], datasets: [] }); }
export function saveLibrary(value,owner=null) { atomic(libraryFile(owner), value); }
export function listRuns() {
  fs.mkdirSync(RUNS, { recursive: true });
  return fs.readdirSync(RUNS).filter(x => x.startsWith('run-')).map(id => read(path.join(RUNS,id,'state.json'))).filter(Boolean).sort((a,b)=>b.created_at.localeCompare(a.created_at));
}
export function legacyStatus(owner){const count=listRuns().filter(r=>!r.owner_hash).length;return {available:owner===primaryOwner()&&count>0,unowned_runs:owner===primaryOwner()?count:0};}
export function importLegacy(owner,confirmed){if(owner!==primaryOwner())throw Object.assign(new Error('仅首次建立的本机会话可迁移旧记录'),{status:404});if(confirmed!==true)throw new Error('迁移需明确确认旧单用户记录归属当前会话');let imported=0;for(const state of listRuns().filter(r=>!r.owner_hash)){atomic(path.join(runDir(state.id),'state.json'),{...state,owner_hash:owner,legacy_imported_at:new Date().toISOString()});imported++;}return {ok:true,imported};}

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
export function library() { return read(path.join(DATA, 'library.json'), { prompts: [], datasets: [] }); }
export function saveLibrary(value) { atomic(path.join(DATA, 'library.json'), value); }
export function listRuns() {
  fs.mkdirSync(RUNS, { recursive: true });
  return fs.readdirSync(RUNS).filter(x => x.startsWith('run-')).map(id => read(path.join(RUNS,id,'state.json'))).filter(Boolean).sort((a,b)=>b.created_at.localeCompare(a.created_at));
}

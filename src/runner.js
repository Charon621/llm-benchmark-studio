import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { ROOT, RUNS, atomic, read, runDir, newId, listRuns, library, hash } from './storage.js';
import { freezeConfig, promptfooConfig } from './config.js';
export const active=new Map();
export function recover() {
  for (const state of listRuns()) if (['running','queued'].includes(state.status)) atomic(path.join(runDir(state.id),'state.json'),{...state,status:'interrupted',finished_at:new Date().toISOString(),error:'服务重启后检测到中断；已保留冻结配置与已完成单元，请点击复跑创建新实验。'});
}
export function launch(input, frozen=null) {
  if (active.size>=1) throw new Error('已有实验运行中，请等待或取消（避免争用预算与数据库）');
  const id=newId('run'),dir=runDir(id);
  const snapshot=frozen?{...structuredClone(frozen),id,created_at:new Date().toISOString(),replay_of:frozen.id}:freezeConfig(input,library(),id);
  // 复跑也重新检查实时授权与密钥，但保留原配置内容。
  if (frozen?.execution_mode==='live' && (process.env.STUDIO_ENABLE_LIVE!=='1'||!input.confirm_live)) throw new Error('实时复跑需要 STUDIO_ENABLE_LIVE=1 和明确确认');
  const config=promptfooConfig(snapshot,dir);
  fs.mkdirSync(dir,{recursive:true});
  atomic(path.join(dir,'snapshot.json'),snapshot);
  atomic(path.join(dir,'promptfooconfig.json'),config);
  atomic(path.join(dir,'rows.json'),[]);
  const state={id,name:snapshot.name,created_at:snapshot.created_at,status:'running',execution_mode:snapshot.execution_mode,total:snapshot.total_cells,completed:0,dataset_hash:snapshot.dataset_hash,snapshot_hash:hash(snapshot)};
  atomic(path.join(dir,'state.json'),state);
  const log=fs.openSync(path.join(dir,'engine.log'),'a');
  const worker=fork(path.join(ROOT,'src','worker.js'),[dir],{cwd:ROOT,env:{...process.env,PROMPTFOO_DISABLE_TELEMETRY:'1',PROMPTFOO_DISABLE_UPDATE:'1',PROMPTFOO_DISABLE_SHARING:'1',PROMPTFOO_CONFIG_DIR:path.join(dir,'.promptfoo'),NODE_USE_ENV_PROXY:'1',NO_PROXY:[process.env.NO_PROXY,'localhost','127.0.0.1'].filter(Boolean).join(',')},stdio:['ignore',log,log,'ipc']});
  const entry={worker,state,timer:null};active.set(id,entry);
  const finish=(status,error)=>{
    if (!active.has(id)) return;
    clearTimeout(entry.timer);active.delete(id);
    entry.state={...entry.state,status,error:error||null,finished_at:new Date().toISOString()};
    atomic(path.join(dir,'state.json'),entry.state);
  };
  worker.on('message',msg=>{
    if (msg.type==='progress') {entry.state.completed=msg.completed;atomic(path.join(dir,'state.json'),entry.state);}
    if (msg.type==='complete') {entry.state.completed=msg.completed;entry.state.engine_id=msg.engine_id;finish('complete');}
    if (msg.type==='failed') finish('failed',msg.error);
  });
  worker.on('exit',(code,signal)=>{fs.closeSync(log);if(active.has(id))finish(code===0?'complete':'failed',`评测进程退出：${code??signal}`);});
  worker.on('error',e=>finish('failed',e.message));
  entry.timer=setTimeout(()=>{worker.kill();finish('timeout','实验超过总时间上限；已完成单元保留，可导出并复跑。');},snapshot.settings.max_duration_ms+15000);
  return state;
}
export function cancel(id) {
  const entry=active.get(id);if (!entry) throw new Error('实验当前未运行');
  clearTimeout(entry.timer);active.delete(id);entry.worker.kill();
  entry.state={...entry.state,status:'cancelled',finished_at:new Date().toISOString(),error:'用户取消；已保存完成的评测单元。复跑会创建新的实验，不覆盖此记录。'};
  atomic(path.join(runDir(id),'state.json'),entry.state);
  return entry.state;
}
export function detail(id) {
  const dir=runDir(id),state=read(path.join(dir,'state.json'));
  if (!state) throw new Error('实验不存在');
  let ledger=null,ledger_warning=null;
  try{ledger=read(path.join(dir,'ledger.json'),null);}catch{ledger_warning='调用审计文件损坏；冻结配置与已完成结果仍可查看/导出。';}
  return {state,snapshot:read(path.join(dir,'snapshot.json')),rows:read(path.join(dir,'rows.json'),[]),ledger,ledger_warning};
}

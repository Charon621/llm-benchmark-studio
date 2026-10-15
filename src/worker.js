process.env.PROMPTFOO_DISABLE_TELEMETRY='1';
process.env.PROMPTFOO_DISABLE_UPDATE='1';
process.env.PROMPTFOO_DISABLE_SHARING='1';
process.env.PROMPTFOO_CACHE_ENABLED='false';
// 父服务被关闭时停止外部请求，防止孤儿进程在恢复后继续写旧实验。
let executionFinished=false;
process.on('disconnect',()=>{if(!executionFinished)process.exit(2);});
import fs from 'node:fs';
import path from 'node:path';
import { atomic, read } from './storage.js';
import { normalize, dispatchAnalyze, csv, markdown } from './analysis.js';
import {installWorkerCredentials} from './credentials.js';

const dir=process.argv[2];
try {
  const supplied=await new Promise(resolve=>process.once('message',msg=>resolve(msg.type==='credentials'?msg.credentials:[])));
  installWorkerCredentials(supplied);
  const { evaluate }=await import('promptfoo');
  const config=read(path.join(dir,'promptfooconfig.json'));
  const snapshot=read(path.join(dir,'snapshot.json'));
  const rows=[];
  const record=await evaluate(config,{cache:false,sharing:false,writeLatestResults:false,maxConcurrency:config.evaluateOptions.maxConcurrency,onTestComplete:result=>{
    const row=normalize(result,rows.length);
    rows.push(row);
    atomic(path.join(dir,'rows.json'),rows);
    process.send?.({type:'progress',row,completed:rows.length});
  }});
  const raw=await record.toEvaluateSummary();
  // 当前 SDK 的 onTestComplete 存在时逐条落盘；无回调结果时使用最终原始结果。
  if (!rows.length && raw.results?.length) rows.push(...raw.results.map(normalize));
  atomic(path.join(dir,'raw-results.json'),raw);
  atomic(path.join(dir,'rows.json'),rows);
  const result=dispatchAnalyze(rows,snapshot);
  atomic(path.join(dir,'report.json'),{snapshot,analysis:result,rows:result.rows||rows});
  fs.writeFileSync(path.join(dir,'results.csv'),csv(rows,snapshot),'utf8');
  fs.writeFileSync(path.join(dir,'report.md'),markdown(snapshot,rows,result,read(path.join(dir,'ledger.json'))),'utf8');
  executionFinished=true;
  process.send?.({type:'complete',completed:rows.length,engine_id:record.id},()=>process.disconnect?.());
} catch(error) {
  executionFinished=true;
  process.send?.({type:'failed',error:'Promptfoo 执行失败；冻结配置与已完成结果已保留。请核对配置和模型能力。'},()=>process.disconnect?.());
  process.exitCode=1;
}
import './test-network-guard.js';

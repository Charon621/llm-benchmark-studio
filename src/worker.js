process.env.PROMPTFOO_DISABLE_TELEMETRY='1';
process.env.PROMPTFOO_DISABLE_UPDATE='1';
process.env.PROMPTFOO_DISABLE_SHARING='1';
process.env.PROMPTFOO_CACHE_ENABLED='false';
import fs from 'node:fs';
import path from 'node:path';
import { atomic, read } from './storage.js';
import { normalize, analyze, csv, markdown } from './analysis.js';

const dir=process.argv[2];
try {
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
  const result=analyze(rows,{quality:50,speed:20,cost:0,stability:30},snapshot.settings.repeats);
  atomic(path.join(dir,'report.json'),{snapshot,analysis:result,rows});
  fs.writeFileSync(path.join(dir,'results.csv'),csv(rows),'utf8');
  fs.writeFileSync(path.join(dir,'report.md'),markdown(snapshot,rows,result),'utf8');
  process.send?.({type:'complete',completed:rows.length,engine_id:record.id});
} catch(error) {
  process.send?.({type:'failed',error:error.stack||error.message});
  process.exitCode=1;
}

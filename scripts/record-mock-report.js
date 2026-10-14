import fs from 'node:fs';
import path from 'node:path';
const reportDir=path.resolve(process.argv[2]||'reports/mock-2026-10-14');
process.env.STUDIO_DATA_DIR=path.join(reportDir,'runtime');
const {seed}=await import('../src/seeds.js');
const {launch,active,detail}=await import('../src/runner.js');
const {runDir}=await import('../src/storage.js');
seed();
const state=launch({name:'已运行的Mock流水线验收（非真实模型实验）',dataset_id:'research-12',prompt_ids:['direct','structured','verify'],model_ids:['mock-kimi','mock-qwen'],repeats:2});
while(active.has(state.id))await new Promise(r=>setTimeout(r,150));
const d=detail(state.id);
if(d.state.status!=='complete'||d.rows.length!==144)throw new Error(JSON.stringify(d.state));
fs.mkdirSync(reportDir,{recursive:true});
for(const name of ['snapshot.json','promptfooconfig.json','state.json','rows.json','raw-results.json','ledger.json','report.json','report.md','results.csv']){
  const file=path.join(runDir(state.id),name);if(fs.existsSync(file))fs.copyFileSync(file,path.join(reportDir,name));
}
console.log(JSON.stringify({id:state.id,completed:d.rows.length,passed:d.rows.filter(x=>x.success).length,transport_errors:d.rows.filter(x=>x.error).length,reportDir},null,2));

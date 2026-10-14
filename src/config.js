import path from 'node:path';
import fs from 'node:fs';
import { ROOT, hash } from './storage.js';
import { models } from './models.js';

function number(value, fallback, min, max) {
  const result=value==null||value===''?fallback:Number(value);
  if (!Number.isFinite(result)||result<min||result>max) throw new Error(`数值须在 ${min}–${max} 之间`);
  return result;
}
export function freezeConfig(input, lib, runId) {
  const dataset=lib.datasets.find(d=>d.id===input.dataset_id);
  if (!dataset) throw new Error('请选择存在的数据集');
  let selected=(input.prompt_ids||['direct','structured','verify']).map(id=>lib.prompts.find(p=>p.id===id));
  if (!selected.length||selected.length>10||selected.some(p=>!p)) throw new Error('请选择 1–10 个有效提示词');
  const available=models();
  let providers=(input.model_ids||['mock-kimi','mock-qwen']).map(id=>available.find(m=>m.id===id));
  if (!providers.length||providers.length>6||providers.some(m=>!m)) throw new Error('请选择有效模型');
  const overrides=input.model_overrides||{};
  providers=providers.map(m=>{
    const o=overrides[m.id]||{};
    const obj={...m};
    if (m.kind==='chat') {
      if (o.model) obj.model=String(o.model).slice(0,120);
      if (o.base_url) { const u=new URL(o.base_url);if (!['https:','http:'].includes(u.protocol)||u.username||u.password) throw new Error('base_url 须为无凭据 HTTP(S) URL');obj.base_url=u.href.replace(/\/$/,''); }
      for (const key of ['input_price_per_million','output_price_per_million']) obj[key]=o[key]==null||o[key]===''?null:number(o[key],null,0,10000);
    }
    delete obj.ready;
    return obj;
  });
  const execution=providers.some(m=>m.kind==='chat')||input.agent_execution_mode==='live'?'live':'mock';
  if (execution==='live') {
    if (process.env.STUDIO_ENABLE_LIVE!=='1') throw new Error('实时调用未启用：请在本机明确设置 STUDIO_ENABLE_LIVE=1；Mock 可直接运行');
    if (!input.confirm_live) throw new Error('请明确确认本次实时调用及可能产生的费用');
    for (const p of providers.filter(m=>m.kind==='chat')) if (!process.env[p.key_env]) throw new Error(`缺少环境变量 ${p.key_env}`);
  }
  const repeats=Math.floor(number(input.repeats,2,1,10));
  const settings={repeats,temperature:number(input.temperature,0,0,2),max_tokens:Math.floor(number(input.max_tokens,600,64,4096)),timeout_ms:Math.floor(number(input.timeout_ms,30000,1000,180000)),max_duration_ms:Math.floor(number(input.max_duration_ms,300000,5000,1800000)),max_calls:Math.floor(number(input.max_calls,1000,1,5000)),retries:Math.floor(number(input.retries,1,0,2)),max_concurrency:Math.floor(number(input.max_concurrency,2,1,4)),cost_budget_usd:input.cost_budget_usd==null||input.cost_budget_usd===''?null:number(input.cost_budget_usd,null,0.0001,100),agent_execution_mode:input.agent_execution_mode==='live'?'live':'mock',agent_max_calls:Math.floor(number(input.agent_max_calls,8,1,30)),agent_provider:input.agent_provider==='kimi'?'kimi':'qwen'};
  if (settings.cost_budget_usd!=null && providers.some(m=>m.kind!=='mock'&&(m.kind==='agentlab'||m.input_price_per_million==null||m.output_price_per_million==null))) throw new Error('设定美元上限时必须为全部实时模型提供价格；AgentLab 成本由其内部管理，请用调用预算');
  const total=providers.length*selected.length*dataset.cases.length*repeats;
  if (total>1500) throw new Error('单场最多 1500 个评测单元');
  let judge=null;
  if (input.judge_enabled) {
    if (execution!=='live') throw new Error('Judge 仅在明确启用实时实验时开放，Mock 不调用评审模型');
    if (!process.env.QWEN_API_KEY) throw new Error('Judge 需要 QWEN_API_KEY');
    const qwen=providers.find(m=>m.id==='live-qwen')||available.find(m=>m.id==='live-qwen');
    const price=k=>overrides['judge-qwen']?.[k]==null||overrides['judge-qwen']?.[k]===''?null:number(overrides['judge-qwen'][k],null,0,10000);
    judge={model:{...qwen,id:'judge-qwen',model:String(input.judge_model||process.env.JUDGE_MODEL||'qwen-plus'),input_price_per_million:price('input_price_per_million'),output_price_per_million:price('output_price_per_million')},rubric:'依据人工参考答案核验事实与完整性。不要因格式或篇幅偏好改变评分；答案与参考冲突则不通过。请指出具体依据。参考答案：{{reference}}',warning:'LLM Judge 有偏差，分数不是客观事实准确率，须抽样人工复核。'};
    delete judge.model.ready;
    if(settings.cost_budget_usd!=null&&(judge.model.input_price_per_million==null||judge.model.output_price_per_million==null)) throw new Error('美元预算要求同时设置 Judge 输入与输出价格');
  }
  return {schema_version:'1.0',id:runId,name:String(input.name||'模型与提示词对照').slice(0,120),created_at:new Date().toISOString(),execution_mode:execution,promptfoo_version:'0.124.1',settings,models:providers,prompts:structuredClone(selected),dataset:structuredClone(dataset),dataset_hash:hash(dataset.cases),prompt_hash:hash(selected.map(p=>({id:p.id,version:p.version,content:p.content}))),total_cells:total,judge,source_hashes:Object.fromEntries(['provider.js','reference-assertion.js','config.js','analysis.js','worker.js','datasets.js','runner.js'].map(f=>[f,hash(fs.readFileSync(path.join(ROOT,'src',f),'utf8'))]))};
}
export function promptfooConfig(snapshot, dir) {
  const settings=snapshot.settings;
  return {
    description:`${snapshot.name} [${snapshot.execution_mode.toUpperCase()}]`,
    sharing:false,
    basePath:ROOT,
    prompts:snapshot.prompts.map(p=>({label:`${p.id}@v${p.version}`,raw:p.content})),
    providers:snapshot.models.map(model=>({id:'file://./src/provider.js',label:model.id,config:{...settings,model,run_id:snapshot.id,ledger_file:path.join(dir,'ledger.json'),deadline_at:Date.now()+settings.max_duration_ms}})),
    tests:snapshot.dataset.cases.flatMap(c=>Array.from({length:settings.repeats},(_,repeat_index)=>({description:`${c.id} / repeat ${repeat_index+1}`,vars:{question:c.question,reference:c.reference,fact_terms_json:JSON.stringify(c.facts),case_id:c.id,difficulty:c.difficulty,repeat_index},metadata:{case_id:c.id,difficulty:c.difficulty,repeat_index},assert:[{type:'javascript',value:'file://./src/reference-assertion.js',metric:'reference_terms'},...(c.expect_json?[{type:'is-json',value:{type:'object',required:Object.keys(JSON.parse(c.reference)),properties:Object.fromEntries(Object.keys(JSON.parse(c.reference)).map(k=>[k,{type:'string'}])),additionalProperties:false},metric:'json_compliance'}]:[]),...c.assertions,...(snapshot.judge?[{type:'llm-rubric',value:snapshot.judge.rubric,metric:'judge_quality',provider:{id:'file://./src/provider.js',label:'judge-qwen',config:{...settings,temperature:0,max_tokens:350,model:snapshot.judge.model,run_id:snapshot.id,ledger_file:path.join(dir,'ledger.json'),deadline_at:Date.now()+settings.max_duration_ms}}}]:[])]}))),
    evaluateOptions:{maxConcurrency:settings.max_concurrency,cache:false,timeoutMs:settings.timeout_ms*(settings.retries+1)+5000,maxEvalTimeMs:settings.max_duration_ms,showProgressBar:false},
    metadata:{studio_run_id:snapshot.id,execution_mode:snapshot.execution_mode,dataset_sha256:snapshot.dataset_hash,prompt_sha256:snapshot.prompt_hash,warning:'Mock 是参考答案夹具演示；事实词覆盖不能代表完整语义正确性。'}
  };
}

import path from 'node:path';
import fs from 'node:fs';
import { ROOT, hash,primaryOwner } from './storage.js';
import { models } from './models.js';
import {endpoint} from './transport.js';
import {getCredential} from './credentials.js';
import { readAssetBytes, getAssetMeta, assertAssetsExist } from './assets.js';
import { canScoreAccuracy } from './vision-schema.js';
import { defaultLabelLexicon, visionPromptTemplate } from './vision-metrics.js';
import {validateSearchSnapshot} from './search-replay.js';

function number(value, fallback, min, max) {
  const result=value==null||value===''?fallback:Number(value);
  if (!Number.isFinite(result)||result<min||result>max) throw new Error(`数值须在 ${min}–${max} 之间`);
  return result;
}
export function freezeConfig(input, lib, runId, owner=null) {
  const dataset=lib.datasets.find(d=>d.id===input.dataset_id);
  if (!dataset) throw new Error('请选择存在的数据集');
  const task_type=input.task_type||dataset.task_type||'text';
  if (!['text','vision','agent'].includes(task_type)) throw new Error('任务模式无效');
  if (task_type==='vision' && dataset.task_type!=='vision') throw new Error('视觉实验需要视觉数据集');
  if(task_type!=='vision'&&dataset.task_type==='vision')throw new Error('视觉数据集不能用于文本或 Agent 模式');

  let selected=(input.prompt_ids||['direct','structured','verify']).map(id=>lib.prompts.find(p=>p.id===id));
  if (!selected.length||selected.length>10||selected.some(p=>!p)) throw new Error('请选择 1–10 个有效提示词');
  if(task_type==='vision'&&selected.some(p=>p.task_type==='vision'&&p.task_template&&(p.task_template==='differential')!==dataset.cases.some(c=>c.task_template==='differential')))throw new Error('候选鉴别诊断策略和形态策略不可混用');
  const available=models(owner);
  let providers=(input.model_ids||['mock-kimi','mock-qwen']).map(id=>available.find(m=>m.id===id));
  if (!providers.length||providers.length>20||providers.some(m=>!m)||new Set(input.model_ids||[]).size!==(input.model_ids||[]).length) throw new Error('请选择 1–20 个有效且不重复的模型');
  if(task_type==='vision'&&providers.some(m=>dataset.cases.some(c=>(c.images||[]).length>(m.max_images??5))))throw new Error('案例图片数量超过模型配置上限');
  if (task_type==='vision') {
    const noVision=providers.filter(m=>!m.capabilities?.vision);
    if (noVision.length) throw new Error(`以下模型不支持图片输入：${noVision.map(m=>m.id).join('、')}；请更换或仅用文本模式`);
  }
  const overrides=input.model_overrides||{};
  providers=providers.map(m=>{
    const o=overrides[m.id]||{};
    const obj={...m};
    if (m.kind==='chat'&&m.key_env) {
      if (o.model) obj.model=String(o.model).slice(0,120);
      if (o.base_url) obj.base_url=endpoint(o.base_url);
      for (const key of ['input_price_per_million','output_price_per_million']) obj[key]=o[key]==null||o[key]===''?null:number(o[key],null,0,10000);
    }
    delete obj.ready;
    delete obj.has_key;delete obj.key_masked;delete obj.connection_status;
    return obj;
  });
  const execution=providers.some(m=>m.kind==='chat'||m.kind==='agentlab'&&m.model_config_id)||input.agent_execution_mode==='live'?'live':'mock';
  if (providers.some(m=>m.key_env)&&owner!==primaryOwner()) throw new Error('环境凭证仅允许本机原会话使用');
  if (execution==='live') {
    if ((providers.some(m=>m.key_env)||providers.some(m=>m.kind==='agentlab'&&!m.model_config_id)&&input.agent_execution_mode==='live')&&process.env.STUDIO_ENABLE_LIVE!=='1') throw new Error('环境变量实时调用未启用：请设置 STUDIO_ENABLE_LIVE=1；网页保存模型可在当次授权后运行');
    if (input.confirm_live !== true) throw new Error('请明确确认本次实时调用及可能产生的费用');
    if (task_type==='vision' && input.confirm_vision_upload !== true) throw new Error('视觉实验会将所选图片发送给模型供应商，请明确确认图片出站授权');
    for (const p of providers.filter(m=>m.kind==='chat'||m.model_config_id)) if (!(p.key_env?process.env[p.key_env]:getCredential(p.credential_id,owner))) throw new Error('所选模型的凭证不可用，请在模型配置页重新填写或重新导入授权');
  }
  const repeats=Math.floor(number(input.repeats,2,1,10));
  const settings={repeats,temperature:number(input.temperature,0,0,2),max_tokens:Math.floor(number(input.max_tokens,600,64,4096)),timeout_ms:Math.floor(number(input.timeout_ms,30000,1000,180000)),max_duration_ms:Math.floor(number(input.max_duration_ms,300000,5000,1800000)),max_calls:Math.floor(number(input.max_calls,1000,1,5000)),retries:Math.floor(number(input.retries,1,0,2)),max_concurrency:Math.floor(number(input.max_concurrency,2,1,4)),cost_budget_usd:input.cost_budget_usd==null||input.cost_budget_usd===''?null:number(input.cost_budget_usd,null,0.0001,100),agent_execution_mode:input.agent_execution_mode==='live'?'live':'mock',agent_max_calls:Math.floor(number(input.agent_max_calls,8,1,30)),agent_provider:input.agent_provider==='kimi'?'kimi':'qwen',task_type};
  if(providers.some(m=>m.kind==='agentlab')&&settings.timeout_ms<5000)throw new Error('AgentLab 联动单请求超时须至少 5000 ms（与 AgentLab 请求契约一致）');
  if(input.search_snapshot){settings.search_snapshot=validateSearchSnapshot(input.search_snapshot);settings.retrieval_snapshot_sha256=settings.search_snapshot.sha256;}
  if(providers.some(m=>m.protocol==='anthropic')&&settings.temperature>1)throw new Error('Anthropic 实验温度须在 0–1 之间');
  if (settings.cost_budget_usd!=null && providers.some(m=>m.kind!=='mock'&&(m.kind==='agentlab'||m.input_price_per_million==null||m.output_price_per_million==null))) throw new Error('设定美元上限时必须为全部实时模型提供价格；AgentLab 成本由其内部管理，请用调用预算');
  if (settings.cost_budget_usd!=null && task_type==='vision') throw new Error('视觉实验的图片 Token 成本无法可靠预估，暂不支持美元硬预算；请使用调用预算');
  providers=providers.map(m=>m.kind==='chat'?{...m,temperature:m.temperature??settings.temperature,max_tokens:m.max_tokens??settings.max_tokens}:m);
  settings.effective_model_parameters=Object.fromEntries(providers.map(m=>[m.id,{temperature:m.temperature??settings.temperature,max_tokens:m.max_tokens??settings.max_tokens,send_temperature:m.send_temperature!==false,max_tokens_parameter:m.max_tokens_parameter||'max_tokens'}]));
  const total=providers.length*selected.length*dataset.cases.length*repeats;
  if (total>1500) throw new Error(`单场最多 1500 个评测单元；当前 ${total}，请拆分实验`);
  let judge=null;
  if (input.judge_enabled) {
    if(owner!==primaryOwner())throw new Error('环境 Judge 仅允许本机原会话使用');
    if (execution!=='live') throw new Error('Judge 仅在明确启用实时实验时开放，Mock 不调用评审模型');
    if (!process.env.QWEN_API_KEY) throw new Error('Judge 需要 QWEN_API_KEY');
    const qwen=providers.find(m=>m.id==='live-qwen')||available.find(m=>m.id==='live-qwen');
    const price=k=>overrides['judge-qwen']?.[k]==null||overrides['judge-qwen']?.[k]===''?null:number(overrides['judge-qwen'][k],null,0,10000);
    judge={model:{...qwen,id:'judge-qwen',model:String(input.judge_model||process.env.JUDGE_MODEL||'qwen-plus'),input_price_per_million:price('input_price_per_million'),output_price_per_million:price('output_price_per_million')},rubric:'依据人工参考答案核验事实与完整性。不要因格式或篇幅偏好改变评分；答案与参考冲突则不通过。请指出具体依据。参考答案：{{reference}}',warning:'LLM Judge 有偏差，分数不是客观事实准确率，须抽样人工复核。'};
    delete judge.model.ready;
    if(settings.cost_budget_usd!=null&&(judge.model.input_price_per_million==null||judge.model.output_price_per_million==null)) throw new Error('美元预算要求同时设置 Judge 输入与输出价格');
  }

  let image_manifest=null;
  if (task_type==='vision') {
    const allRefs=dataset.cases.flatMap(c=>c.images||[]);
    assertAssetsExist(allRefs,owner);
    image_manifest=allRefs.map(img=>{
      const meta=getAssetMeta(img.asset_id.replace(/^sha256:/,''),owner);
      return {asset_id:img.asset_id,role:img.role||null,sha256:meta.sha256,filename:meta.filename,mime_type:meta.mime_type,width:meta.width,height:meta.height,size_bytes:meta.size_bytes};
    });
  }
  const lexicon=structuredClone(dataset.label_lexicon||defaultLabelLexicon());
  return {
    schema_version:'1.0',
    analysis_version:'1.2.0',
    id:runId,
    name:String(input.name||(task_type==='vision'?'视觉模型对照':'模型与提示词对照')).slice(0,120),
    created_at:new Date().toISOString(),
    execution_mode:execution,
    task_type,
    promptfoo_version:'0.124.1',
    settings,
    models:providers,
    prompts:structuredClone(selected),
    dataset:structuredClone(dataset),
    dataset_hash:hash(dataset.cases),
    prompt_hash:hash(selected.map(p=>({id:p.id,version:p.version,content:p.content}))),
    total_cells:total,
    judge,
    ...(task_type==='vision'?{
      image_manifest,
      label_lexicon_version:lexicon.version,
      label_lexicon:lexicon,
      vision_note:'Mock 结果不代表真实模型视觉能力；仅完整标注案例计算准确性指标。',
    }:{}),
    source_hashes:Object.fromEntries(['provider.js','reference-assertion.js','config.js','analysis.js','worker.js','datasets.js','runner.js','models.js','transport.js','model-registry.js','credentials.js','session.js','storage.js','assets.js','vision-schema.js','vision-metrics.js','vision-assertion.js','lexicon.js','bundles.js','test-network-guard.js'].filter(f=>fs.existsSync(path.join(ROOT,'src',f))).map(f=>[f,hash(fs.readFileSync(path.join(ROOT,'src',f),'utf8'))])),
  };
}

export function promptfooConfig(snapshot, dir, owner=null) {
  const settings=snapshot.settings;
  const isVision=snapshot.task_type==='vision';

  const buildVars=(c,repeat_index)=>{
    const base={question:c.question,reference:c.reference||'',fact_terms_json:JSON.stringify(c.facts||[]),case_id:c.id,difficulty:c.difficulty,repeat_index};
    if(!isVision)return base;
    const images=(c.images||[]).map(img=>{
      const sha=img.asset_id.replace(/^sha256:/,'');
      const meta=getAssetMeta(sha,owner);
      const buf=readAssetBytes(sha,owner);
      return {asset_id:img.asset_id,role:img.role||null,mime_type:meta.mime_type,base64:buf.toString('base64')};
    });
    return {...base,images_json:JSON.stringify(images),vision_ground_truth_json:JSON.stringify(c.ground_truth||{}),vision_annotation_json:JSON.stringify(c.annotation||{}),vision_lexicon_json:JSON.stringify(snapshot.label_lexicon||{}),vision_scoreable:canScoreAccuracy(c),task_template:c.task_template||null};
  };

  const buildAssertions=c=>{
    if(!isVision){
      return [
        {type:'javascript',value:'file://./src/reference-assertion.js',metric:'reference_terms'},
        ...(c.expect_json?[{type:'is-json',value:{type:'object',required:Object.keys(JSON.parse(c.reference)),properties:Object.fromEntries(Object.keys(JSON.parse(c.reference)).map(k=>[k,{type:'string'}])),additionalProperties:false},metric:'json_compliance'}]:[]),
        ...c.assertions,
        ...(snapshot.judge?[{type:'llm-rubric',value:snapshot.judge.rubric,metric:'judge_quality',provider:{id:'file://./src/provider.js',label:'judge-qwen',config:{...settings,temperature:0,max_tokens:350,model:snapshot.judge.model,run_id:snapshot.id,ledger_file:path.join(dir,'ledger.json'),deadline_at:Date.now()+settings.max_duration_ms}}}]:[])
      ];
    }
    return [
      {type:'javascript',value:'file://./src/vision-assertion.js',metric:'vision_labels'},
    ];
  };

  return {
    description:`${snapshot.name} [${snapshot.execution_mode.toUpperCase()}${isVision?' · VISION':''}]`,
    sharing:false,
    basePath:ROOT,
    prompts:snapshot.prompts.map(p=>({label:`${p.id}@v${p.version}`,raw:p.content})),
    providers:snapshot.models.map(model=>({id:'file://./src/provider.js',label:model.id,config:{...settings,model,run_id:snapshot.id,ledger_file:path.join(dir,'ledger.json'),deadline_at:Date.now()+settings.max_duration_ms}})),
    tests:snapshot.dataset.cases.flatMap(c=>Array.from({length:settings.repeats},(_,repeat_index)=>({
      description:`${c.id} / repeat ${repeat_index+1}`,
      vars:buildVars(c,repeat_index),
      metadata:{case_id:c.id,difficulty:c.difficulty,repeat_index,task_type:c.task_type||snapshot.task_type},
      assert:buildAssertions(c),
    }))),
    evaluateOptions:{maxConcurrency:settings.max_concurrency,cache:false,timeoutMs:settings.timeout_ms*(settings.retries+1)+5000,maxEvalTimeMs:settings.max_duration_ms,showProgressBar:false},
    metadata:{
      studio_run_id:snapshot.id,
      execution_mode:snapshot.execution_mode,
      task_type:snapshot.task_type,
      dataset_sha256:snapshot.dataset_hash,
      prompt_sha256:snapshot.prompt_hash,
      ...(snapshot.image_manifest?{image_manifest:snapshot.image_manifest,label_lexicon_version:snapshot.label_lexicon_version}:{}),
      warning:isVision?'Mock 是参考答案夹具演示；标签指标仅在完整标注上计算。图片在授权后发给所选供应商。':'Mock 是参考答案夹具演示；事实词覆盖不能代表完整语义正确性。',
    },
  };
}

import { hash } from './storage.js';
const mean = values => { const a=values.filter(x=>x!=null&&Number.isFinite(x));return a.length?a.reduce((p,c)=>p+c,0)/a.length:null; };
const rate = a=>a.length?a.filter(Boolean).length/a.length:null;
export function normalize(result,index=0) {
  const t=result.testCase||{}, v=t.vars||{}, response=result.response||{}, components=result.gradingResult?.componentResults||[];
  const metrics=Object.fromEntries(components.map(c=>[c.assertion?.metric||c.assertion?.type,{score:c.score,pass:c.pass,reason:c.reason}]));
  // Promptfoo assertion-failure 也会设置 result.error；它不是传输错误。
  const error=response.error||((result.failureReason===2||response.metadata?.transport_error)?result.error:null)||null;
  const evaluation_error=components.find(c=>c.assertion?.metric==='judge_quality'&&String(c.reason).includes('[STUDIO_EVALUATION_ERROR]'))?.reason||null;
  let category=null;
  if (evaluation_error) category='评估失败';
  else if (error) category='请求失败';
  else if (metrics.json_compliance?.pass===false) category='格式错误';
  else if (metrics.reference_terms?.pass===false) category='事实词缺失';
  else if (!result.success) category='指令遵循';
  return {id:`cell-${index}`,case_id:v.case_id||t.metadata?.case_id,question:v.question,reference:v.reference,repeat_index:v.repeat_index??0,difficulty:v.difficulty,model:typeof result.provider==='object'?result.provider.label||result.provider.id:result.provider,prompt:result.prompt?.label||result.prompt?.display||String(result.promptIdx??''),success:Boolean(result.success)&&!error,evaluation_error,score:result.score??null,reference_score:metrics.reference_terms?.score??null,judge_score:evaluation_error?null:metrics.judge_quality?.score??null,json_pass:metrics.json_compliance?.pass??null,rule_score:metrics.rule?.score??null,latency_ms:response.metadata?.latency_ms??result.latencyMs??null,input_tokens:response.metadata?.input_tokens??null,output_tokens:response.metadata?.output_tokens??null,cost_usd:response.metadata?.cost_usd??null,output:typeof response.output==='string'?response.output:JSON.stringify(response.output??''),error,category,grading:result.gradingResult,metadata:response.metadata||{},human_review:null};
}
export function analyze(rows, weights={}, expectedRepeats=2, expectedTotalCells=null) {
  weights={quality:50,speed:20,cost:0,stability:30,...weights};
  const matrixComplete=expectedTotalCells==null||rows.length===expectedTotalCells;
  const ids=[...new Set(rows.map(r=>r.model))];
  const summary=ids.map(id=>{
    const all=rows.filter(r=>r.model===id), groups=new Map();
    for (const r of all) { const key=`${r.case_id}/${r.prompt}`;if (!groups.has(key)) groups.set(key,[]);groups.get(key).push(r); }
    const stabilityGroups=[...groups.values()].filter(a=>expectedRepeats>=2&&a.length===expectedRepeats&&new Set(a.map(r=>r.repeat_index)).size===expectedRepeats);
    const stability=matrixComplete&&stabilityGroups.length===groups.size?mean(stabilityGroups.map(a=>a.some(x=>x.error)?null:Math.max(...[...new Set(a.map(x=>hash(x.output)))].map(h=>a.filter(x=>hash(x.output)===h).length))/a.length)):null;
    const costs=all.map(r=>r.cost_usd),tokens=all.map(r=>r.input_tokens==null||r.output_tokens==null?null:r.input_tokens+r.output_tokens);
    return {model:id,count:all.length,evaluation_error_count:all.filter(r=>r.evaluation_error).length,pass_rate:rate(all.filter(r=>!r.evaluation_error).map(r=>r.success)),reference_score:mean(all.map(r=>r.reference_score)),judge_score:mean(all.map(r=>r.judge_score)),json_rate:rate(all.filter(r=>r.json_pass!=null).map(r=>r.json_pass)),avg_latency_ms:mean(all.map(r=>r.latency_ms)),total_tokens:tokens.every(x=>x!=null)?tokens.reduce((a,b)=>a+b,0):null,known_token_cells:tokens.filter(x=>x!=null).length,total_cost_usd:costs.every(x=>x!=null)?costs.reduce((a,b)=>a+b,0):null,avg_cost_usd:costs.every(x=>x!=null)?mean(costs):null,known_cost_cells:costs.filter(x=>x!=null).length,stability,failure_rate:rate(all.filter(r=>!r.evaluation_error).map(r=>!r.success))};
  });
  const fastest=Math.min(...summary.map(s=>s.avg_latency_ms??Infinity));
  const maxCost=Math.max(...summary.map(s=>s.avg_cost_usd??0));
  const validWeights=Object.fromEntries(['quality','speed','cost','stability'].map(k=>[k,Math.max(0,Math.min(100,Number(weights[k])||0))]));
  for (const s of summary) {
    const values={quality:s.pass_rate,speed:s.avg_latency_ms==null?null:fastest/Math.max(0.01,s.avg_latency_ms),cost:s.avg_cost_usd==null?null:maxCost===0?1:1-s.avg_cost_usd/maxCost,stability:s.stability};
    const requested=Object.entries(validWeights).filter(([,w])=>w>0),missing=requested.filter(([k])=>values[k]==null).map(([k])=>k);
    s.ranking_missing=missing;
    s.weight_coverage=requested.length?requested.filter(([k])=>values[k]!=null).reduce((p,[,w])=>p+w,0)/requested.reduce((p,[,w])=>p+w,0):0;
    s.weighted_score=missing.length||!requested.length?null:requested.reduce((p,[k,w])=>p+values[k]*w,0)/requested.reduce((p,[,w])=>p+w,0);
  }
  summary.sort((a,b)=>(b.weighted_score??-1)-(a.weighted_score??-1));
  const sensitivity=ids.flatMap(model=>[...new Set(rows.filter(r=>r.model===model).map(r=>r.prompt))].map(prompt=>{const a=rows.filter(r=>r.model===model&&r.prompt===prompt);return {model,prompt,pass_rate:rate(a.filter(r=>!r.evaluation_error).map(r=>r.success)),evaluation_error_count:a.filter(r=>r.evaluation_error).length,avg_latency_ms:mean(a.map(r=>r.latency_ms)),reference_score:mean(a.map(r=>r.reference_score))};}));
  const by_difficulty=['simple','medium','hard'].map(d=>({difficulty:d,models:ids.map(model=>{const a=rows.filter(r=>r.model===model&&r.difficulty===d);return {model,count:a.length,pass_rate:rate(a.filter(r=>!r.evaluation_error).map(x=>x.success)),evaluation_error_count:a.filter(r=>r.evaluation_error).length};})}));
  return {summary,sensitivity,by_difficulty,weights:validWeights,ranking_note:'权重是主观配置。任一启用维度缺失则不参与综合排名；成本未知请将成本权重设为 0。稳定性为同题同提示词重复输出的众数占比，不代表准确率；未完成重复组不形成稳定性结论。'};
}
export function csv(rows) {
  const columns=['id','case_id','difficulty','model','prompt','repeat_index','success','reference_score','json_pass','latency_ms','input_tokens','output_tokens','cost_usd','category','error','output','reference','human_review'];
  const escape=v=>{let text=typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');if(/^[\s]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return '\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(k=>escape(r[k])).join(','))].join('\r\n');
}
export function markdown(snapshot,rows,analysis,ledger=null) {
  const pct=n=>n==null?'未知':`${(100*n).toFixed(1)}%`;
  const lines=[`# ${snapshot.name}`,``, `执行模式：**${snapshot.execution_mode.toUpperCase()}**；Promptfoo ${snapshot.promptfoo_version}`,`时间：${snapshot.created_at}`,``,snapshot.execution_mode==='mock'?'**此处是实际运行的 Mock 流水线结果，使用参考答案夹具，不能作为真实模型能力或 Agent 架构优劣证据。**':'实时调用结果仅代表该冻结配置与样本，事实词命中不是完整事实正确性。',``,`数据 SHA256：${snapshot.dataset_hash}`,`提示词 SHA256：${snapshot.prompt_hash}`,``,`| 模型 | 任务通过率 | 事实词覆盖 | JSON合规 | 延迟 ms | 生成Token | 生成费用USD（不含Judge） | 稳定性 |`,`|---|---:|---:|---:|---:|---:|---:|---:|`,...analysis.summary.map(s=>`| ${s.model} | ${pct(s.pass_rate)} | ${pct(s.reference_score)} | ${pct(s.json_rate)} | ${s.avg_latency_ms?.toFixed(1)??'未知'} | ${s.total_tokens??'未知'} | ${s.total_cost_usd??'未知'} | ${pct(s.stability)} |`),``,analysis.ranking_note,``,`## 调用审计与评审开销`,``,`生成费用列不含 Judge。实验总费用必须同时纳入生成、重试与评审；未知费用不得记为零。`,ledger?JSON.stringify(costAudit(ledger),null,2):'无外部调用费用审计信息（Mock 未调用真实模型）。',``,`## 方法与限制`,``,`- 评测单元：models × prompts × cases × repeats；缓存关闭。`,`- 规则使用 Promptfoo 原生断言；参考答案使用明确人工事实词覆盖，保存逐项评分依据。`,`- 未提供价格或 usage 时记 null。LLM Judge 默认关闭；Judge 不是客观事实核验。评审基础设施失败单列，剔除质量分母并保留覆盖率。`,`- 失败案例分类支持人工修改。来源 URL 是人工参考入口，未自动证明网页始终可访问。`,`- 本实验未预注册抽样与推断检验，仅作描述性分析，不能据此宣称普遍性能优越。`,``,`## 失败案例`,``,...rows.filter(r=>!r.success).slice(0,50).map(r=>`- ${r.case_id} / ${r.model} / ${r.prompt} / repeat ${r.repeat_index+1}：${r.category}；${r.error||r.grading?.reason||''}`),``,`## 可复跑`,``,`冻结包包含 snapshot.json、promptfooconfig.json、raw-results.json、rows.json 与 ledger.json。运行 npm run replay -- <实验ID>；会保留原实验，创建新的实验ID。`,`完整明细在 results.csv / report.json。`];
  return lines.join('\n');
}
export function costAudit(ledger){
  const a=ledger?.attemptsLog||[],known=a.filter(x=>x.cost_usd!=null),judge=a.filter(x=>x.provider?.startsWith('judge-'));
  return {platform_requests:a.length,agent_internal_model_calls:ledger?.agent_model_calls??0,known_cost_requests:known.length,total_cost_usd:a.length&&known.length===a.length?known.reduce((s,x)=>s+x.cost_usd,0):null,known_cost_subtotal_usd:known.length?known.reduce((s,x)=>s+x.cost_usd,0):null,judge_requests:judge.length,judge_cost_usd:judge.length&&judge.every(x=>x.cost_usd!=null)?judge.reduce((s,x)=>s+x.cost_usd,0):null,note:'已知费用小计不是完整总费用；未知项为null。平台请求与AgentLab内部模型调用分开计数。'};
}

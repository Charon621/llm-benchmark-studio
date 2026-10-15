import { setupVisionWorkbench, confirmReplay } from './vision-ui.js';
import { setupModelManager } from './model-manager.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>n==null?'未知':`${(n*100).toFixed(1)}%`;
const num=n=>n==null?'未知':Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
const usd=n=>n==null?'未知':(n<0.01&&n>0?'$'+Number(n).toFixed(4):'$'+Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:4}));
const safeUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const sourceLink=(url,title=url)=>safeUrl(url)?`<a href="${esc(safeUrl(url))}" target="_blank" rel="noreferrer">${esc(title)}</a>`:`<span>${esc(title)}（不支持的来源链接）</span>`;
const PALETTE=['#1f5eff','#0d9488','#d97706','#7c3aed','#e11d48','#0891b2','#65a30d','#475569'];
const modelColor=name=>{let h=0;for(const c of String(name))h=(h*31+c.charCodeAt(0))>>>0;return PALETTE[h%PALETTE.length]};
const statusText={running:'正在运行',complete:'已完成',failed:'失败',invalid:'无效记录',cancelled:'已取消',interrupted:'重启中断',timeout:'总超时'};
const statusPill=s=>`<span class="pill ${esc(s)}">${esc(statusText[s]||s)}</span>`;
const modeTag=m=>`<span class="mode-tag ${m==='live'?'live':''}">${m==='live'?'LIVE':'MOCK'}</span>`;
const fmtTime=iso=>new Date(iso).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});

let lib,current=null,currentId='',reviewId='',timer,history=[],weights={quality:50,speed:20,cost:0,stability:30};
let wizStep=1;
const runCache=new Map();

async function api(url,options={}){const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data;}
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',6500);}
function guard(fn){return async event=>{event?.preventDefault();try{await fn(event);}catch(e){toast(e.message);}};}

/* ---------- 视图切换 ---------- */
const viewNames={overview:'概览',experiments:'实验',analysis:'结果分析',prompts:'提示词策略',datasets:'测试数据集',models:'模型管理',guide:'方法与接入'};
function switchView(name){
  $$('.view').forEach(x=>x.hidden=x.id!==`view-${name}`);
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===name));
  $('#main-nav').classList.remove('open');
  $('#nav-toggle').setAttribute('aria-expanded','false');
  window.scrollTo(0,0);
  if(name==='overview')renderOverview().catch(e=>toast(e.message));
}
$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('#nav-toggle').onclick=()=>{const open=!$('#main-nav').classList.contains('open');$('#main-nav').classList.toggle('open',open);$('#nav-toggle').setAttribute('aria-expanded',String(open));};
$('#cta-new-run').onclick=()=>{switchView('experiments');openWizard();};
$('#goto-experiments').onclick=()=>switchView('experiments');
$('#empty-goto-wizard').onclick=()=>{switchView('experiments');openWizard();};
$$('.step[data-goto]').forEach(b=>b.onclick=()=>{switchView(b.dataset.goto);if(b.dataset.openWizard)openWizard();});

/* ---------- 资源库渲染 ---------- */
async function loadLibrary(){lib=await api('/api/library');renderLibrary();}
function renderLibrary(){
  const previousModels=$$('input[name="model_ids"]:checked').map(i=>i.value),hadModels=$$('#model-choices input').length>0;
  const previousPrompts=$$('input[name="prompt_ids"]:checked').map(i=>i.value),hadPrompts=$$('#prompt-choices input').length>0;
  const previousDataset=$('#run-dataset').value;
  $('#live-status').textContent=lib.live_enabled?'LIVE 可用 · 会话凭证':'MOCK READY';
  $('#live-status').classList.toggle('live',lib.live_enabled);
  $('#mock-notice').hidden=!!lib.live_enabled;
  $('#run-dataset').innerHTML=lib.datasets.map(d=>`<option value="${esc(d.id)}">${esc(d.name)} · ${d.cases.length}题 / v${d.version}</option>`).join('');
  if(lib.datasets.some(d=>d.id===previousDataset))$('#run-dataset').value=previousDataset;

  $('#model-choices').innerHTML=lib.models.map(m=>{
    const checked=(hadModels?previousModels.includes(m.id):m.kind==='mock'&&!m.id.startsWith('mock-vision-'));
    const disabled=m.mode==='live'&&!m.ready;
    const tag=m.kind==='agentlab'?(m.mode==='live'?['授权对照','live']:['本机 MOCK','mock']):m.mode==='mock'?['MOCK','mock']:m.ready?['LIVE 就绪','live']:['需填写密钥',''];
    return `<label class="choice-card ${checked?'checked':''} ${disabled?'disabled':''}"><input type="checkbox" name="model_ids" value="${esc(m.id)}" ${checked?'checked':''} ${disabled?'disabled':''}><span class="choice-body"><strong>${esc(m.label)}${m.is_default?' · 默认':''}</strong><small>${esc(m.model||m.id)}</small></span><span class="choice-tag ${tag[1]}">${tag[0]}</span></label>`;
  }).join('')+'<button type="button" class="model-manage-link" id="open-model-manager">＋ 添加或管理实时模型</button>';
  $('#open-model-manager').onclick=()=>switchView('models');

  $('#dataset-choices').innerHTML=lib.datasets.map(d=>`<label class="choice-card ${$('#run-dataset').value===d.id?'checked':''}"><input type="radio" name="dataset_pick" value="${esc(d.id)}" ${$('#run-dataset').value===d.id?'checked':''}><span class="choice-body"><strong>${esc(d.name)}</strong><small>${d.cases.length} 题 · v${d.version} · SHA256 ${esc(d.hash.slice(0,10))}…</small></span></label>`).join('');
  $$('#dataset-choices input').forEach(r=>r.onchange=()=>{$('#run-dataset').value=r.value;$$('#dataset-choices .choice-card').forEach(c=>c.classList.toggle('checked',c.contains(r)));applyTaskMode(false);matrix();});

  $('#prompt-choices').innerHTML=lib.prompts.map((p,i)=>{
    const checked=hadPrompts?previousPrompts.includes(p.id):i<3;
    return `<label class="choice-card ${checked?'checked':''}"><input type="checkbox" name="prompt_ids" value="${esc(p.id)}" ${checked?'checked':''}><span class="choice-body"><strong>${esc(p.name)}</strong><small>VERSION ${p.version} · 历史 ${p.history?.length||0}</small></span></label>`;
  }).join('');

  $('#model-settings').innerHTML=lib.models.filter(m=>m.kind==='chat'&&m.key_env).map(m=>`<details class="sub-details"><summary>${esc(m.label)} · 兼容环境配置</summary><div class="form-grid"><label>模型版本<input name="${esc(m.id)}_model" value="${esc(m.model)}"></label><label>API Base URL<input name="${esc(m.id)}_base_url" value="${esc(m.base_url)}"></label><label>输入 USD / 百万 Token<input name="${esc(m.id)}_input_price_per_million" type="number" min="0" step="0.01" placeholder="未知留空"></label><label>输出 USD / 百万 Token<input name="${esc(m.id)}_output_price_per_million" type="number" min="0" step="0.01" placeholder="未知留空"></label></div></details>`).join('');

  $('#prompt-list').innerHTML=lib.prompts.map(p=>`<article class="prompt-card"><span class="version">${esc(p.id)} · V${p.version}</span><h3>${esc(p.name)}</h3><p>${esc(p.content)}</p><div class="connection-actions"><button class="btn btn-secondary btn-sm" data-edit-prompt="${esc(p.id)}">编辑 / 新版本</button><button class="btn btn-danger btn-sm" data-delete-prompt="${esc(p.id)}">删除</button></div><p class="hint">历史版本 ${p.history?.length||0} · 实验快照保留原内容</p></article>`).join('');
  $$('[data-edit-prompt]').forEach(b=>b.onclick=()=>{const p=lib.prompts.find(p=>p.id===b.dataset.editPrompt);for(const k of ['id','name','content'])$('#prompt-form').elements[k].value=p[k];$('#prompt-editor-title').textContent=`编辑 ${p.name} · 保存为 v${p.version+1}`;$('#prompt-form').scrollIntoView({behavior:'smooth'});});
  $$('[data-delete-prompt]').forEach(b=>b.onclick=guard(async()=>{await api(`/api/prompts/${b.dataset.deletePrompt}`,{method:'DELETE'});await loadLibrary();toast('策略已删除，既有实验快照保留。');}));

  $('#dataset-list').innerHTML=lib.datasets.map(d=>`<article class="prompt-card"><span class="version">DATASET V${d.version} · ${d.cases.length} CASES</span><h3>${esc(d.name)}</h3><p>${esc(d.cases.map(c=>`${c.id} · ${c.difficulty}`).join(' / '))}</p><p class="mono">SHA256 ${esc(d.hash.slice(0,18))}…</p><div class="connection-actions"><button class="btn btn-secondary btn-sm" data-preview-dataset="${esc(d.id)}">查看题目与事实规则</button><button class="btn btn-danger btn-sm" data-delete-dataset="${esc(d.id)}">删除</button></div></article>`).join('');
  $$('[data-preview-dataset]').forEach(b=>b.onclick=()=>{const d=lib.datasets.find(d=>d.id===b.dataset.previewDataset);$('#case-detail').innerHTML=`<h3 style="margin-bottom:12px">${esc(d.name)}</h3>${d.cases.map(c=>`<div class="detail-block"><h3>${esc(c.id)} / ${esc(c.difficulty)}</h3><p>${esc(c.question)}</p><p><b>参考：</b>${esc(c.reference)}</p><p><b>事实词：</b>${esc((c.facts||[]).join('、'))}</p>${(c.source_urls||[]).map(u=>`<a target="_blank" rel="noreferrer" href="${esc(u)}">${esc(u)}</a><br>`).join('')}</div>`).join('')}`;$('#review-form').hidden=true;$('#case-dialog').showModal();});
  $$('[data-delete-dataset]').forEach(b=>b.onclick=guard(async()=>{await api(`/api/datasets/${b.dataset.deleteDataset}`,{method:'DELETE'});await loadLibrary();toast('数据集已删除，既有实验数据快照保留。');}));
  applyTaskMode(false);matrix();
}

/* ---------- 评测矩阵与向导 ---------- */
function selectedModels(){return lib?lib.models.filter(m=>$$('input[name="model_ids"]:checked').map(i=>i.value).includes(m.id)):[]}
function matrix(){
  if(!lib)return;
  const selected=$$('input[name="model_ids"]:checked').map(i=>i.value),m=selected.length,
    p=$$('input[name="prompt_ids"]:checked').length,
    c=lib.datasets.find(d=>d.id===$('#run-dataset').value)?.cases.length||0,
    r=Number($('#run-form').elements.repeats.value)||1;
  $('#run-form').elements.temperature.max=lib.models.some(model=>selected.includes(model.id)&&model.kind==='chat'&&model.protocol==='anthropic'&&model.send_temperature!==false)?'1':'2';
  $('#matrix-preview').textContent=`${m} 模型 × ${p} 策略 × ${c} 样本 × ${r} 次 = ${m*p*c*r} 单元`;
}
$('#run-form').addEventListener('input',e=>{
  if(e.target.name==='model_ids'||e.target.name==='prompt_ids')e.target.closest('.choice-card')?.classList.toggle('checked',e.target.checked);
  matrix();
});
function openWizard(){
  $('#config-panel').hidden=false;
  gotoStep(1);
  $('#config-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
$('#toggle-config').onclick=()=>{$('#config-panel').hidden?openWizard():$('#config-panel').hidden=true;};
$('#agent-preset').onclick=()=>{
  const bridges=lib.models.filter(model=>model.id.startsWith('bridge-'));
  const selected=bridges.length?bridges.slice(0,2).map(model=>model.id):['agentlab-single','agentlab-multi'];
  $$('input[name="model_ids"]').forEach(x=>{x.checked=selected.includes(x.value);x.closest('.choice-card')?.classList.toggle('checked',x.checked);});
  $('#run-form').elements.name.value='AgentLab 单 Agent / 多 Agent 对照';
  $('#run-form').elements.temperature.value=0;
  matrix();
  toast(bridges.length?'已选择同一授权模型的 Single / Multi。请确认本次实时调用，并设置可比较的每题预算。':'已选择 AgentLab 两种 Mock 架构。实时对照可先在模型管理中连接授权模型。');
};
function wizError(t){$('#wizard-error').textContent=t||''}
function validateStep(step){
  if(step===1&&!$$('input[name="model_ids"]:checked').length)return'请至少选择一个模型或系统。';
  if(step===2&&!$('#run-dataset').value)return'请选择一个测试数据集。';
  if(step===3&&!$$('input[name="prompt_ids"]:checked').length)return'请至少选择一种提示词策略。';
  return'';
}
function renderConfirm(){
  const f=$('#run-form').elements;
  const models=selectedModels().map(m=>m.label).join('、');
  const prompts=$$('input[name="prompt_ids"]:checked').map(i=>lib.prompts.find(p=>p.id===i.value)?.name).filter(Boolean).join('、');
  const dataset=lib.datasets.find(d=>d.id===$('#run-dataset').value);
  const judge=f.judge_enabled.checked?`启用 · ${f.judge_model.value||'qwen-plus'}`:'未启用';
  const live=selectedModels().some(m=>m.mode==='live');
  $('#confirm-list').innerHTML=[
    ['实验名称',f.name.value],['模型 / 系统',models],['数据集',dataset?`${dataset.name} · ${dataset.cases.length} 题 · v${dataset.version}`:'—'],
    ['提示词策略',prompts],['重复次数',f.repeats.value],['Temperature',f.temperature.value],
    ['最大并发',f.max_concurrency.value],['最大输出 Token',f.max_tokens.value],['LLM Judge',judge]
  ].map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#live-warn').hidden=!live;
  const vision=dataset?.task_type==='vision'&&live;$('#vision-consent').hidden=!vision;f.confirm_vision_upload.checked=false;$('#vision-manifest').textContent=vision?`将发送 ${dataset.cases.reduce((n,c)=>n+(c.images?.length||0),0)} 张图片引用至 ${selectedModels().map(m=>m.provider||m.label).join('、')}。图片清单：${dataset.cases.flatMap(c=>(c.images||[]).map(i=>i.asset_id+' / '+(i.role||'未指定'))).join('；')}`:'';
  $('.confirm-check').style.display=live?'':'none';
}
function gotoStep(step){
  wizStep=step;wizError('');
  $$('.wpane').forEach(p=>p.hidden=p.dataset.pane!==String(step));
  $$('.wstep').forEach(s=>{const n=Number(s.dataset.step);s.classList.toggle('active',n===step);s.classList.toggle('done',n<step);});
  $('#wiz-prev').hidden=step===1;
  $('#wiz-next').hidden=step===5;
  $('#run-submit').hidden=step!==5;
  if(step===5)renderConfirm();
}
$$('.wstep').forEach(b=>b.onclick=()=>{const target=Number(b.dataset.step);if(target<wizStep||!validateStep(wizStep))gotoStep(target);else wizError(validateStep(wizStep));});
$('#wiz-prev').onclick=()=>gotoStep(Math.max(1,wizStep-1));
$('#wiz-next').onclick=()=>{const err=validateStep(wizStep);if(err){wizError(err);return}gotoStep(Math.min(5,wizStep+1));};

$('#run-form').onsubmit=guard(async()=>{
  const err=[1,2,3].map(validateStep).find(Boolean);
  if(err){wizError(err);return}
  const live=selectedModels().some(m=>m.mode==='live');
  const f=new FormData($('#run-form')),body=Object.fromEntries(f);
  if(live&&!f.has('confirm_live')){wizError('本次实验包含真实 API 调用，请勾选费用确认。');return}
  body.model_ids=f.getAll('model_ids');body.prompt_ids=f.getAll('prompt_ids');
  body.confirm_vision_upload=f.has('confirm_vision_upload');body.confirm_live=f.has('confirm_live');body.judge_enabled=f.has('judge_enabled');body.model_overrides={};
  for(const m of lib.models.filter(m=>m.kind==='chat'&&m.key_env))body.model_overrides[m.id]=Object.fromEntries(['model','base_url','input_price_per_million','output_price_per_million'].map(k=>[k,f.get(`${m.id}_${k}`)]));
  body.model_overrides['judge-qwen']={input_price_per_million:f.get('judge_input_price')||null,output_price_per_million:f.get('judge_output_price')||null};
  const state=await api('/api/runs',{method:'POST',body:JSON.stringify(body)});
  currentId=state.id;$('#config-panel').hidden=true;
  await loadHistory();switchView('analysis');await loadRun();
  toast('Promptfoo 实验已启动；缓存关闭，正在逐单元保存结果。');
});

/* ---------- 实验列表 / 历史 ---------- */
async function loadHistory(){
  history=await api('/api/runs');
  $('#history-select').innerHTML=history.length?history.map(r=>`<option value="${r.id}">${r.execution_mode.toUpperCase()} · ${esc(r.name)} · ${r.completed}/${r.total} · ${esc(statusText[r.status]||r.status)}</option>`).join(''):'<option value="">暂无实验</option>';
  if(!currentId&&history.length)currentId=history[0].id;
  if(currentId)$('#history-select').value=currentId;
  renderRunsTable();renderRecent();
}
function runRow(r){
  const done=r.completed||0,total=r.total||0,rate=total?Math.round(done/total*100):0;
  return `<tr><td class="run-name-cell" data-open-run="${esc(r.id)}"><b>${esc(r.name)}</b><small>${esc(r.id)}</small></td><td>${modeTag(r.execution_mode)}</td><td>${statusPill(r.status)}</td><td><div class="progress-mini"><div class="track"><div class="fill" style="width:${rate}%"></div></div><span>${done}/${total}</span></div></td><td>${fmtTime(r.created_at)}</td><td class="col-op"><button class="btn btn-text btn-sm" data-open-run="${esc(r.id)}">查看</button></td></tr>`;
}
function bindRunRows(scope){$$(`#${scope} [data-open-run]`).forEach(b=>b.onclick=guard(async()=>{currentId=b.dataset.openRun;$('#history-select').value=currentId;switchView('analysis');await loadRun();}));}
function renderRunsTable(){
  $('#runs-body').innerHTML=history.length?history.map(runRow).join(''):'<tr class="empty-row"><td colspan="6">还没有实验。点击「新建实验」开始第一次评测。</td></tr>';
  bindRunRows('runs-body');
}
function renderRecent(){
  $('#recent-body').innerHTML=history.length?history.slice(0,5).map(runRow).join(''):'<tr class="empty-row"><td colspan="6">暂无实验记录</td></tr>';
  bindRunRows('recent-body');
}
$('#history-select').onchange=guard(async()=>{currentId=$('#history-select').value;await loadRun();});
$('#refresh').onclick=guard(async()=>{await loadHistory();toast('实验列表已刷新。');});
$('#refresh-analysis').onclick=guard(async()=>{await loadHistory();await loadRun();});
async function loadLegacy(){const data=await api('/api/legacy');$('#legacy-history').hidden=!(data.available&&data.unowned_runs>0);$('#legacy-history-count').textContent=`发现 ${data.unowned_runs} 个旧版单用户实验。认领后归属当前浏览器会话，冻结结果会保留。`;}
$('#import-legacy-history').onclick=guard(async()=>{if(!window.confirm('将本机旧版单用户实验归属当前浏览器会话？此操作只允许执行一次，其他会话无法读取。'))return;await api('/api/legacy/import',{method:'POST',body:JSON.stringify({confirm:true})});await loadLegacy();await loadHistory();await loadRun();toast('旧实验已归属当前会话，原始配置和结果保留。');});

/* ---------- 概览仪表盘 ---------- */
async function detailCached(id){
  if(!runCache.has(id))runCache.set(id,api(`/api/runs/${id}`).catch(()=>null));
  return runCache.get(id);
}
async function renderOverview(){
  if(!history.length){
    for(const id of ['stat-total','stat-complete','stat-running','stat-failed'])$(`#${id}`).textContent='0';
    $('#stat-cost').textContent='—';$('#stat-cost-foot').textContent='';
    for(const id of ['chart-performance','chart-latency','chart-cost'])$(`#${id}`).innerHTML='<div class="chart-empty"><p>暂无已完成实验<br>运行一次评测后，这里会展示真实统计结果</p></div>';
    return;
  }
  const failedStatuses=['failed','invalid','interrupted','timeout'];
  $('#stat-total').textContent=history.length;
  $('#stat-total-foot').textContent='含已取消 '+(history.filter(r=>r.status==='cancelled').length)+' 次';
  $('#stat-complete').textContent=history.filter(r=>r.status==='complete').length;
  $('#stat-running').textContent=history.filter(r=>r.status==='running').length;
  $('#stat-failed').textContent=history.filter(r=>failedStatuses.includes(r.status)).length;
  $('#stat-failed-foot').textContent='不含已取消';

  const complete=history.filter(r=>r.status==='complete').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(-8);
  const monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);
  const monthRuns=history.filter(r=>r.status==='complete'&&new Date(r.created_at)>=monthStart);
  const details=(await Promise.all([...new Set([...complete,...monthRuns].map(r=>r.id))].map(detailCached))).filter(Boolean);
  const byId=Object.fromEntries(details.map(d=>[d.state.id,d]));

  // 本月消耗
  let knownSum=0,knownReq=0,platformReq=0;
  for(const r of monthRuns){const d=byId[r.id];if(!d?.cost_audit)continue;knownSum+=d.cost_audit.total_cost_usd||0;knownReq+=d.cost_audit.known_cost_requests||0;platformReq+=d.cost_audit.platform_requests||0;}
  if(!platformReq){$('#stat-cost').textContent='—';$('#stat-cost-foot').textContent='本月无实时请求';}
  else if(!knownReq){$('#stat-cost').textContent='未知';$('#stat-cost-foot').textContent=`${platformReq} 个请求缺少价格/用量`;}
  else{$('#stat-cost').textContent=usd(knownSum);$('#stat-cost-foot').textContent=`覆盖 ${knownReq}/${platformReq} 个请求`;}

  // 图表数据
  const models=[...new Set(complete.flatMap(r=>(byId[r.id]?.analysis?.summary||[]).map(s=>s.model)))];
  if(!complete.length||!models.length){
    for(const id of ['chart-performance','chart-latency','chart-cost'])$(`#${id}`).innerHTML='<div class="chart-empty"><p>暂无已完成实验<br>运行一次评测后，这里会展示真实统计结果</p></div>';
    return;
  }
  const perfSeries=models.map(model=>({model,color:modelColor(model),points:complete.map((r,i)=>{const s=(byId[r.id]?.analysis?.summary||[]).find(x=>x.model===model);return s?.pass_rate==null?null:{x:i,y:s.pass_rate};}).filter(Boolean)}));
  const labels=complete.map(r=>{const d=new Date(r.created_at);return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}${r.execution_mode==='mock'?' ·M':''}`;});
  $('#chart-performance').innerHTML=lineChart(perfSeries,labels)+legend(models);
  const latency=models.map(model=>{let sum=0,n=0;for(const r of complete){const s=(byId[r.id]?.analysis?.summary||[]).find(x=>x.model===model);if(s?.avg_latency_ms!=null){sum+=s.avg_latency_ms*(s.count||1);n+=s.count||1;}}return n?{name:model,value:sum/n}:null;}).filter(Boolean);
  $('#chart-latency').innerHTML=latency.length?barChart(latency,v=>`${Math.round(v).toLocaleString('zh-CN')} ms`):'<div class="chart-empty"><p>已完成实验均缺少延迟数据</p></div>';
  const cost=models.map(model=>{let sum=0,n=0;for(const r of complete){const s=(byId[r.id]?.analysis?.summary||[]).find(x=>x.model===model);if(s?.total_cost_usd!=null&&s?.known_cost_cells){sum+=s.total_cost_usd;n+=s.known_cost_cells;}}return n?{name:model,value:sum/n}:null;}).filter(Boolean);
  $('#chart-cost').innerHTML=cost.length?barChart(cost,v=>'$'+(v<0.01?v.toFixed(4):v.toFixed(3))):'<div class="chart-empty"><p>缺少价格或用量数据<br>未知不按零计算</p></div>';
}
function legend(models){return `<div class="chart-legend">${models.map(m=>`<span><i class="legend-swatch" style="background:${modelColor(m)}"></i>${esc(m)}</span>`).join('')}</div>`}
function lineChart(series,labels){
  const W=720,H=240,P={l:46,r:14,t:16,b:34},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const n=Math.max(labels.length,2);
  const X=i=>P.l+(labels.length===1?iw/2:i*iw/(n-1));
  const Y=v=>P.t+ih*(1-v);
  const grid=[0,.25,.5,.75,1].map(g=>`<line class="grid-line" x1="${P.l}" y1="${Y(g)}" x2="${W-P.r}" y2="${Y(g)}"/><text class="axis-label" x="${P.l-8}" y="${Y(g)+3.5}" text-anchor="end">${g*100}%</text>`).join('');
  const ticks=labels.map((t,i)=>`<text class="axis-label" x="${X(i)}" y="${H-10}" text-anchor="middle">${esc(t)}</text>`).join('');
  const lines=series.filter(s=>s.points.length).map(s=>{
    const pts=s.points.map(p=>`${X(p.x)},${Y(p.y)}`).join(' ');
    return `${s.points.length>1?`<polyline class="data-line" style="stroke:${s.color}" points="${pts}"/>`:''}${s.points.map(p=>`<circle class="data-dot" cx="${X(p.x)}" cy="${Y(p.y)}" r="3.4" style="fill:${s.color}"><title>${esc(s.model)} · ${(p.y*100).toFixed(1)}%</title></circle>`).join('')}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="模型性能对比折线图"><text class="axis-title" x="${P.l}" y="${P.t-4}">任务通过率（%）· 横轴为实验日期，·M 为 MOCK 演示实验</text>${grid}${ticks}${lines}</svg>`;
}
function barChart(items,fmt){
  const W=560,H=230,P={l:56,r:12,t:22,b:40},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const max=Math.max(...items.map(i=>i.value))*1.15||1;
  const step=iw/items.length,bw=Math.min(64,step*0.52);
  const grid=[0,.5,1].map(g=>{const y=P.t+ih*(1-g);return `<line class="grid-line" x1="${P.l}" y1="${y}" x2="${W-P.r}" y2="${y}"/><text class="axis-label" x="${P.l-8}" y="${y+3.5}" text-anchor="end">${esc(fmt(max*g))}</text>`}).join('');
  const bars=items.map((it,i)=>{
    const h=Math.max(2,it.value/max*ih),x=P.l+step*i+(step-bw)/2,y=P.t+ih-h;
    const name=it.name.length>10?it.name.slice(0,9)+'…':it.name;
    return `<rect class="bar-rect" x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" style="fill:${modelColor(it.name)}"><title>${esc(it.name)} · ${esc(fmt(it.value))}</title></rect><text class="bar-value" x="${x+bw/2}" y="${y-6}" text-anchor="middle">${esc(fmt(it.value))}</text><text class="bar-name" x="${x+bw/2}" y="${H-14}" text-anchor="middle">${esc(name)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="柱状图">${grid}${bars}</svg>`;
}

/* ---------- 结果分析 ---------- */
const query=()=>new URLSearchParams(weights).toString();
async function loadRun(){if(!currentId)return;current=await api(`/api/runs/${currentId}?${query()}`);runCache.delete(currentId);renderRun();}
function renderRun(){
  const {state,snapshot,analysis}=current;
  if(analysis.kind==='vision')current.rows=analysis.rows;
  const rows=current.rows;
  $('#empty-results').hidden=true;$('#results').hidden=false;
  $('#experiment-subtitle').textContent=`${state.id} · ${new Date(state.created_at).toLocaleString('zh-CN')}`;
  $('#run-mode').textContent=state.execution_mode.toUpperCase();
  $('#run-mode').classList.toggle('live',state.execution_mode==='live');
  $('#run-name').textContent=state.name;
  $('#run-state').textContent=`${statusText[state.status]||state.status} · ${state.completed} / ${state.total} 单元 · Promptfoo ${snapshot.promptfoo_version}`;
  const failedCount=rows.filter(r=>!r.success).length;
  $('#run-progress-fill').style.width=(state.total?state.completed/state.total*100:0)+'%';
  $('#run-progress-text').textContent=`已完成 ${state.completed} / ${state.total} · 失败 ${failedCount} · 剩余 ${Math.max(0,state.total-state.completed)}`;
  $('#run-error').textContent=state.error||'';
  $('#cancel-run').hidden=state.status!=='running';$('#replay-run').disabled=state.status==='running';
  for(const format of ['json','csv','markdown','config'])$(`#export-${format}`).href=`/api/runs/${state.id}/export/${format}?${query()}`;
  $('#weights').hidden=analysis.kind==='vision';
  const visionMode=analysis.kind==='vision';const charts=$('#model-chart').closest('section');charts.querySelector('h2').textContent=visionMode?'皮损标签 Micro F1':'任务通过率';charts.querySelector('.hint').textContent=visionMode?'只基于合格人工标注计算；鉴别诊断、未复核或不完整标注不产生标签准确率。':'预设断言全部通过的比例。事实词匹配只是最低护栏，不能替代完整语义和来源核验。';$('#ranking-body').closest('section').querySelector('h2').textContent=visionMode?'视觉指标明细':'按你的目标配置排名';
  if(analysis.kind==='vision'){renderVisionRun(analysis);renderCaseFilters();renderCases();$('#snapshot-preview').textContent=JSON.stringify({snapshot,ledger:current.ledger},null,2);return;}
  $('#ranking-body').closest('table').querySelector('thead').innerHTML='<tr><th>模型</th><th>综合分</th><th>通过率</th><th>事实词覆盖</th><th>JSON合规</th><th>平均延迟</th><th>生成Token</th><th>生成费用 USD</th><th>稳定性</th></tr>';
  const valid=rows.filter(r=>!r.evaluation_error);
  $('#metric-cards').innerHTML=[['已完成单元',`${rows.length}<small> / ${state.total}</small>`,'缓存关闭 · 完成即落盘'],['任务通过率',pct(valid.length?valid.filter(r=>r.success).length/valid.length:null),`有效评分 ${valid.length}/${rows.length} · 预定义断言`],['需复核案例',failedCount,'原始输出与依据完整保留'],['实验模式',state.execution_mode.toUpperCase(),state.execution_mode==='mock'?'演示夹具 · 非真实模型结论':'真实请求 · 以服务端 usage 为准']].map(([label,value,caption])=>`<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="caption">${caption}</div></div>`).join('');
  $('#model-chart').innerHTML=analysis.summary.map(s=>`<div class="bar-row"><span title="${esc(s.model)}">${esc(s.model)}</span><div class="bar-track"><div class="bar-fill" style="width:${(s.pass_rate||0)*100}%;background:${modelColor(s.model)}"></div></div><strong>${pct(s.pass_rate)}</strong></div>`).join('')||'<p class="hint">等待第一个完成单元…</p>';
  $('#sensitivity-chart').innerHTML=(analysis.sensitivity||[]).map(s=>`<div class="sensitivity-row"><span>${esc(s.model)}<br>${esc(s.prompt)}</span><div class="bar-track"><div class="bar-fill" style="width:${(s.pass_rate||0)*100}%;background:${modelColor(s.model)}"></div></div><strong>${pct(s.pass_rate)}</strong></div>`).join('');
  $('#ranking-note').textContent=analysis.ranking_note+` 生成费用不含 Judge。实验总费用（含Judge/重试）：${num(current.cost_audit?.total_cost_usd)} USD；费用覆盖 ${current.cost_audit?.known_cost_requests??0}/${current.cost_audit?.platform_requests??0} 个平台请求。评审基础设施失败 ${rows.filter(r=>r.evaluation_error).length} 项。`;
  $('#ranking-body').innerHTML=analysis.summary.map(s=>`<tr><td><b>${esc(s.model)}</b><small>${s.count} 单元 · 指标覆盖 ${pct(s.weight_coverage)}</small></td><td>${s.weighted_score==null?'不参与':(100*s.weighted_score).toFixed(1)}<small>${esc((s.ranking_missing||[]).join('、'))}</small></td><td>${pct(s.pass_rate)}</td><td>${pct(s.reference_score)}</td><td>${pct(s.json_rate)}</td><td>${num(s.avg_latency_ms)} ms</td><td>${num(s.total_tokens)}<small>${s.known_token_cells}/${s.count} 已知</small></td><td>${num(s.total_cost_usd)}<small>${s.known_cost_cells}/${s.count} 已知</small></td><td>${pct(s.stability)}</td></tr>`).join('');
  renderCaseFilters();renderCases();
  $('#snapshot-preview').textContent=JSON.stringify({snapshot,ledger:current.ledger},null,2);
}
let casePage=0;
function renderCases(){
  if(!current)return;
  const filter=$('#case-search').value.toLowerCase();
  const rows=current.rows.filter(r=>(!$('#case-model').value||r.model===$('#case-model').value)&&(!$('#case-prompt').value||r.prompt===$('#case-prompt').value)&&(!$('#case-difficulty').value||r.difficulty===$('#case-difficulty').value)&&(!$('#case-category').value||(r.human_review?.category||r.category||'通过')===$('#case-category').value)&&(!$('#case-scoreable').value||String(Boolean(r._labelMetrics?.computable))===$('#case-scoreable').value)&&(!$('#fail-only').checked||!r.success)&&[r.case_id,r.model,r.prompt,r.output].join(' ').toLowerCase().includes(filter));
  casePage=Math.min(casePage,Math.max(0,Math.ceil(rows.length/50)-1));
  const scored=rows.filter(r=>r._labelMetrics?.computable);let tp=0,fp=0,fn=0;for(const row of scored){tp+=row._labelMetrics.tp;fp+=row._labelMetrics.fp;fn+=row._labelMetrics.fn;}$('#case-filter-metrics').textContent=current.snapshot.task_type==='vision'?`当前筛选：${rows.length} 单元，可评分 ${scored.length}；Micro F1 ${2*tp+fp+fn?pct(2*tp/(2*tp+fp+fn)):'不可计算'}`:`当前筛选 ${rows.length} 单元` ;
  $('#cases-body').innerHTML=rows.slice(casePage*50,(casePage+1)*50).map(r=>`<tr><td><b>${esc(r.case_id)}</b><small>${esc(r.difficulty)}</small></td><td>${esc(r.model)}<small>${esc(r.prompt)}</small></td><td>${r.repeat_index+1}</td><td><span class="${r.success?'pass':'fail'}">${r.success?'通过':'未通过'}</span></td><td>${esc(r.human_review?.category||r.category||'—')}${r.human_review?'<small>人工已复核</small>':''}</td><td>${num(r.latency_ms)} ms</td><td class="col-op"><button class="btn btn-secondary btn-sm" data-case="${esc(r.id)}">查看 / 复核</button></td></tr>`).join('')||'<tr class="empty-row"><td colspan="7">没有符合筛选条件的案例</td></tr>';
  $('#case-count').textContent=`筛选后 ${rows.length} 个单元 · 第 ${casePage+1}/${Math.max(1,Math.ceil(rows.length/50))} 页。`;
  $$('[data-case]').forEach(b=>b.onclick=()=>openCase(b.dataset.case));
}
function openCase(id){
  const r=current.rows.find(r=>r.id===id);reviewId=id;
  const c=current.snapshot.dataset.cases.find(c=>c.id===r.case_id);
  const isVision=current.snapshot.task_type==='vision';
  // Vision case: show images, parsed output, label metrics.
  if(isVision&&c){
    const imagesHtml=(c.images||[]).map((img,i)=>{
      const role=img.role||`图${i+1}`;
      return `<div style="display:inline-block;margin:4px;text-align:center"><img src="/api/assets/${img.asset_id}" alt="${esc(role)}" style="cursor:zoom-in;max-width:220px;max-height:200px;border-radius:6px;border:1px solid #ddd"><br><small>${esc(role)}</small></div>`;
    }).join('');
    const gt=c.ground_truth||{};
    const gtLabels=Array.isArray(gt.lesion_labels)?gt.lesion_labels.join('、'):'（无标注）';
    const parsed=r._parsed||{};
    const lm=r._labelMetrics||{};
    const abst=r._abstention||{};
    $('#case-detail').innerHTML=`<div class="detail-block"><h3>${esc(r.case_id)} · ${esc(r.model)} · ${esc(r.prompt)}</h3><p>${esc(r.question)}</p></div><div class="detail-block"><h3>输入图片</h3><div>${imagesHtml||'<p class="hint">无图片</p>'}</div></div><div class="detail-block"><h3>原始输出 ${r.error?'· 请求失败':''}</h3><pre>${esc(r.error||r.output)}</pre></div><div class="detail-block"><h3>解析结果</h3><pre>${esc(JSON.stringify(parsed,null,2))}</pre></div><div class="detail-block"><h3>人工参考</h3><p>标签：${esc(gtLabels)}<br>可答性：${esc(gt.answerability||'未知')} · 完整性：${esc(gt.label_completeness||'未知')}</p></div><div class="detail-block"><h3>指标</h3><p>TP: ${esc(lm.hits?lm.hits.join('、'):'—')} · FP: ${esc(lm.false_positives?lm.false_positives.join('、'):'—')} · FN: ${esc(lm.misses?lm.misses.join('、'):'—')}<br>P: ${lm.precision!=null?lm.precision.toFixed(3):'不可算'} · R: ${lm.recall!=null?lm.recall.toFixed(3):'不可算'} · F1: ${lm.f1!=null?lm.f1.toFixed(3):'不可算'}<br>拒答：${abst.model_abstain?'是':'否'} · 判定：${esc(abst.verdict||'—')}</p></div><div class="detail-block"><h3>调用信息</h3><pre>${esc(JSON.stringify(r.metadata,null,2))}</pre></div>`;
  } else {
    $('#case-detail').innerHTML=`<div class="detail-block"><h3>${esc(r.case_id)} · ${esc(r.model)} · ${esc(r.prompt)}</h3><p>${esc(r.question)}</p></div><div class="detail-block"><h3>原始输出 ${r.error?'· 请求失败':''}</h3><pre>${esc(r.error||r.output)}</pre></div><div class="detail-block"><h3>人工参考答案</h3><p>${esc(r.reference)}</p></div><div class="detail-block"><h3>Promptfoo 断言依据</h3><pre>${esc(JSON.stringify(r.grading,null,2))}</pre></div><div class="detail-block"><h3>来源核验入口</h3>${(r.metadata?.sources||[]).map(s=>`<p>${sourceLink(s.url,s.title||s.url)}</p>`).join('')}${(c?.source_urls||[]).map(u=>`${sourceLink(u)}<br>`).join('')}<p class="hint">参考来源用于人工复核，URL存在不等于支持输出每个论断。</p></div><div class="detail-block"><h3>调用 / 节点信息</h3><pre>${esc(JSON.stringify(r.metadata,null,2))}</pre></div>`;
  }
  $('#review-form').hidden=false;
  $('#review-form').elements.category.value=r.human_review?.category||r.category||'通过';
  $('#review-form').elements.note.value=r.human_review?.note||'';
  $('#case-detail').querySelectorAll('img').forEach(img=>img.onclick=()=>{const d=document.createElement('dialog');d.className='image-viewer';const close=document.createElement('button');close.className='btn';close.textContent='关闭大图';close.onclick=()=>{d.close();d.remove()};const full=img.cloneNode();full.style='max-width:100%;height:auto';d.append(close,full);document.body.append(d);d.showModal()});
  $('#case-dialog').showModal();
}
$('#close-dialog').onclick=()=>$('#case-dialog').close();
$('#review-form').onsubmit=guard(async()=>{const data=Object.fromEntries(new FormData($('#review-form')));await api(`/api/runs/${currentId}/rows/${reviewId}`,{method:'PATCH',body:JSON.stringify(data)});$('#case-dialog').close();await loadRun();toast('已保存人工分类与复核说明；自动评分保留原值。');});
$('#fail-only').onchange=()=>{casePage=0;renderCases()};$('#case-search').oninput=()=>{casePage=0;renderCases()};
for(const id of ['case-model','case-prompt','case-difficulty','case-category','case-scoreable'])$('#'+id).onchange=()=>{casePage=0;renderCases()};
$('#case-prev').onclick=()=>{casePage=Math.max(0,casePage-1);renderCases()};$('#case-next').onclick=()=>{casePage++;renderCases()};

/* ---------- 权重 ---------- */
$('#weights').innerHTML=Object.entries({quality:'任务质量',speed:'响应速度',cost:'调用成本',stability:'输出稳定性'}).map(([k,label])=>`<label>${label}<output id="weight-${k}">${weights[k]}</output><input type="range" min="0" max="100" value="${weights[k]}" data-weight="${k}" aria-label="${label}权重"></label>`).join('');
let weightTimer;$$('[data-weight]').forEach(i=>i.oninput=()=>{weights[i.dataset.weight]=Number(i.value);$(`#weight-${i.dataset.weight}`).textContent=i.value;clearTimeout(weightTimer);weightTimer=setTimeout(()=>loadRun().catch(e=>toast(e.message)),250);});

/* ---------- 运行操作 ---------- */
$('#cancel-run').onclick=guard(async()=>{await api(`/api/runs/${currentId}/cancel`,{method:'POST'});await loadRun();toast('已取消，已完成单元保留。');});
$('#replay-run').onclick=guard(async()=>{const body=await confirmReplay(current.snapshot);if(!body)return;const state=await api(`/api/runs/${currentId}/replay`,{method:'POST',body:JSON.stringify(body)});currentId=state.id;await loadHistory();await loadRun();toast('已创建新的复跑实验，原记录保持不变。');});

/* ---------- 提示词 / 数据集 ---------- */
$('#new-prompt').onclick=()=>{$('#prompt-form').reset();$('#prompt-form').elements.id.value='';$('#prompt-editor-title').textContent='新建提示词策略';$('#prompt-form').scrollIntoView({behavior:'smooth'});};
$('#prompt-form').onsubmit=guard(async()=>{await api('/api/prompts',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData($('#prompt-form'))))});await loadLibrary();$('#prompt-form').reset();$('#prompt-form').elements.id.value='';toast('提示词已保存。既有实验的冻结版本不受影响。');});
$('#dataset-file').onchange=guard(async()=>{const file=$('#dataset-file').files[0];if(!file)return;if(file.size>2_000_000)throw new Error('文件超过2MB');$('#dataset-form').elements.content.value=await file.text();$('#dataset-form').elements.format.value=file.name.endsWith('.csv')?'csv':'json';if(!$('#dataset-form').elements.name.value)$('#dataset-form').elements.name.value=file.name.replace(/\.(json|csv)$/i,'');});
$('#dataset-form').onsubmit=guard(async()=>{const data=await api('/api/datasets',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData($('#dataset-form'))))});await loadLibrary();toast(`已校验导入 ${data.cases.length} 条样本，SHA256 ${data.hash.slice(0,12)}…`);});

/* ---------- 启动 ---------- */
await loadLibrary().catch(e=>toast(e.message));
await setupModelManager({api,guard,toast,reloadLibrary:loadLibrary}).catch(e=>toast(e.message));
await loadHistory().catch(e=>toast(e.message));
await loadLegacy().catch(e=>toast(e.message));
if(currentId)await loadRun().catch(e=>toast(e.message));
renderOverview().catch(()=>{});
setInterval(async()=>{if(current?.state.status==='running'){try{await loadRun();if(current.state.status!=='running'){await loadHistory();renderOverview().catch(()=>{});}}catch(e){toast(e.message);}}},1800);

// ---- Vision UI ----
(function visionUI(){
  const taskSel=document.getElementById('run-task-type');
  if(taskSel){
    taskSel.addEventListener('change',()=>applyTaskMode(true));
  }

  // Image upload
  const uploadBtn=document.getElementById('upload-assets-btn');
  if(uploadBtn){
    const MAX_FILE=20*1024*1024;
    uploadBtn.addEventListener('click',async()=>{
      const files=document.getElementById('asset-files')?.files;
      if(!files||!files.length){toast('请选择图片文件');return;}
      if(files.length>50||[...files].reduce((n,f)=>n+f.size,0)>100*1024*1024){toast('每批最多 50 张、合计 100MB');return;}
      const role=document.getElementById('asset-role')?.value||null;
      const results=[];
      for(const f of files){
        if(f.size>MAX_FILE){results.push({name:f.name,status:'fail',error:`超过 ${Math.round(MAX_FILE/1024/1024)}MB 限制`});continue;}
        try{
          const form=new FormData();
          form.append('file',f,f.name);
          if(role)form.append('role',role);
          const r=await fetch('/api/assets/upload',{method:'POST',body:form});
          const text=await r.text();
          let data;try{data=JSON.parse(text);}catch{data={error:text.slice(0,80)};}
          if(!r.ok){results.push({name:f.name,status:'fail',error:data.error||`HTTP ${r.status}`});continue;}
          results.push({name:f.name,status:data.deduplicated?'dedup':'ok',asset_id:data.asset_id});
        }catch(e){results.push({name:f.name,status:'fail',error:e.message});}
      }
      const ok=results.filter(x=>x.status==='ok'||x.status==='dedup').length;
      const fail=results.filter(x=>x.status==='fail');
      if(ok)toast(`已上传 ${ok} 张图片`);
      for(const f of fail)toast(`${f.name}: ${f.error}`);
      renderAssets();window.dispatchEvent(new Event('studio-assets-changed'));
    });
  }

  async function renderAssets(){
    try{
      const r=await api('/api/assets');
      const el=document.getElementById('asset-list');
      if(!el)return;
      el.textContent='';
      for(const a of r.assets){
        const card=document.createElement('div');card.className='prompt-card';card.style.maxWidth='200px';
        const img=document.createElement('img');img.src=`/api/assets/${a.asset_id}`;img.alt=a.filename;img.style.cssText='width:100%;border-radius:6px;object-fit:cover;max-height:120px';
        const name=document.createElement('p');name.className='mono';name.style.cssText='font-size:11px;margin:4px 0';name.textContent=a.filename;
        const info=document.createElement('p');info.className='mono';info.style.cssText='font-size:10px;color:#888';info.textContent=`${a.mime_type} · ${a.size_bytes}B`;
        const del=document.createElement('button');del.className='btn btn-danger btn-sm';del.textContent='删除';
        del.onclick=async()=>{try{await api(`/api/assets/${a.asset_id}`,{method:'DELETE'});renderAssets();}catch(e){toast(e.message);}};
        card.append(img,name,info,del);el.appendChild(card);
      }
    }catch(e){/* ignore */}
  }
  renderAssets();
})();

function renderCaseFilters(){
  for(const [id,key] of [['case-model','model'],['case-prompt','prompt'],['case-category','category']]){const input=$('#'+id),old=input.value;input.innerHTML='<option value="">全部</option>'+[...new Set(current.rows.map(r=>key==='category'?(r.human_review?.category||r.category||'通过'):r[key]))].map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');input.value=old;}
}
function renderVisionRun(a){
  const c=a.coverage;
  $('#metric-cards').innerHTML=[['矩阵覆盖',`${c.completed_cells}/${c.expected_cells}`,`缺失 ${c.missing_cells} · 重复 ${c.duplicate_cells}`],['可评分案例',`${c.eligible_unique_cases}/${c.total_unique_cases}`,`${c.scorable_cells} 个可评分单元`],['无效输出',c.invalid_output_cells,'格式错误与请求失败保留'],['整体稳定性',a.stability_status==='complete'?'重复组完整':'暂不可计算','稳定性不能替代准确率']].map(([l,v,t])=>`<div class="metric"><div class="label">${l}</div><div class="value">${v}</div><div class="caption">${t}</div></div>`).join('');
  $('#model-chart').innerHTML=a.summary.map(s=>`<div class="bar-row"><span>${esc(s.model)} · F1</span><div class="bar-track"><div class="bar-fill" style="width:${(s.micro_f1||0)*100}%"></div></div><strong>${pct(s.micro_f1)}</strong></div>`).join('');
  $('#sensitivity-chart').innerHTML=a.by_prompt.map(s=>`<div class="sensitivity-row"><span>${esc(s.model)}<br>${esc(s.prompt)}</span><div class="bar-track"><div class="bar-fill" style="width:${(s.micro_f1||0)*100}%"></div></div><strong>${pct(s.micro_f1)}</strong></div>`).join('');
  $('#ranking-note').textContent=a.note;
  $('#ranking-body').closest('table').querySelector('thead').innerHTML='<tr><th>模型</th><th>Micro P</th><th>Micro R</th><th>Micro F1</th><th>Macro F1</th><th>Exact Match</th><th>JSON合规</th><th>标签稳定性</th><th>强答 / 错拒</th></tr>';
  $('#ranking-body').innerHTML=a.summary.map(s=>`<tr><td>${esc(s.model)}<small>${s.count}/${s.expected_cells} 单元 · 可评分 ${s.scored_cases}</small></td><td>${pct(s.micro_precision)}</td><td>${pct(s.micro_recall)}</td><td>${pct(s.micro_f1)}</td><td>${pct(s.macro_f1)}</td><td>${pct(s.exact_match_rate)}</td><td>${pct(s.json_compliance_rate)}</td><td>${pct(s.label_stability)}</td><td>${pct(s.forced_answer_rate)} / ${pct(s.wrong_abstain_rate)}</td></tr>`).join('');
}
setupVisionWorkbench({api,toast,reload:loadLibrary,library:()=>lib});

$('#export-filtered-cases').onclick=()=>{const text=$('#case-search').value.toLowerCase(),rows=current.rows.filter(r=>(!$('#fail-only').checked||!r.success)&&(!$('#case-model').value||r.model===$('#case-model').value)&&(!$('#case-prompt').value||r.prompt===$('#case-prompt').value)&&(!$('#case-difficulty').value||r.difficulty===$('#case-difficulty').value)&&(!$('#case-category').value||(r.human_review?.category||r.category||'通过')===$('#case-category').value)&&(!$('#case-scoreable').value||String(Boolean(r._labelMetrics?.computable))===$('#case-scoreable').value)&&[r.case_id,r.model,r.prompt,r.output].join(' ').toLowerCase().includes(text));const url=URL.createObjectURL(new Blob([JSON.stringify({run_id:currentId,report_version:'1.2.0',count:rows.length,rows},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='filtered-cases.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

function applyTaskMode(reset=false){
  if(!lib)return;const vision=$('#run-task-type').value==='vision';
  const cards=$$('#model-choices .choice-card');
  for(const card of cards){const input=card.querySelector('input'),model=lib.models.find(m=>m.id===input.value),eligible=vision?model?.capabilities?.vision===true:!model?.id.startsWith('mock-vision-');card.hidden=!eligible;if(!eligible)input.checked=false;}
  if(vision&&!cards.some(c=>!c.hidden&&c.querySelector('input').checked))cards.filter(c=>!c.hidden&&c.querySelector('input').value.startsWith('mock-vision-')).forEach(c=>c.querySelector('input').checked=true);
  const matching=lib.datasets.filter(d=>(d.task_type==='vision')===vision),current=$('#run-dataset').value;
  if(!matching.some(d=>d.id===current))$('#run-dataset').value=matching[0]?.id||'';
  for(const card of $$('#dataset-choices .choice-card')){const input=card.querySelector('input'),eligible=matching.some(d=>d.id===input.value);card.hidden=!eligible;input.checked=input.value===$('#run-dataset').value;card.classList.toggle('checked',input.checked);}
  const candidateTask=lib.datasets.find(d=>d.id===$('#run-dataset').value)?.cases.some(c=>c.task_template==='differential')||false;
  let eligibleIndex=0;
  for(const card of $$('#prompt-choices .choice-card')){const input=card.querySelector('input'),prompt=lib.prompts.find(p=>p.id===input.value),eligible=(prompt?.task_type==='vision')===vision&&(!vision||(prompt.task_template==='differential')===candidateTask);card.hidden=!eligible;if(!eligible)input.checked=false;else if(reset)input.checked=eligibleIndex++<3;card.classList.toggle('checked',input.checked);}
  const visiblePrompts=$$('#prompt-choices .choice-card').filter(c=>!c.hidden);if(!visiblePrompts.some(c=>c.querySelector('input').checked))visiblePrompts.slice(0,3).forEach(c=>c.querySelector('input').checked=true);
  for(const card of cards)card.classList.toggle('checked',card.querySelector('input').checked);
  const hint=$('#prompt-mode-hint');hint.textContent=vision?'请使用视觉结构化输出策略。可在「数据集 → 视觉数据集与人工标注」按当前任务模板新增策略；候选鉴别诊断使用独立输出字段。':'';hint.hidden=!vision;
  matrix();
}

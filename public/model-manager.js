const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const providers = {kimi:'Kimi / Moonshot',qwen:'Qwen / 千问',deepseek:'DeepSeek',glm:'GLM / 智谱',openai:'OpenAI',anthropic:'Anthropic / Claude',custom:'自定义 API'};
// Editable examples, never an availability check or a fixed model version.
const modelExamples = {kimi:['moonshot-v1-8k'],qwen:['qwen-plus'],deepseek:['deepseek-chat'],glm:['glm-4-plus'],openai:['gpt-4.1-mini'],anthropic:['claude-sonnet-4-5'],custom:[]};
const fallbackPresets = [
  {provider:'kimi',protocol:'openai',base_url:'https://api.moonshot.cn/v1'},
  {provider:'qwen',protocol:'openai',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1'},
  {provider:'deepseek',protocol:'openai',base_url:'https://api.deepseek.com/v1'},
  {provider:'glm',protocol:'openai',base_url:'https://open.bigmodel.cn/api/paas/v4'},
  {provider:'openai',protocol:'openai',base_url:'https://api.openai.com/v1'},
  {provider:'anthropic',protocol:'anthropic',base_url:'https://api.anthropic.com/v1'},
  {provider:'custom',protocol:'openai',base_url:''}
];
const categories = {success:'连接成功',untested:'尚未测试',missing_key:'需要补充密钥',credential:'需要补充密钥',auth:'鉴权失败',authentication:'鉴权失败',authentication_error:'鉴权失败',model_not_found:'模型不存在',not_found:'模型或接口不存在',rate_limit:'请求限流',rate_limited:'请求限流',timeout:'请求超时',network:'网络异常',network_error:'网络异常',invalid_request:'请求参数错误',credential_missing:'需要补充密钥',invalid_response:'响应格式异常',protocol:'响应格式异常',configuration:'配置错误',ssrf:'地址不安全',redirect:'接口重定向已阻止',http:'服务商请求失败',upstream:'服务商错误',upstream_error:'服务商错误'};

export async function setupModelManager({api,guard,toast,reloadLibrary}) {
  let configs = [], presets = fallbackPresets, connections = [];
  const statuses = new Map();
  const form = $('#model-form');
  const el = name => form.elements.namedItem(name);
  function hideKey() {
    el('api_key').type = 'password';
    $('#show-model-key').textContent = '显示';
    $('#show-model-key').setAttribute('aria-pressed','false');
    $('#show-model-key').setAttribute('aria-label','临时显示 API Key');
  }
  function choosePreset(provider, resetModel = true) {
    const preset = presets.find(p => p.provider === provider) || fallbackPresets.find(p => p.provider === provider);
    el('protocol').value = preset?.protocol || 'openai';
    el('base_url').value = preset?.base_url || '';
    if(resetModel) el('model').value = '';
    $('#model-id-examples').innerHTML = (preset?.models || (preset?.model ? [preset.model] : modelExamples[provider] || [])).map(m => `<option value="${esc(typeof m === 'string' ? m : m.id)}"></option>`).join('');
    el('max_tokens_parameter').disabled = el('protocol').value === 'anthropic';
    el('temperature').max = el('protocol').value === 'anthropic' ? '1' : '2';
    el('send_temperature').value = 'true';
  }
  function resetEditor(scroll = false) {
    form.reset();el('id').value = '';hideKey();choosePreset(el('provider').value);
    $('#model-editor-title').textContent = '添加模型配置';
    $('#model-key-state').textContent = '新模型需要填写密钥才能调用';
    $('#frozen-credential-tools').hidden = true;
    if(scroll) $('#model-editor').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function edit(id) {
    const model = configs.find(m => m.id === id);if(!model)return;
    form.reset();hideKey();choosePreset(model.provider,false);
    for(const name of ['id','provider','protocol','model','base_url','temperature','max_tokens','input_price_per_million','output_price_per_million','max_tokens_parameter']) {
      if(el(name) && model[name] != null) el(name).value = model[name];
    }
    el('name').value = model.name || model.label;
    el('supports_tools').checked = model.supports_tools !== false;
    el('send_temperature').value = String(model.send_temperature !== false);
    el('max_tokens_parameter').disabled = model.protocol === 'anthropic';
    el('temperature').max = model.protocol === 'anthropic' ? '1' : '2';
    el('api_key').value = '';
    $('#model-editor-title').textContent = `编辑 ${model.name || model.label} · v${model.config_version}`;
    $('#model-key-state').textContent = model.ready ? `当前凭证 ${model.key_masked || '••••••••'} · 留空保留` : '当前会话没有此模型的密钥，请重新填写';
    $('#frozen-credential-tools').hidden = false;
    $('#restore-credential-id').innerHTML = (model.credential_history || [model.credential_id]).map((cid,index)=>`<option value="${esc(cid)}">${cid===model.credential_id?'当前版本':`历史版本 ${index+1}`} · ${esc(cid.slice(-10))}</option>`).join('');
    $('#restore-credential-id').value = model.credential_id;
    $('#model-editor').scrollIntoView({behavior:'smooth',block:'start'});el('name').focus({preventScroll:true});
  }
  function render() {
    $('#managed-model-list').innerHTML = configs.length ? configs.map(model => {
      const result = statuses.get(model.id) || model.connection_status;
      const status = typeof result === 'object' ? result : null;
      return `<article class="connection-card"><div class="connection-card-head"><span class="version">${esc(providers[model.provider] || model.provider)} / ${model.protocol === 'anthropic'?'MESSAGES':'CHAT'}</span>${model.is_default?'<span class="pill">默认模型</span>':''}</div><h3>${esc(model.name || model.label)}</h3><div class="model-id">${esc(model.model)}</div><p class="endpoint">${esc(model.base_url)}</p><div class="connection-meta"><span class="${model.ready?'pass':'fail'}">${model.ready?'凭证已就绪':'需要填写密钥'}</span><span>配置 v${model.config_version} · ${model.supports_tools === false?'不使用原生工具':'原生工具调用'}</span></div><p class="connection-result ${status?.ok?'pass-text':status?.ok===false?'error':''}" role="status">${status?`${esc(categories[status.category] || (status.ok?'连接成功':'连接失败'))} · ${esc(status.message || '')}${status.latency_ms != null?` / ${Math.round(status.latency_ms)} ms`:''}`:model.last_test?esc(model.last_test.message || '已有连接记录'):'尚未测试此配置'}</p><div class="connection-actions"><button type="button" class="button small" data-model-edit="${esc(model.id)}">编辑</button><button type="button" class="button small" data-model-test="${esc(model.id)}" ${model.ready?'':'disabled'}>测试连接 · 真实 API</button><button type="button" class="button small" data-model-default="${esc(model.id)}" ${model.is_default?'disabled':''}>设为默认</button><button type="button" class="button small danger" data-model-clear="${esc(model.id)}" ${model.ready?'':'disabled'}>删除凭证</button><button type="button" class="button small danger" data-model-delete="${esc(model.id)}">删除配置</button></div></article>`;
    }).join('') : '<div class="empty panel connection-empty"><span class="empty-icon">◈</span><h3>从一个可用模型开始</h3><p>选择服务商、填写 Model ID 和密钥。<br>同一家服务商的不同模型版本可以分别保存和比较。</p></div>';
    $$('[data-model-edit]').forEach(button => button.onclick = () => edit(button.dataset.modelEdit));
    $$('[data-model-test]').forEach(button => button.onclick = guard(async() => {
      const id = button.dataset.modelTest;button.disabled = true;button.textContent = '正在连接…';
      try {const result = await api(`/api/models/${encodeURIComponent(id)}/test`,{method:'POST',body:JSON.stringify({confirm_live:true})});statuses.set(id,result);await refresh();toast(result.message || categories[result.category] || '测试结束');}
      finally {if(button.isConnected){button.disabled = false;button.textContent = '测试连接 · 真实 API';}}
    }));
    $$('[data-model-default]').forEach(button => button.onclick = guard(async() => {
      await api(`/api/models/${encodeURIComponent(button.dataset.modelDefault)}/default`,{method:'POST',body:'{}'});await refresh();await reloadLibrary();toast('默认模型已更新。现有实验使用各自的冻结配置。');
    }));
    $$('[data-model-clear]').forEach(button => button.onclick = guard(async() => {
      const id = button.dataset.modelClear;
      if(!window.confirm('删除此模型在当前会话的凭证？配置和已完成实验会保留，实时复跑需重新填写密钥。'))return;
      await api(`/api/models/${encodeURIComponent(id)}/credential`,{method:'DELETE'});statuses.delete(id);await refresh();await reloadLibrary();if(el('id').value === id)edit(id);toast('凭证已删除；配置保留。');
    }));
    $$('[data-model-delete]').forEach(button => button.onclick = guard(async() => {
      const id = button.dataset.modelDelete;
      if(!window.confirm('删除这个模型配置及其凭证？已完成实验的冻结记录会保留。'))return;
      await api(`/api/models/${encodeURIComponent(id)}`,{method:'DELETE'});statuses.delete(id);if(el('id').value === id)resetEditor();await refresh();await reloadLibrary();toast('模型配置已删除。');
    }));
  }
  function renderConnections() {
    $('#integration-list').innerHTML = connections.map(connection => `<article class="integration-card"><div><span class="version">AGENTLAB / SAME MODEL</span><h3>${esc(connection.model_config?.name || connection.model_config?.model || connection.model_config_id)}</h3><p>${esc(connection.url)} · ${esc(connection.model_config?.model || '')}</p><p class="hint">Single / Multi 使用同一模型配置和实验预算。</p></div><button class="button small danger" type="button" data-integration-delete="${esc(connection.id)}">断开连接</button></article>`).join('');
    $$('[data-integration-delete]').forEach(button => button.onclick = guard(async() => {await api(`/api/integration/${encodeURIComponent(button.dataset.integrationDelete)}`,{method:'DELETE'});await refresh();await reloadLibrary();toast('已断开授权连接。');}));
  }
  async function refresh() {
    const data = await api('/api/models');configs = Array.isArray(data) ? data : data.models || [];presets = data.presets?.length ? data.presets : fallbackPresets;
    connections = (await api('/api/integration')).connections || [];render();renderConnections();
  }
  $('#new-model').onclick = () => resetEditor(true);
  $('#cancel-model-edit').onclick = () => resetEditor();
  el('provider').onchange = () => choosePreset(el('provider').value);
  el('protocol').onchange = () => {el('max_tokens_parameter').disabled = el('protocol').value === 'anthropic';el('temperature').max = el('protocol').value === 'anthropic' ? '1' : '2';};
  $('#show-model-key').onclick = () => {
    const shown = el('api_key').type === 'password';el('api_key').type = shown ? 'text' : 'password';
    $('#show-model-key').textContent = shown ? '隐藏' : '显示';$('#show-model-key').setAttribute('aria-pressed',String(shown));$('#show-model-key').setAttribute('aria-label',shown?'隐藏 API Key':'临时显示 API Key');
  };
  $('#restore-model-credential').onclick = guard(async()=>{
    if(!el('api_key').value.trim())throw new Error('请先在 API Key 输入框填写需要补充的密钥。');
    const id=el('id').value;
    try{await api(`/api/models/${encodeURIComponent(id)}/credential`,{method:'POST',body:JSON.stringify({api_key:el('api_key').value,credential_id:$('#restore-credential-id').value})});await refresh();await reloadLibrary();edit(id);toast('原凭证已补充，可返回实验复跑冻结配置。');}
    finally{el('api_key').value='';hideKey();}
  });
  form.onsubmit = guard(async() => {
    const submit = form.querySelector('[type="submit"]');submit.disabled = true;
    const data = Object.fromEntries(new FormData(form));const id = data.id;delete data.id;
    data.supports_tools = el('supports_tools').checked;data.send_temperature = el('send_temperature').value === 'true';
    for(const name of ['temperature','max_tokens','input_price_per_million','output_price_per_million'])data[name] = data[name] === '' ? null : Number(data[name]);
    if(!data.api_key)delete data.api_key;
    try {await api(id?`/api/models/${encodeURIComponent(id)}`:'/api/models',{method:id?'PATCH':'POST',body:JSON.stringify(data)});if(id)statuses.delete(id);resetEditor();await refresh();await reloadLibrary();toast('模型配置已保存，可以测试连接或加入实验。');}
    finally {el('api_key').value = '';hideKey();submit.disabled = false;}
  });
  $('#integration-form').onsubmit = guard(async() => {
    const integrationForm = $('#integration-form');const submit = integrationForm.querySelector('[type="submit"]');submit.disabled = true;
    try {await api('/api/integration/import',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(integrationForm)))});await refresh();await reloadLibrary();toast('授权已验证，Single / Multi 选项已加入实验模型列表。');}
    finally {integrationForm.elements.token.value = '';submit.disabled = false;}
  });
  document.addEventListener('visibilitychange',() => {if(document.hidden)hideKey();});
  $$('[data-view]').forEach(button => button.addEventListener('click',() => {hideKey();if(button.dataset.view === 'models')refresh().catch(error => toast(error.message));}));
  resetEditor();await refresh();
}

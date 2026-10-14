import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
process.env.STUDIO_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'studio-model-api-'));
const {createApp}=await import('../src/server.js');
const {DATA,atomic,runDir}=await import('../src/storage.js');
const {getCredential,deleteCredential}=await import('../src/credentials.js');
const {freezeConfig,promptfooConfig}=await import('../src/config.js');
const SECRET='fixture-secret-not-a-real-key-1234';
const fake=async(url,options)=>url.includes('/integration/model')?{model_config:{id:'agent-model-one',name:'Fixture bridge',provider:'custom',protocol:'openai',model:'fixture-model',base_url:'https://fixture.example/v1',config_version:2,credential_id:'agent-credential',supports_tools:false,temperature:0.2,max_tokens:200}}:options.headers['x-api-key']?{model:'fixture-model',content:[{type:'text',text:'OK'}],usage:{input_tokens:2,output_tokens:1}}:{model:'fixture-model',choices:[{message:{content:'OK'}}],usage:{prompt_tokens:2,completion_tokens:1}};
async function harness(transport=fake){const app=createApp({transport}),server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),base=`http://127.0.0.1:${server.address().port}`;return {server,client(){let cookie='';return {get cookie(){return cookie;},async request(url,method='GET',body){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body==null?{}:{body:JSON.stringify(body)})});cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;return {status:response.status,headers:response.headers,body:await response.json()};}};}};}
const modelBody={name:'Web Anthropic',provider:'anthropic',protocol:'anthropic',model:'fixture-model',base_url:'https://fixture.example/v1',temperature:0.2,max_tokens:200,supports_tools:false,send_temperature:false,max_tokens_parameter:'auto',api_key:SECRET};
test('web CRUD uses HttpOnly sessions, persists definitions without keys, restores frozen credentials, and isolates owners',async()=>{
 const h=await harness(),a=h.client(),b=h.client();try{
  const initial=await a.request('/api/models');assert.match(initial.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict/);assert.equal(initial.body.presets.length,7);
  assert.equal((await a.request('/api/models','POST',{...modelBody,temperature:1.1})).status,400);
  const created=await a.request('/api/models','POST',modelBody);assert.equal(created.status,201);const m=created.body;assert.equal(m.ready,true);assert.equal(m.max_tokens_parameter,'max_tokens');assert.ok(!JSON.stringify(m).includes(SECRET));
  assert.equal((await b.request('/api/models')).body.models.length,0);assert.equal((await b.request(`/api/models/${m.id}`,'PATCH',{name:'stolen'})).status,404);assert.equal((await b.request(`/api/models/${m.id}/test`,'POST',{confirm_live:true})).status,404);
  assert.equal((await a.request(`/api/models/${m.id}/test`,'POST',{})).status,400);const checked=await a.request(`/api/models/${m.id}/test`,'POST',{confirm_live:true});assert.equal(checked.body.ok,true);assert.equal(checked.body.input_tokens,2);
  const owner=crypto.createHash('sha256').update(a.cookie.split('=')[1]).digest('hex'),lib=(await a.request('/api/library')).body;
  const snapshot=freezeConfig({dataset_id:lib.datasets[0].id,prompt_ids:['direct'],model_ids:[m.id],confirm_live:true,repeats:1},lib,'run-web-freeze',owner);assert.equal(snapshot.models[0].temperature,0.2);assert.equal(snapshot.models[0].max_tokens,200);assert.equal(snapshot.models[0].send_temperature,false);assert.ok(!JSON.stringify(promptfooConfig(snapshot,'x')).includes(SECRET));
  const rotated=(await a.request(`/api/models/${m.id}`,'PATCH',{api_key:'second-fixture-key'})).body;assert.notEqual(rotated.credential_id,m.credential_id);assert.equal(getCredential(m.credential_id,owner),SECRET);
  assert.equal((await a.request(`/api/models/${m.id}/credential`,'DELETE')).status,200);assert.equal(getCredential(m.credential_id,owner),null);assert.equal(getCredential(rotated.credential_id,owner),null);
  const denied=await a.request(`/api/models/${m.id}/credential`,'POST',{credential_id:'foreign-credential',api_key:SECRET});assert.equal(denied.status,404);
  assert.equal((await a.request(`/api/models/${m.id}/credential`,'POST',{credential_id:m.credential_id,api_key:SECRET})).status,200);assert.equal(getCredential(m.credential_id,owner),SECRET);
  assert.equal((await a.request(`/api/models/${m.id}/credential`,'POST',{credential_id:m.credential_id,api_key:'overwrite-forbidden'})).status,409);assert.equal(getCredential(m.credential_id,owner),SECRET);
  deleteCredential(rotated.credential_id);assert.equal((await a.request('/api/models')).body.models[0].ready,false);
  const restored=(await a.request(`/api/models/${m.id}`,'PATCH',{api_key:SECRET})).body;assert.equal(restored.credential_id,rotated.credential_id);assert.equal(restored.ready,true);
  for(const file of [path.join(DATA,'model-definitions.json')])assert.ok(!fs.readFileSync(file,'utf8').includes(SECRET));
  assert.equal((await a.request(`/api/models/${m.id}/default`,'POST',{})).body.models[0].is_default,true);
 }finally{await new Promise(r=>h.server.close(r));}
});
test('every run route including exports, replay, cancel, and annotation rejects another session',async()=>{
 const h=await harness(),a=h.client(),b=h.client();try{
  await a.request('/api/models');await b.request('/api/models');const owner=crypto.createHash('sha256').update(a.cookie.split('=')[1]).digest('hex'),id='run-owner-fixture';
  atomic(path.join(runDir(id),'state.json'),{id,status:'complete',owner_hash:owner,created_at:new Date().toISOString()});atomic(path.join(runDir(id),'snapshot.json'),{settings:{repeats:1},total_cells:1});atomic(path.join(runDir(id),'rows.json'),[]);
  assert.equal((await b.request('/api/runs')).body.length,0);assert.equal((await a.request('/api/runs')).body.length,1);
  for(const [url,method] of [[`/api/runs/${id}`,'GET'],[`/api/runs/${id}/replay`,'POST'],[`/api/runs/${id}/cancel`,'POST'],[`/api/runs/${id}/rows/row-one`,'PATCH'],...['json','csv','markdown','config','raw'].map(f=>[`/api/runs/${id}/export/${f}`,'GET'])])assert.equal((await b.request(url,method,method==='GET'?null:{})).status,404,url);
 }finally{await new Promise(r=>h.server.close(r));}
});
test('connection tests classify errors and never return reflected credential or raw upstream body',async()=>{
 for(const category of ['authentication','not_found','rate_limit','timeout','network']){
  const h=await harness(async()=>{throw Object.assign(new Error(`safe ${category}`),{category});}),a=h.client();try{const model=(await a.request('/api/models','POST',modelBody)).body;const result=await a.request(`/api/models/${model.id}/test`,'POST',{confirm_live:true});assert.equal(result.body.category,category);assert.equal(result.body.ok,false);assert.ok(!JSON.stringify(result.body).includes(SECRET));}finally{await new Promise(r=>h.server.close(r));}
 }
});
test('AgentLab bridge validates a grant server-side, keeps token memory-only, and exposes only the bound model',async()=>{
 const h=await harness(),a=h.client(),b=h.client();try{
  assert.equal((await a.request('/api/integration/import','POST',{url:'http://192.168.1.1:8811',token:SECRET,model_config_id:'agent-model-one'})).status,400);
  const connection=(await a.request('/api/integration/import','POST',{url:'http://127.0.0.1:8811',token:SECRET,model_config_id:'agent-model-one'})).body;assert.ok(connection.id);assert.ok(!JSON.stringify(connection).includes(SECRET));assert.equal((await b.request('/api/integration')).body.connections.length,0);
  const lib=(await a.request('/api/library')).body,available=lib.models.filter(m=>m.model_config_id);assert.equal(available.length,2);assert.deepEqual(available.map(m=>m.agent_mode),['single','multi']);assert.equal(available[0].model,available[1].model);assert.equal(available[0].temperature,available[1].temperature);
  const owner=crypto.createHash('sha256').update(a.cookie.split('=')[1]).digest('hex');assert.throws(()=>freezeConfig({dataset_id:lib.datasets[0].id,prompt_ids:['direct'],model_ids:[available[0].id],timeout_ms:1000,confirm_live:true},lib,'run-short-agent-fixture',owner),/5000/);
  assert.equal((await b.request(`/api/integration/${connection.id}`,'DELETE')).status,404);assert.equal((await a.request(`/api/integration/${connection.id}`,'DELETE')).status,200);assert.equal((await a.request('/api/integration')).body.connections.length,0);
  assert.ok(!fs.readFileSync(path.join(DATA,'model-definitions.json'),'utf8').includes(SECRET));
 }finally{await new Promise(r=>h.server.close(r));}
});
test('legacy records migrate once to the primary session and environment credentials cannot be borrowed by another session',async()=>{
 const h=await harness(),a=h.client(),b=h.client();const previous={key:process.env.QWEN_API_KEY,live:process.env.STUDIO_ENABLE_LIVE};try{
  await a.request('/api/models');await b.request('/api/models');const owner=crypto.createHash('sha256').update(a.cookie.split('=')[1]).digest('hex');
  // Fixture changes the installation owner explicitly, never a production HTTP feature.
  atomic(path.join(DATA,'local-owner.json'),{owner_hash:owner});process.env.QWEN_API_KEY=SECRET;process.env.STUDIO_ENABLE_LIVE='1';
  const legacy='run-legacy-fixture';atomic(path.join(runDir(legacy),'state.json'),{id:legacy,status:'complete',created_at:new Date().toISOString()});
  assert.equal((await b.request('/api/legacy')).body.available,false);assert.equal((await b.request('/api/legacy/import','POST',{confirm:true})).status,404);
  assert.equal((await a.request('/api/legacy')).body.available,true);assert.equal((await a.request('/api/legacy/import','POST',{confirm:true})).body.imported,1);assert.equal((await a.request('/api/legacy/import','POST',{confirm:true})).body.imported,0);
  assert.ok((await a.request('/api/runs')).body.some(r=>r.id===legacy));assert.ok(!(await b.request('/api/runs')).body.some(r=>r.id===legacy));
  const lib=(await b.request('/api/library')).body;assert.equal(lib.models.find(m=>m.id==='live-qwen').ready,false);
  const denied=await b.request('/api/runs','POST',{dataset_id:lib.datasets[0].id,prompt_ids:['direct'],model_ids:['live-qwen'],confirm_live:true});assert.equal(denied.status,400);assert.match(denied.body.error,/首次本机会话/);
 }finally{if(previous.key==null)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=previous.key;if(previous.live==null)delete process.env.STUDIO_ENABLE_LIVE;else process.env.STUDIO_ENABLE_LIVE=previous.live;await new Promise(r=>h.server.close(r));}
});
test('malformed JSON errors use a static response and do not echo submitted credentials',async()=>{
 const h=await harness();try{const response=await fetch(`http://127.0.0.1:${h.server.address().port}/api/models`,{method:'POST',headers:{'Content-Type':'application/json'},body:`"${SECRET}"`});assert.equal(response.status,400);const result=await response.json();assert.equal(result.error,'请求 JSON 格式无效');assert.ok(!JSON.stringify(result).includes(SECRET));}finally{await new Promise(r=>h.server.close(r));}
});
test('a connection test completing after an edit does not mark the newer configuration as tested',async()=>{
 let started,release;const entered=new Promise(resolve=>started=resolve);const h=await harness(async()=>{started();return new Promise(resolve=>release=()=>resolve({model:'old',choices:[{message:{content:'OK'}}],usage:{prompt_tokens:1,completion_tokens:1}}));}),a=h.client();try{
  const model=(await a.request('/api/models','POST',{...modelBody,provider:'custom',protocol:'openai'})).body;
  const pending=a.request(`/api/models/${model.id}/test`,'POST',{confirm_live:true});await entered;
  const newer=(await a.request(`/api/models/${model.id}`,'PATCH',{model:'new-model',api_key:'new-key-version'})).body;release();const oldResult=await pending;assert.equal(oldResult.body.config_version,model.config_version);
  const current=(await a.request('/api/models')).body.models.find(m=>m.id===model.id);assert.equal(current.config_version,newer.config_version);assert.equal(current.last_test,undefined);assert.equal(current.connection_status.category,'untested');
 }finally{release?.();await new Promise(r=>h.server.close(r));}
});

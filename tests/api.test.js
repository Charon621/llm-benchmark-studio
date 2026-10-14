import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.STUDIO_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'studio-api-test-'));
const {app}=await import('../src/server.js');
const {recover,detail}=await import('../src/runner.js');
const {atomic,runDir}=await import('../src/storage.js');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('API end-to-end persists Promptfoo results, manual review, export, replay, cancellation and restart recovery',async()=>{
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 const base=`http://127.0.0.1:${server.address().port}`;
 let cookie='';async function request(url,method='GET',body){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});cookie=r.headers.get('set-cookie')?.split(';')[0]||cookie;const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
 try{
  const lib=await request('/api/library');assert.equal(lib.prompts.length,3);assert.equal(lib.models.filter(m=>m.kind==='chat').length,6);assert.ok(!JSON.stringify(lib).includes('Bearer'));
  const imported=await request('/api/datasets','POST',{name:'tiny',format:'json',content:JSON.stringify(lib.datasets[0].cases.slice(0,1))});
  const state=await request('/api/runs','POST',{name:'API_TEST_MOCK',dataset_id:imported.id,prompt_ids:['direct','structured','verify'],model_ids:['mock-kimi','mock-qwen'],repeats:2});
  let d;
  for(let i=0;i<150;i++){d=await request(`/api/runs/${state.id}`);if(d.state.status!=='running')break;await pause(100);}
  assert.equal(d.state.status,'complete');assert.equal(d.rows.length,12);assert.equal(d.state.completed,12);assert.equal(d.analysis.summary[0].total_cost_usd,null);
  const failed=d.rows.find(r=>!r.success);assert.ok(failed);assert.notEqual(failed.category,'请求失败');
  await request(`/api/runs/${state.id}/rows/${failed.id}`,'PATCH',{category:'其他',note:'API自动化复核测试'});
  d=await request(`/api/runs/${state.id}`);assert.equal(d.rows.find(r=>r.id===failed.id).human_review.note,'API自动化复核测试');
  assert.ok((await fetch(base+`/api/runs/${state.id}/export/csv`,{headers:{Cookie:cookie}})).ok);
  assert.equal((await request(`/api/runs/${state.id}/export/json`)).snapshot.id,state.id);
  const replay=await request(`/api/runs/${state.id}/replay`,'POST',{});assert.notEqual(replay.id,state.id);
  await request(`/api/runs/${replay.id}/cancel`,'POST',{});assert.equal((await request(`/api/runs/${replay.id}`)).state.status,'cancelled');
  const fake={...state,id:'run-recovery-test',status:'running'};atomic(path.join(runDir(fake.id),'state.json'),fake);recover();assert.equal(detail(fake.id).state.status,'interrupted');
  fs.writeFileSync(path.join(runDir(state.id),'ledger.json'),'{broken');assert.ok(detail(state.id).ledger_warning);assert.equal(detail(state.id).rows.length,12);
  const csrf=await fetch(base+'/api/prompts',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
 }finally{await new Promise(r=>server.close(r));}
});

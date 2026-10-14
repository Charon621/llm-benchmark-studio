import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import StudioProvider,{resetLedger,getLedger} from '../src/provider.js';
function config(base,extras={}) {return {model:{id:'local-http-fixture',kind:'chat',model:'LOCAL_HTTP_FIXTURE',base_url:base,key_env:'STUDIO_TEST_KEY'},retries:1,max_calls:5,deadline_at:Date.now()+10000,timeout_ms:1000,max_tokens:100,temperature:0,cost_budget_usd:null,...extras};}
test('local HTTP fixture tests real transport, retries and null-aware accounting without external model calls',async()=>{
  resetLedger();let calls=0;
  const server=http.createServer((req,res)=>{calls++;if(calls===1){res.writeHead(429);res.end('reflected-secret-must-not-log');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'LOCAL_HTTP_FIXTURE',system_fingerprint:'local-test',choices:[{message:{content:'fixture answer'}}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.STUDIO_TEST_KEY='local-test-placeholder';
  try {const p=new StudioProvider({config:config(`http://127.0.0.1:${server.address().port}`)});const r=await p.callApi('hello',{vars:{case_id:'x'}});assert.equal(r.output,'fixture answer');assert.equal(r.metadata.input_tokens,4);assert.equal(r.metadata.cost_usd,null);assert.equal(r.metadata.model_returned,'LOCAL_HTTP_FIXTURE');assert.equal(getLedger().attempts,2);assert.ok(!JSON.stringify(getLedger()).includes('reflected-secret'));}
  finally{delete process.env.STUDIO_TEST_KEY;await new Promise(r=>server.close(r));}
});
test('all retries consume call budget and terminal HTTP 400 does not retry',async()=>{
  resetLedger();const server=http.createServer((req,res)=>{res.writeHead(400);res.end('no');});await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.STUDIO_TEST_KEY='local-test-placeholder';
  try{const p=new StudioProvider({config:config(`http://127.0.0.1:${server.address().port}`,{max_calls:1})});assert.match((await p.callApi('hello')).error,/400/);assert.match((await p.callApi('hello')).error,/预算/);assert.equal(getLedger().attempts,1);}
  finally{delete process.env.STUDIO_TEST_KEY;await new Promise(r=>server.close(r));}
});
test('concurrent requests reserve known cost before network dispatch',async()=>{
  resetLedger();let calls=0;const server=http.createServer((req,res)=>{calls++;setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}}));},60);});await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.STUDIO_TEST_KEY='local-test-placeholder';
  try{const cfg=config(`http://127.0.0.1:${server.address().port}`,{cost_budget_usd:0.0012});cfg.model.input_price_per_million=1;cfg.model.output_price_per_million=1;const p=new StudioProvider({config:cfg});const results=await Promise.all([p.callApi('hello'),p.callApi('hello')]);assert.equal(calls,1);assert.equal(results.filter(r=>r.error).length,1);}
  finally{delete process.env.STUDIO_TEST_KEY;await new Promise(r=>server.close(r));}
});

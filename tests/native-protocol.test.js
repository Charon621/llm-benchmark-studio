import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import StudioProvider,{resetLedger,getLedger} from '../src/provider.js';
import {putCredential,deleteCredential} from '../src/credentials.js';
import {fixtureTransport} from './fixture-transport.js';
process.env.PROMPTFOO_DISABLE_TELEMETRY='1';process.env.PROMPTFOO_DISABLE_UPDATE='1';process.env.PROMPTFOO_DISABLE_SHARING='1';process.env.PROMPTFOO_CACHE_ENABLED='false';
test('native Promptfoo evaluate runs a mixed OpenAI and Anthropic multi-select matrix over real fixture HTTP requests',async()=>{
 resetLedger();let requests=0;const keys=['fixture-openai-key','fixture-anthropic-key'];
 const server=http.createServer((request,response)=>{let data='';request.on('data',chunk=>data+=chunk);request.on('end',()=>{requests++;const body=JSON.parse(data);assert.equal(body.model,'LOCAL_PROTOCOL_FIXTURE');assert.equal(body.max_tokens,60);response.setHeader('Content-Type','application/json');if(request.url.endsWith('/messages')){assert.equal(request.headers['x-api-key'],keys[1]);assert.equal(request.headers['anthropic-version'],'2023-06-01');assert.ok(body.system);assert.equal(body.messages[0].role,'user');response.end(JSON.stringify({model:body.model,content:[{type:'text',text:'OK fixture'}],usage:{input_tokens:5,output_tokens:2}}));}else{assert.equal(request.headers.authorization,`Bearer ${keys[0]}`);assert.equal(body.messages[0].role,'system');response.end(JSON.stringify({model:body.model,choices:[{message:{content:'OK fixture'}}],usage:{prompt_tokens:5,completion_tokens:2}}));}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const providers=['openai','anthropic'].map((protocol,index)=>{putCredential(`protocol-${protocol}`,null,keys[index]);return new StudioProvider({transport:(url,options)=>fixtureTransport(base+new URL(url).pathname,options),config:{model:{id:`fixture-${protocol}`,kind:'chat',provider:protocol,protocol,model:'LOCAL_PROTOCOL_FIXTURE',base_url:'https://fixture.invalid/v1',credential_id:`protocol-${protocol}`,temperature:0,max_tokens:60,supports_tools:false},retries:0,max_calls:20,deadline_at:Date.now()+30000,timeout_ms:1000,cost_budget_usd:null}});});
  const {evaluate}=await import('promptfoo');const record=await evaluate({description:'LOCAL PROTOCOL FIXTURE',sharing:false,prompts:[{label:'one',raw:'first {{question}}'},{label:'two',raw:'second {{question}}'}],providers,tests:['a','b'].flatMap(question=>[0,1].map(repeat_index=>({vars:{question,repeat_index},assert:[{type:'contains',value:'OK'}]}))),evaluateOptions:{maxConcurrency:2,cache:false,showProgressBar:false}},{cache:false,sharing:false,writeLatestResults:false});
  const summary=await record.toEvaluateSummary();assert.equal(summary.results.length,16);assert.equal(requests,16);assert.equal(summary.results.filter(r=>r.success).length,16);assert.equal(getLedger().attempts,16);assert.ok(!JSON.stringify(summary).includes(keys[0]));assert.ok(!JSON.stringify(summary).includes(keys[1]));assert.ok(summary.results.every(r=>r.response.metadata.input_tokens===5&&r.response.metadata.cost_usd===null));
 }finally{for(const protocol of ['openai','anthropic'])deleteCredential(`protocol-${protocol}`);await new Promise(r=>server.close(r));}
});

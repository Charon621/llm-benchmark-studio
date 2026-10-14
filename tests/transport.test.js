import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {publicAddress,endpoint,makeRequest,normalizeResponse,requestJSON,callModel} from '../src/transport.js';
test('SSRF rejects private/link-local/loopback, mapped IPv6, reserved IPv6, HTTP and URL credentials',async()=>{
 for(const address of ['127.0.0.1','10.1.1.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1','2001::1','2001:0000::1','2001:2::1','2001:10::1','2001:db8::1','2002:7f00:1::'])assert.equal(publicAddress(address),false,address);
 for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicAddress(address),true,address);
 for(const url of ['http://example.com/v1','https://localhost/v1','https://user:password@example.com/v1','https://169.254.169.254/v1','https://api.example.com/v1?key=secret'])assert.throws(()=>endpoint(url));
 await assert.rejects(requestJSON('https://api.fixture.example/v1',{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]}),e=>e.category==='ssrf');
});
test('DNS pinning preserves HTTPS hostname and rejects redirects without following them',async()=>{
 const original=https.request;let resolved=0,requests=0,seen;
 https.request=(url,options,callback)=>{requests++;seen={url,options};const request=new EventEmitter();request.write=()=>{};request.destroy=()=>request.emit('close');request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=302;response.resume=()=>{};callback(response);request.emit('close');});return request;};
 try{await assert.rejects(requestJSON('https://api.fixture.example/v1',{lookup:async()=>{resolved++;return [{address:'8.8.8.8',family:4}];}}),e=>e.category==='redirect');assert.equal(requests,1);assert.equal(resolved,1);assert.equal(seen.url.hostname,'api.fixture.example');seen.options.lookup('api.fixture.example',{},(error,address,family)=>{assert.equal(address,'8.8.8.8');assert.equal(family,4);});}finally{https.request=original;}
});
test('protocols map headers, system, reasoning controls, tool calls and validated usage without guessing',async()=>{
 const base={model:'fixture-model',base_url:'https://api.fixture.example/v1',temperature:0,max_tokens:90,supports_tools:true};
 const open=makeRequest({...base,protocol:'openai',send_temperature:false,max_tokens_parameter:'max_completion_tokens'},'hello');assert.equal(open.body.max_completion_tokens,90);assert.ok(!('temperature'in open.body));assert.equal(open.body.messages[0].role,'system');
 const anthropic=makeRequest({...base,protocol:'anthropic'},'hello',{tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}]});assert.equal(anthropic.body.messages[0].role,'user');assert.ok(anthropic.body.system);assert.equal(anthropic.headers['anthropic-version'],'2023-06-01');assert.equal(anthropic.body.tools[0].name,'lookup');
 assert.throws(()=>makeRequest({...base,supports_tools:false},'hello',{tools:[{name:'lookup'}]}),/工具能力/);
 const tool=normalizeResponse({protocol:'openai'},{choices:[{message:{content:null,tool_calls:[{id:'call',type:'function',function:{name:'lookup',arguments:'{}'}}]}}],usage:{prompt_tokens:2,completion_tokens:3}});assert.equal(tool.output,'');assert.equal(tool.tool_calls.length,1);assert.equal(tool.output_tokens,3);
 const cached=normalizeResponse({protocol:'anthropic'},{content:[{type:'text',text:'OK'}],usage:{input_tokens:3,cache_read_input_tokens:40,cache_creation_input_tokens:7,output_tokens:2}});assert.equal(cached.input_tokens,50);assert.equal(cached.cache_pricing_unknown,true);
 const invalid=normalizeResponse({protocol:'openai'},{choices:[{message:{content:'OK'}}],usage:{prompt_tokens:-1,completion_tokens:'7'}});assert.equal(invalid.input_tokens,null);assert.equal(invalid.output_tokens,null);
 const result=await callModel({...base,protocol:'anthropic'},'fixture-secret','hello',{},async(url,options)=>{assert.equal(options.headers['x-api-key'],'fixture-secret');assert.ok(!options.headers.Authorization);return {model:'fixture-secret',content:[{type:'text',text:'fixture-secret'}],usage:{input_tokens:2,output_tokens:1}};});assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

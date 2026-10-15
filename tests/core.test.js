import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importDataset,validateCases } from '../src/datasets.js';
import { analyze,normalize,csv } from '../src/analysis.js';
import { freezeConfig,promptfooConfig } from '../src/config.js';
import { ROOT,hash } from '../src/storage.js';
const cases=validateCases(JSON.parse(fs.readFileSync(path.join(ROOT,'examples/research-cases.json'),'utf8')));
const lib={datasets:[{id:'test',version:1,cases}],prompts:['a','b','c'].map(id=>({id,version:1,content:`${id} {{question}}`,name:id}))};
test('CSV/JSON import validates duplicates, required reference, facts and JSON structure',()=>{
  const csvContent=fs.readFileSync(path.join(ROOT,'examples/import-example.csv'),'utf8');
  assert.equal(importDataset({name:'test',format:'csv',content:csvContent}).cases.length,2);
  assert.equal(importDataset({name:'test',format:'json',content:JSON.stringify(cases)}).cases.length,12);
  assert.throws(()=>validateCases([cases[0],cases[0]]),/重复/);
  assert.throws(()=>validateCases([{id:'x',question:'q',facts:['x']}]),/参考答案/);
  assert.throws(()=>validateCases([{...cases[0],assertions:[{type:'javascript',value:'process.exit()'}]}]),/安全/);
  assert.throws(()=>validateCases([{...cases[0],expect_json:true,reference:'[]'}]),/JSON参考/);
});
test('snapshot freezes matrix, data/prompt hashes and repeat vars do not auto-expand arrays',()=>{
  const s=freezeConfig({dataset_id:'test',prompt_ids:['a','b','c'],model_ids:['mock-kimi','mock-qwen'],repeats:2},lib,'run-test');
  assert.equal(s.total_cells,144);assert.equal(s.dataset_hash,hash(cases));
  const cfg=promptfooConfig(s,'temporary');assert.equal(cfg.tests.length,24);assert.equal(cfg.prompts.length,3);assert.equal(cfg.providers.length,2);
  assert.equal(cfg.evaluateOptions.cache,false);assert.equal(typeof cfg.tests[0].vars.fact_terms_json,'string');
  const json=cfg.tests.find(t=>t.vars.case_id==='R03').assert.find(a=>a.type==='is-json');assert.deepEqual(json.value.required,['status','answer']);
  const before=s.prompts[0].content;lib.prompts[0].content+=' edit';assert.equal(s.prompts[0].content,before);
});
test('native assertion failures remain evaluation failures, not request errors',()=>{
  const r=normalize({success:false,failureReason:1,error:'Assertion failed',testCase:{vars:{case_id:'X'}},response:{output:'wrong'},gradingResult:{componentResults:[{pass:false,score:0,assertion:{metric:'reference_terms'}}]}});
  assert.equal(r.error,null);assert.equal(r.category,'事实词缺失');assert.equal(r.output,'wrong');assert.equal(r.success,false);
});
test('Judge infrastructure failures are visible and excluded from judge quality denominator',()=>{
  const r=normalize({success:false,testCase:{vars:{}},response:{output:'a'},gradingResult:{componentResults:[{pass:false,score:0,reason:'[STUDIO_EVALUATION_ERROR] 调用预算已耗尽',assertion:{metric:'judge_quality'}}]}});
  assert.equal(r.category,'评估失败');assert.equal(r.judge_score,null);assert.equal(analyze([r]).summary[0].pass_rate,null);
});
test('unknown cost/tokens stay null, missing weighted dimensions exclude ranking, incomplete repeats have no stability',()=>{
  const row={model:'a',case_id:'1',prompt:'a',repeat_index:0,success:true,output:'same',latency_ms:20,input_tokens:null,output_tokens:null,cost_usd:null};
  const rows=[row,{...row,repeat_index:1}];
  let a=analyze(rows,{cost:10},2).summary[0];assert.equal(a.total_cost_usd,null);assert.equal(a.total_tokens,null);assert.equal(a.weighted_score,null);assert.equal(a.stability,1);
  a=analyze(rows,{cost:0},3).summary[0];assert.equal(a.stability,null);assert.equal(a.weighted_score,null);
  assert.ok(analyze(rows,{},2).summary[0].weighted_score>0);
  assert.match(csv([{...row,output:'line1\n"line2"'}]),/""line2""/);
});
test('live runs are explicitly gated without reading or transmitting secrets',()=>{
  const old=process.env.STUDIO_ENABLE_LIVE;delete process.env.STUDIO_ENABLE_LIVE;
  assert.throws(()=>freezeConfig({dataset_id:'test',prompt_ids:['a'],model_ids:['live-qwen']},lib,'run-live'),/未启用|原会话/);
  if(old!=null)process.env.STUDIO_ENABLE_LIVE=old;
});
test('completed repeat groups cannot hide completely unstarted cells in a partial matrix',()=>{
  const rows=[0,1].map(repeat_index=>({model:'a',case_id:'first-only',prompt:'direct',repeat_index,success:true,output:'same',latency_ms:10,cost_usd:null}));
  const partial=analyze(rows,{},2,8).summary[0];assert.equal(partial.stability,null);assert.equal(partial.weighted_score,null);
  assert.equal(analyze(rows,{},2,2).summary[0].stability,1);
});

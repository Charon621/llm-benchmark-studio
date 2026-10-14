import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROMPTFOO_DISABLE_TELEMETRY='1';process.env.PROMPTFOO_DISABLE_UPDATE='1';process.env.PROMPTFOO_CONFIG_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'benchmark-promptfoo-'));
const {evaluate,assertions}=await import('promptfoo');
const {freezeConfig,promptfooConfig}=await import('../src/config.js');
const {validateCases}=await import('../src/datasets.js');
const {normalize,analyze}=await import('../src/analysis.js');
const {ROOT}=await import('../src/storage.js');
test('real Promptfoo evaluates full matrix and reports native reference + JSON assertions',async()=>{
  const cases=validateCases(JSON.parse(fs.readFileSync(path.join(ROOT,'examples/research-cases.json'),'utf8'))).filter(c=>['R01','R03'].includes(c.id));
  const lib={datasets:[{id:'tiny',cases,version:1}],prompts:[{id:'direct',name:'Direct',version:1,content:'请研究以下问题并简明回答：{{question}}'},{id:'structured',name:'Structured',version:1,content:'结构化回答：{{question}}'},{id:'verify',name:'Verify',version:1,content:'交叉核查：{{question}}'}]};
  const snapshot=freezeConfig({dataset_id:'tiny',prompt_ids:['direct','structured','verify'],model_ids:['mock-kimi','mock-qwen'],repeats:2},lib,'run-test');
  const cfg=promptfooConfig(snapshot,process.env.PROMPTFOO_CONFIG_DIR);const record=await evaluate(cfg,{cache:false,sharing:false,writeLatestResults:false});const raw=await record.toEvaluateSummary();
  assert.equal(raw.results.length,24);const rows=raw.results.map(normalize);assert.ok(rows.some(r=>r.success));assert.ok(rows.some(r=>!r.success));assert.ok(rows.every(r=>r.error===null));assert.ok(rows.filter(r=>r.case_id==='R03').some(r=>r.json_pass===false));
  const a=analyze(rows,{},2);assert.equal(a.summary.length,2);assert.equal(a.summary.find(m=>m.model==='mock-kimi').stability,1);assert.ok(a.summary.find(m=>m.model==='mock-qwen').stability<1);
});
test('Promptfoo native JSON schema rejects wrong fields even when fact words appear',async()=>{
  const r=await assertions.runAssertion({assertion:{type:'is-json',value:{type:'object',required:['status','answer'],properties:{status:{type:'string'},answer:{type:'string'}},additionalProperties:false}},test:{vars:{}},providerResponse:{output:'{"wrong":"100 101.325"}'}});assert.equal(r.pass,false);
});

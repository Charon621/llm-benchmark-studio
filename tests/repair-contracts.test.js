import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {zipSync,strToU8} from 'fflate';
import {createApp} from '../src/server.js';
import {DATA,library,saveLibrary,hash,primaryOwner} from '../src/storage.js';
import {importImage,getAssetMeta,readAssetBytes,claimAsset,deleteAsset,recoverAsset} from '../src/assets.js';
import {freezeConfig,promptfooConfig} from '../src/config.js';
import {visionAnalyze,dispatchAnalyze,csv,markdown} from '../src/analysis.js';
import {parseVisionOutput,computeLabelMetrics} from '../src/vision-metrics.js';
import {canScoreAccuracy} from '../src/vision-schema.js';
import {validateLexicon} from '../src/lexicon.js';
import {exportBundle,importBundle,inspectZip} from '../src/bundles.js';
import {validateSearchSnapshot} from '../src/search-replay.js';
const png=await sharp({create:{width:8,height:8,channels:3,background:'#ce978a'}}).png().toBuffer();
const output=JSON.stringify({observed_features:['脱毛'],description:'合成夹具',abstain:false,abstain_reason:'',missing_information:[]});
const caseOf=id=>({id,question:'合成图片描述',task_type:'vision',difficulty:'medium',images:[],ground_truth:{lesion_labels:['脱毛'],label_completeness:'complete',answerability:'answerable'},annotation:{source:'human',review_status:'reviewed'}});
async function fixture(){const app=createApp(),server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))}),base=`http://127.0.0.1:${server.address().port}`;
  const client=()=>{let cookie='';return {async request(url,method='GET',body){const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});cookie=res.headers.get('set-cookie')?.split(';')[0]||cookie;return {status:res.status,body:await res.json()}}}};return {server,client,close:()=>new Promise(r=>server.close(r))};}
test('all image paths, dataset import, freeze and recovery enforce owners including shared SHA',async()=>{
 const h=await fixture(),a=h.client(),b=h.client();try{
  const img=(await a.request('/api/assets','POST',{filename:'synthetic.png',base64:png.toString('base64')})).body;
  assert.ok(img.asset_id);assert.equal((await b.request('/api/assets/'+img.asset_id+'/meta')).status,404);
  assert.equal((await b.request('/api/assets/'+img.asset_id+'/claim','POST',{})).status,403);
  assert.equal((await b.request('/api/assets/'+img.asset_id+'/recover','POST',{})).status,404);
  const c={...caseOf('foreign'),images:[{asset_id:img.asset_id,role:'overview'}]};
  assert.equal((await b.request('/api/datasets','POST',{name:'foreign',cases:[c]})).status,404);
  const ds=await a.request('/api/datasets','POST',{name:'own',cases:[c]});assert.equal(ds.status,200);
  assert.equal((await a.request('/api/assets/'+img.asset_id,'DELETE')).status,409);
  await b.request('/api/assets','POST',{filename:'own-copy.png',base64:png.toString('base64')});
  assert.equal((await b.request('/api/assets/'+img.asset_id,'DELETE')).status,200);
  assert.equal((await a.request('/api/assets/'+img.asset_id+'/meta')).status,200);
  assert.equal((await b.request('/api/assets/'+img.asset_id+'/recover','POST',{})).status,200);
  assert.equal((await b.request('/api/assets/'+img.asset_id+'/meta')).status,200);
  const bad=await a.request('/api/assets','POST',{filename:'truncated.png',base64:png.subarray(0,24).toString('base64')});assert.equal(bad.status,400);
 }finally{await h.close()}
});
test('freeze and worker config reject foreign images even with fabricated library; own image round-trips',async()=>{
 const owner='freeze-owner',foreign='freeze-foreign',img=await importImage({buffer:png,filename:'local.png'},owner);
 const c={...caseOf('c'),images:[{asset_id:img.asset_id,role:'overview'}]},lib={datasets:[{id:'v',task_type:'vision',cases:[c]}],prompts:[{id:'p',version:1,content:'{{question}}'}]},input={dataset_id:'v',prompt_ids:['p'],model_ids:['mock-vision-kimi'],repeats:2};
 assert.throws(()=>freezeConfig(input,lib,'run-foreign',foreign),/不存在/);
 const snapshot=freezeConfig(input,lib,'run-own',owner);
 assert.throws(()=>promptfooConfig(snapshot,'unused',foreign),/不存在|Cannot/);
 assert.ok(promptfooConfig(snapshot,'unused',owner).tests[0].vars.images_json.includes('base64'));
});
test('pending/model-origin/incomplete/differential annotation cannot yield accuracy; malformed outputs stay invalid',()=>{
 const c=caseOf('c');assert.equal(canScoreAccuracy(c),true);
 for(const annotation of [{source:'human',review_status:'pending'},{source:'model',review_status:'reviewed'},null])assert.equal(canScoreAccuracy({...c,annotation}),false);
 assert.equal(canScoreAccuracy({...c,task_template:'differential'}),false);
 for(const value of ['{}','[]',JSON.stringify({observed_features:'脱毛',description:'x',abstain:false,missing_information:[]}),JSON.stringify({observed_features:[],description:'x',abstain:'false',missing_information:[]})])assert.equal(parseVisionOutput(value).valid,false);
 const m=computeLabelMetrics([],[],{complete:true});assert.equal(m.f1,null);assert.equal(m.exact_match,1);
});
test('full frozen matrix includes unstarted models and groups; duplicates never manufacture stability',()=>{
 const snapshot={task_type:'vision',settings:{repeats:2},models:[{id:'m'},{id:'unstarted'}],prompts:[{id:'p',version:1},{id:'other',version:1}],dataset:{cases:[caseOf('c'),caseOf('missing')]},total_cells:16};
 const rows=[0,1].map(repeat_index=>({id:'r'+repeat_index,case_id:'c',model:'m',prompt:'p@v1',repeat_index,output,success:true}));
 const analysis=visionAnalyze(rows,{},snapshot);assert.equal(analysis.coverage.expected_cells,16);assert.equal(analysis.coverage.missing_cells,14);assert.equal(analysis.summary.length,2);assert.equal(analysis.summary[0].label_stability,null);assert.equal(analysis.summary[1].micro_f1,null);assert.equal(analysis.summary[0].partial_label_stability,1);
 const duplicate=visionAnalyze([rows[0],{...rows[0],id:'duplicate'}],{},{...snapshot,models:[{id:'m'}],prompts:[{id:'p',version:1}],dataset:{cases:[caseOf('c')]}});
 assert.equal(duplicate.coverage.completed_cells,1);assert.equal(duplicate.coverage.duplicate_cells,1);assert.equal(duplicate.summary[0].label_stability,null);
 const invalid=visionAnalyze([{...rows[0],output:'{}'}],{},snapshot);assert.equal(invalid.coverage.scorable_cells,0);assert.equal(invalid.summary[0].micro_f1,null);
});
test('API analysis/export context shares visual numbers and separates manual review',()=>{
 const snapshot={id:'run-report',name:'synthetic',created_at:new Date().toISOString(),execution_mode:'mock',task_type:'vision',settings:{repeats:1},models:[{id:'m'}],prompts:[{id:'p',version:1}],dataset:{cases:[caseOf('c')]},total_cells:1};
 const rows=[{id:'r',case_id:'c',model:'m',prompt:'p@v1',repeat_index:0,output,success:true,category:'auto',human_review:{category:'其他',note:'人工说明'}}];
 const a=dispatchAnalyze(rows,snapshot);assert.equal(a.summary[0].micro_f1,1);assert.match(csv(rows,snapshot),/vision_f1/);assert.match(csv(rows,snapshot),/脱毛/);assert.match(markdown(snapshot,rows,a),/Micro F1/);assert.match(markdown(snapshot,rows,a),/人工说明/);assert.equal(rows[0].category,'auto');
 const text=dispatchAnalyze([{model:'m',success:true,latency_ms:20,cost_usd:null}],{settings:{repeats:1},total_cells:1},{quality:'0',speed:'100',cost:'0',stability:'0'});assert.equal(text.weights.speed,100);assert.equal(text.weights.quality,0);
});
test('versioned lexicon rejects ambiguous aliases and ZIP round-trip preserves cases/roles without credentials',async()=>{
 assert.throws(()=>validateLexicon({version:'1',labels:['A','B'],synonyms:{A:['alias'],B:['alias']}}),/冲突/);
 const owner='zip-source',target='zip-target',img=await importImage({buffer:png,filename:'source.png'},owner);
 const c={...caseOf('zip-case'),images:[{asset_id:img.asset_id,role:'closeup'}]},lex=validateLexicon({version:'custom-v1',labels:['脱毛'],synonyms:{},review_status:'reviewed',source:'human'});
 const ds={id:'source-ds',name:'zip dataset',task_type:'vision',version:4,cases:[c],label_lexicon:lex,hash:hash([c])};
 saveLibrary({datasets:[ds],prompts:[{id:'source-p',version:3,name:'prompt',content:'describe {{question}}',task_type:'vision',task_template:'lesion'}]},owner);
 saveLibrary({datasets:[],prompts:[]},target);
 const before=hash(library(owner)),zip=exportBundle({dataset_ids:[ds.id],prompt_ids:['source-p'],include_images:true},owner);
 const files=inspectZip(zip);assert.equal(Object.keys(files).length,2);const preview=await importBundle(zip,target,{dryRun:true});assert.equal(preview.datasets,1);assert.equal(library(target).datasets.length,0);
 const imported=await importBundle(zip,target);const copy=library(target).datasets.find(d=>d.id===imported.mapping.datasets[ds.id]);assert.deepEqual(copy.cases,[c]);assert.equal(copy.label_lexicon.sha256,lex.sha256);assert.equal(library(target).prompts[0].task_type,'vision');assert.equal(library(target).prompts[0].task_template,'lesion');assert.ok(readAssetBytes(img.asset_id,target).equals(png));assert.equal(hash(library(owner)),before);
 await importBundle(zip,target);assert.equal(library(target).datasets.length,2);assert.equal(hash(library(owner)),before);
 const manifest=JSON.parse(files['manifest.json']);assert.ok(!JSON.stringify(manifest).includes('credential_id'));
 // Metadata-only import cannot grant access to an image already owned by someone else.
 const metadataOnly=exportBundle({dataset_ids:[ds.id],prompt_ids:[],include_images:false},owner);await assert.rejects(importBundle(metadataOnly,'foreign-target'),/不存在/);
});
test('ZIP preflight rejects traversal, duplicate files, corrupted bytes, hash mismatch and oversized expansion',async()=>{
 for(const name of ['../outside','/absolute','C:/absolute','images/../../escape','images\\escape'])assert.throws(()=>inspectZip(Buffer.from(zipSync({[name]:strToU8('x')}))));
 const owner='bad-zip',img=await importImage({buffer:png,filename:'valid.png'},owner),c={...caseOf('c'),images:[{asset_id:img.asset_id,role:'overview'}]};saveLibrary({datasets:[{id:'d',name:'d',cases:[c],task_type:'vision',version:1}],prompts:[]},owner);
 const valid=exportBundle({dataset_ids:['d'],prompt_ids:[],include_images:true},owner),files=inspectZip(valid),manifest=JSON.parse(files['manifest.json']);manifest.datasets[0].cases[0].question='tampered';files['manifest.json']=strToU8(JSON.stringify(manifest));
 const before=hash(library(owner));await assert.rejects(importBundle(Buffer.from(zipSync(files,{level:0})),owner),/哈希/);assert.equal(hash(library(owner)),before);
 const corrupt=Buffer.from(valid);corrupt[50]^=1;assert.throws(()=>inspectZip(corrupt));
 assert.throws(()=>inspectZip(Buffer.from(zipSync({'manifest.json':new Uint8Array(1_000_000)},{level:9}))),/压缩比/);
 assert.throws(()=>inspectZip(Buffer.from(zipSync({'manifest.json':[strToU8('{}'),{os:3,attrs:0xa000<<16}]}))),/符号链接/);
});
test('retrieval snapshots reject drift and differential outputs have a separate schema without label F1',()=>{
 const body={entries:{q:[]},miss_policy:'empty_offline',provenance:'synthetic',schema_version:'1.0'},sha256=hash(body);
 assert.equal(validateSearchSnapshot({...body,sha256}).sha256,sha256);
 assert.throws(()=>validateSearchSnapshot({...body,entries:{changed:[]},sha256}),/哈希/);
 const differential=JSON.stringify({description:'尚待验证',abstain:false,abstain_reason:'',missing_information:['检查'],differential_diagnoses:['候选A'],evidence_limitations:['无病理参考']});
 assert.equal(parseVisionOutput(differential,'differential').valid,true);assert.equal(parseVisionOutput(differential,'lesion').valid,false);
});

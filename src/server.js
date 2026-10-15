import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, library, saveLibrary, newId, listRuns, runDir, read, atomic, hash,legacyStatus,importLegacy,primaryOwner } from './storage.js';
import { seed } from './seeds.js';
import { models } from './models.js';
import { importDataset } from './datasets.js';
import { launch, cancel, detail, recover,cancelUsingCredential } from './runner.js';
import { analyze, csv, markdown, costAudit, visionAnalyze, dispatchAnalyze } from './analysis.js';
import {sessions,publicState} from './session.js';
import {presets,listModels,saveModel,removeModel,defaultModel,testModel,listBridges,importBridge,removeBridge,restoreModelCredential} from './model-registry.js';
import {requestJSON} from './transport.js';
import { importImage, importBatch, listAssets, getAssetMeta, deleteAsset, readAssetBytes, ASSET_LIMITS, listUnownedAssets, claimAsset, recoverAsset, assertAssetsExist, isAssetReferenced, rebuildAssetRefs } from './assets.js';
import { validateVisionCases, canScoreAccuracy, VISION_SCHEMA_VERSION } from './vision-schema.js';
import { defaultLabelLexicon, visionPromptTemplate, computeLabelMetrics, evaluateAbstention, parseVisionOutput, flagHallucinations } from './vision-metrics.js';
import multer from 'multer';
import {exportBundle,importBundle} from './bundles.js';
import {validateLexicon} from './lexicon.js';

function safeConfig(value){if(Array.isArray(value))return value.map(safeConfig);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['base64','owner_hash'].includes(k)).map(([k,v])=>[k,k==='images_json'?'[图片仅通过显式图片包导出]':safeConfig(v)]));return value;}
seed();recover();
export function createApp({transport=requestJSON}={}) {
const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'3mb'}));
// 只监听本机；阻止浏览器跨站发起修改请求与 DNS rebinding。
app.use((req,res,next)=>{
  let host;try{host=new URL(`http://${req.headers.host}`).hostname;}catch{return res.status(403).json({error:'无效本机 Host'});}
  if (!['127.0.0.1','localhost','[::1]'].includes(host)) return res.status(403).json({error:'仅允许本机 Host'});
  if (!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`) return res.status(403).json({error:'拒绝跨站写入'});
  res.setHeader('X-Content-Type-Options','nosniff');
  next();
});
app.use(sessions);
app.get('/api/legacy',(req,res)=>res.json(legacyStatus(req.owner)));
app.post('/api/legacy/import',(req,res)=>res.json(importLegacy(req.owner,req.body.confirm)));
app.get('/api/models',(req,res)=>res.json({models:listModels(req.owner),presets:presets.map(({key_env,env_prefix,...preset})=>preset),restart_hint:'API Key 仅保存在服务内存。重启后请补充凭证；请使用同一浏览器会话查看自己的配置。'}));
app.post('/api/models',(req,res)=>{const result=saveModel(req.owner,req.body);res.status(201).json(result.model);});
app.patch('/api/models/:id',(req,res)=>{const result=saveModel(req.owner,req.body,req.params.id);if(result.revoked)cancelUsingCredential(result.revoked,req.owner);res.json(result.model);});
app.post('/api/models/:id/credential',(req,res)=>res.json(restoreModelCredential(req.owner,req.params.id,req.body)));
app.delete('/api/models/:id/credential',(req,res)=>{const id=removeModel(req.owner,req.params.id,true);cancelUsingCredential(id,req.owner);res.json({ok:true});});
app.delete('/api/models/:id',(req,res)=>{const id=removeModel(req.owner,req.params.id);cancelUsingCredential(id,req.owner);res.json({ok:true});});
app.post('/api/models/:id/default',(req,res)=>res.json({models:defaultModel(req.owner,req.params.id)}));
app.post('/api/models/:id/test',async(req,res)=>res.json(await testModel(req.owner,req.params.id,{confirm_live:req.body.confirm_live===true,transport})));
app.get('/api/integration',(req,res)=>res.json({connections:listBridges(req.owner)}));
app.post('/api/integration/import',async(req,res)=>res.status(201).json(await importBridge(req.owner,req.body,{transport})));
app.delete('/api/integration/:id',(req,res)=>{const id=removeBridge(req.owner,req.params.id);cancelUsingCredential(id,req.owner);res.json({ok:true});});
app.get('/api/health',(req,res)=>res.json({ok:true,app:'LLM Benchmark Studio',version:'1.2.0',promptfoo:'0.124.1',live_enabled:process.env.STUDIO_ENABLE_LIVE==='1'}));
app.get('/api/library',(req,res)=>res.json({...library(req.owner),models:models(req.owner),live_enabled:process.env.STUDIO_ENABLE_LIVE==='1'||listModels(req.owner).some(m=>m.ready)||listBridges(req.owner).length>0}));
app.post('/api/bundles/export',(req,res)=>{res.setHeader('Content-Disposition','attachment; filename="studio-bundle.zip"');res.type('application/zip').send(exportBundle(req.body,req.owner));});
const zipUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:100*1024*1024,files:1}});
app.post('/api/bundles/import',zipUpload.single('file'),async(req,res)=>{if(!req.file)throw new Error('请选择 ZIP 文件');res.json(await importBundle(req.file.buffer,req.owner,{dryRun:req.body.dry_run==='true',plannedMapping:req.body.mapping?JSON.parse(req.body.mapping):null}));});
app.post('/api/vision/lexicon/validate',(req,res)=>res.json(validateLexicon(req.body)));

// ---- Vision: image assets ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
app.post('/api/assets/upload', upload.single('file'), async (req, res) => {
  if (!req.file) throw new Error('请提供图片文件');
  res.status(201).json(await importImage({ buffer: req.file.buffer, filename: req.file.originalname, role: req.body?.role || null }, req.owner));
});
app.get('/api/assets',(req,res)=>res.json({assets:listAssets(req.owner),limits:ASSET_LIMITS}));
app.post('/api/assets',async(req,res)=>{
  const {filename,role,base64}=req.body||{};
  if(!base64||typeof base64!=='string')throw new Error('请提供 base64 图片内容');
  const buf=Buffer.from(base64,'base64');
  if(buf.length===0)throw new Error('图片内容为空');
  res.status(201).json(await importImage({buffer:buf,filename,role},req.owner));
});
app.post('/api/assets/batch',async(req,res)=>{
  const items=(req.body?.items||[]).map(it=>({buffer:Buffer.from(String(it.base64||''),'base64'),filename:it.filename,role:it.role}));
  res.status(201).json({assets:await importBatch(items,req.owner)});
});
app.get('/api/assets/trash',(req,res)=>res.json({assets:listAssets(req.owner,{deleted:true})}));
app.get('/api/assets/unowned',(req,res)=>res.json({unowned:listUnownedAssets(req.owner)}));
app.post('/api/assets/:id/claim',(req,res)=>res.json(claimAsset(req.params.id,req.owner)));
app.post('/api/assets/:id/recover',(req,res)=>res.json(recoverAsset(req.params.id,req.owner)));
app.get('/api/assets/:id',(req,res)=>{
  const sha=String(req.params.id).replace(/^sha256:/,'');
  const meta=getAssetMeta(sha,req.owner);
  if(!meta)return res.status(404).json({error:'图片资产不存在'});
  const buf=readAssetBytes(sha,req.owner);
  res.setHeader('Content-Type',meta.mime_type);
  res.setHeader('Cache-Control','private, max-age=3600');
  res.send(buf);
});
app.get('/api/assets/:id/meta',(req,res)=>{
  const meta=getAssetMeta(String(req.params.id).replace(/^sha256:/,''),req.owner);
  if(!meta)return res.status(404).json({error:'图片资产不存在'});
  res.json(meta);
});
app.delete('/api/assets/:id',(req,res)=>res.json(deleteAsset(req.params.id,req.owner)));

// ---- Vision helpers ----
app.get('/api/vision/lexicon',(req,res)=>res.json(defaultLabelLexicon()));
app.get('/api/vision/prompt-template',(req,res)=>res.json({template:visionPromptTemplate(req.query.task||'lesion')}));
app.post('/api/vision/validate-cases',(req,res)=>res.json({cases:validateVisionCases(req.body.cases||[])}));
app.post('/api/vision/score-preview',(req,res)=>{
  const {cases,output,predicted,reference,complete,answerability,model_abstain}=req.body||{};
  const parsed=parseVisionOutput(output||'');
  const gt=cases?.ground_truth||{};
  const isComplete=canScoreAccuracy(cases);
  const refLabels=reference!==undefined?reference:(Array.isArray(gt.lesion_labels)?gt.lesion_labels:[]);
  const predLabels=predicted!==undefined?predicted:parsed.observed_features;
  const labelMetrics=computeLabelMetrics(predLabels,refLabels,{complete:isComplete,lexicon:defaultLabelLexicon()});
  const abstention=evaluateAbstention(model_abstain!==undefined?model_abstain:parsed.abstain,parsed.abstain_reason,isComplete?gt:{});
  const halluc=flagHallucinations(predLabels,refLabels,{complete:isComplete&&refLabels.length>0,lexicon:defaultLabelLexicon()});
  res.json({labels:labelMetrics,abstention,hallucinations:halluc,parsed});
});

app.post('/api/prompts',(req,res)=>{
  const lib=library(req.owner),body=req.body;
  if (!String(body.name||'').trim()||!String(body.content||'').includes('{{question}}')) throw new Error('提示词须填写名称并包含 {{question}}');
  if (body.content.length>20000) throw new Error('提示词超过 20000 字符');
  const existing=lib.prompts.find(p=>p.id===body.id);
  if(body.task_type!=null&&!['text','vision'].includes(body.task_type))throw new Error('提示词任务类型无效');
  if(existing){existing.history.push({version:existing.version,content:existing.content,name:existing.name});existing.version++;existing.name=body.name;existing.content=body.content;}
  else lib.prompts.push({id:newId('prompt'),name:String(body.name).slice(0,100),content:body.content,version:1,created_at:new Date().toISOString(),history:[],task_type:body.task_type||'text',...(body.task_template?{task_template:String(body.task_template).slice(0,60)}:{})});
  saveLibrary(lib,req.owner);res.json(lib.prompts);
});
app.delete('/api/prompts/:id',(req,res)=>{const lib=library(req.owner);lib.prompts=lib.prompts.filter(p=>p.id!==req.params.id);saveLibrary(lib,req.owner);res.json({ok:true});});
app.post('/api/datasets',(req,res)=>{
  const lib=library(req.owner),data=importDataset(req.body),old=lib.datasets.find(d=>d.id===req.body.id);
  if(data.task_type==='vision')assertAssetsExist(data.cases.flatMap(c=>c.images),req.owner);
  const dataset={...data,history:old?[...(old.history||[]),{...old,history:undefined}]:[],id:old?.id||newId('dataset'),version:old?old.version+1:1,created_at:new Date().toISOString()};
  lib.datasets=lib.datasets.filter(d=>d.id!==dataset.id);lib.datasets.push(dataset);saveLibrary(lib,req.owner);res.json(dataset);
});
app.delete('/api/datasets/:id',(req,res)=>{const lib=library(req.owner);lib.datasets=lib.datasets.filter(d=>d.id!==req.params.id);saveLibrary(lib,req.owner);res.json({ok:true});});
app.get('/api/runs',(req,res)=>res.json(listRuns().filter(r=>r.owner_hash===req.owner).map(publicState)));
app.post('/api/runs',(req,res)=>res.status(202).json(publicState(launch(req.body,null,req.owner))));
app.get('/api/runs/:id',(req,res)=>{const data=detail(req.params.id,req.owner),analysis=dispatchAnalyze(data.rows,data.snapshot,req.query);res.json({...data,rows:analysis.rows||data.rows,state:publicState(data.state),cost_audit:costAudit(data.ledger),analysis});});
app.post('/api/runs/:id/cancel',(req,res)=>{detail(req.params.id,req.owner);res.json(publicState(cancel(req.params.id,req.owner)));});
app.post('/api/runs/:id/replay',(req,res)=>res.status(202).json(publicState(launch(req.body,detail(req.params.id,req.owner).snapshot,req.owner))));
app.patch('/api/runs/:id/rows/:rowId',(req,res)=>{
  const d=detail(req.params.id,req.owner),row=d.rows.find(r=>r.id===req.params.rowId);if(!row) throw new Error('案例不存在');
  if(d.state.status==='running') throw new Error('请在实验完成或取消后保存人工复核，避免执行进程覆盖标注');
  const categories=['格式错误','事实词缺失','事实错误','指令遵循','请求失败','评估失败','引用问题','其他','通过'];
  if(!categories.includes(req.body.category)) throw new Error('分类无效');
  row.human_review={category:req.body.category,note:String(req.body.note||'').slice(0,2000),updated_at:new Date().toISOString()};
  atomic(path.join(runDir(req.params.id),'rows.json'),d.rows);res.json(row);
});
app.get('/api/runs/:id/export/:format',(req,res)=>{
  const d=detail(req.params.id,req.owner),analysis=dispatchAnalyze(d.rows,d.snapshot),format=req.params.format;d.state=publicState(d.state);
  const name=`${req.params.id}.${format==='markdown'?'md':format}`;
  res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
  if(format==='csv') return res.type('text/csv').send(csv(d.rows,d.snapshot));
  if(format==='markdown') return res.type('text/markdown').send(markdown(d.snapshot,d.rows,analysis,d.ledger));
  if(format==='json') return res.json({...d,analysis,cost_audit:costAudit(d.ledger)});
  if(format==='config') return res.type('application/json').send(safeConfig(read(path.join(runDir(req.params.id),'promptfooconfig.json'))));
  if(format==='raw') return res.json(safeConfig(read(path.join(runDir(req.params.id),'raw-results.json'),{warning:'尚无最终原始结果；完成单元在 JSON 导出内'})));
  throw new Error('不支持的导出格式');
});
app.get('/api/examples/:name',(req,res)=>{const names={'research-cases.json':'research-cases.json','import-example.csv':'import-example.csv','judge-config.json':'judge-config.json','vision-cases.json':'vision-cases.json','vetai-template.json':'vetai-template.json'};const file=names[req.params.name];if(!file) return res.status(404).end();res.sendFile(path.join(ROOT,'examples',file));});
app.use(express.static(path.join(ROOT,'public')));
app.use((error,req,res,next)=>{const safe=error.code==='LIMIT_FILE_SIZE'?'单张图片不能超过 20MB':error.type==='entity.parse.failed'?'请求 JSON 格式无效':error.type==='entity.too.large'?'请求内容超过大小限制':error.message;if(error.code==='LIMIT_FILE_SIZE')error.status=413;res.status(Number.isInteger(error.status)&&error.status>=400&&error.status<500?error.status:400).json({error:safe});});
return app;
}
export const app=createApp();
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)) app.listen(Number(process.env.PORT||8812),'127.0.0.1',()=>console.log('LLM Benchmark Studio: http://127.0.0.1:'+(process.env.PORT||8812)+' · 默认 Mock，不上传评测数据'));

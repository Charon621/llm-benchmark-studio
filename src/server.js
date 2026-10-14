import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, library, saveLibrary, newId, listRuns, runDir, read, atomic, hash } from './storage.js';
import { seed } from './seeds.js';
import { models } from './models.js';
import { importDataset } from './datasets.js';
import { launch, cancel, detail, recover } from './runner.js';
import { analyze, csv, markdown, costAudit } from './analysis.js';

seed();recover();
export const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'3mb'}));
// 只监听本机；阻止浏览器跨站发起修改请求与 DNS rebinding。
app.use((req,res,next)=>{
  const host=String(req.headers.host||'').split(':')[0];
  if (!['127.0.0.1','localhost','[::1]'].includes(host)) return res.status(403).json({error:'仅允许本机 Host'});
  if (!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)) return res.status(403).json({error:'拒绝跨站写入'});
  res.setHeader('X-Content-Type-Options','nosniff');
  next();
});
app.get('/api/health',(req,res)=>res.json({ok:true,app:'LLM Benchmark Studio',version:'1.0.0',promptfoo:'0.124.1',live_enabled:process.env.STUDIO_ENABLE_LIVE==='1'}));
app.get('/api/library',(req,res)=>res.json({...library(),models:models(),live_enabled:process.env.STUDIO_ENABLE_LIVE==='1'}));
app.post('/api/prompts',(req,res)=>{
  const lib=library(),body=req.body;
  if (!String(body.name||'').trim()||!String(body.content||'').includes('{{question}}')) throw new Error('提示词须填写名称并包含 {{question}}');
  if (body.content.length>20000) throw new Error('提示词超过 20000 字符');
  const existing=lib.prompts.find(p=>p.id===body.id);
  if(existing){existing.history.push({version:existing.version,content:existing.content,name:existing.name});existing.version++;existing.name=body.name;existing.content=body.content;}
  else lib.prompts.push({id:newId('prompt'),name:String(body.name).slice(0,100),content:body.content,version:1,created_at:new Date().toISOString(),history:[]});
  saveLibrary(lib);res.json(lib.prompts);
});
app.delete('/api/prompts/:id',(req,res)=>{const lib=library();lib.prompts=lib.prompts.filter(p=>p.id!==req.params.id);saveLibrary(lib);res.json({ok:true});});
app.post('/api/datasets',(req,res)=>{
  const lib=library(),data=importDataset(req.body),old=lib.datasets.find(d=>d.id===req.body.id);
  const dataset={...data,id:old?.id||newId('dataset'),version:old?old.version+1:1,created_at:new Date().toISOString()};
  lib.datasets=lib.datasets.filter(d=>d.id!==dataset.id);lib.datasets.push(dataset);saveLibrary(lib);res.json(dataset);
});
app.delete('/api/datasets/:id',(req,res)=>{const lib=library();lib.datasets=lib.datasets.filter(d=>d.id!==req.params.id);saveLibrary(lib);res.json({ok:true});});
app.get('/api/runs',(req,res)=>res.json(listRuns()));
app.post('/api/runs',(req,res)=>res.status(202).json(launch(req.body)));
app.get('/api/runs/:id',(req,res)=>{const data=detail(req.params.id);res.json({...data,cost_audit:costAudit(data.ledger),analysis:analyze(data.rows,req.query,data.snapshot.settings.repeats,data.snapshot.total_cells)});});
app.post('/api/runs/:id/cancel',(req,res)=>res.json(cancel(req.params.id)));
app.post('/api/runs/:id/replay',(req,res)=>res.status(202).json(launch(req.body,detail(req.params.id).snapshot)));
app.patch('/api/runs/:id/rows/:rowId',(req,res)=>{
  const d=detail(req.params.id),row=d.rows.find(r=>r.id===req.params.rowId);if(!row) throw new Error('案例不存在');
  if(d.state.status==='running') throw new Error('请在实验完成或取消后保存人工复核，避免执行进程覆盖标注');
  const categories=['格式错误','事实词缺失','事实错误','指令遵循','请求失败','评估失败','引用问题','其他','通过'];
  if(!categories.includes(req.body.category)) throw new Error('分类无效');
  row.human_review={category:req.body.category,note:String(req.body.note||'').slice(0,2000),updated_at:new Date().toISOString()};
  row.category=req.body.category;atomic(path.join(runDir(req.params.id),'rows.json'),d.rows);res.json(row);
});
app.get('/api/runs/:id/export/:format',(req,res)=>{
  const d=detail(req.params.id),analysis=analyze(d.rows,req.query,d.snapshot.settings.repeats,d.snapshot.total_cells),format=req.params.format;
  const name=`${req.params.id}.${format==='markdown'?'md':format}`;
  res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
  if(format==='csv') return res.type('text/csv').send(csv(d.rows));
  if(format==='markdown') return res.type('text/markdown').send(markdown(d.snapshot,d.rows,analysis,d.ledger));
  if(format==='json') return res.json({...d,analysis,cost_audit:costAudit(d.ledger)});
  if(format==='config') return res.type('application/json').send(read(path.join(runDir(req.params.id),'promptfooconfig.json')));
  if(format==='raw') return res.json(read(path.join(runDir(req.params.id),'raw-results.json'),{warning:'尚无最终原始结果；完成单元在 JSON 导出内'}));
  throw new Error('不支持的导出格式');
});
app.get('/api/examples/:name',(req,res)=>{const names={'research-cases.json':'research-cases.json','import-example.csv':'import-example.csv','judge-config.json':'judge-config.json'};const file=names[req.params.name];if(!file) return res.status(404).end();res.sendFile(path.join(ROOT,'examples',file));});
app.use(express.static(path.join(ROOT,'public')));
app.use((error,req,res,next)=>{console.error(new Date().toISOString(),req.path,error.message);res.status(400).json({error:error.message});});
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)) app.listen(Number(process.env.PORT||8812),'127.0.0.1',()=>console.log('LLM Benchmark Studio: http://127.0.0.1:'+(process.env.PORT||8812)+' · 默认 Mock，不上传评测数据'));

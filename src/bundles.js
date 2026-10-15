import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {zipSync,strToU8} from 'fflate';
import {DATA,library,saveLibrary,newId,hash} from './storage.js';
import {getAssetMeta,readAssetBytes,validateImage,commitPreparedImages,assetPath,assertAssetsExist} from './assets.js';
import {importDataset} from './datasets.js';
const MAX_ZIP=100*1024*1024,MAX_TOTAL=100*1024*1024,MAX_ENTRIES=1000;
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}return (crc^0xffffffff)>>>0;}
// Extract only a bounded allowlist into memory. No archive path is ever used as a disk path.
export function inspectZip(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<22||buffer.length>MAX_ZIP)throw new Error('ZIP 大小无效（最多 100MB）');
  let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
  if(end<0||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw new Error('ZIP 目录损坏或不支持分卷');
  const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),start=buffer.readUInt32LE(end+16);
  if(!count||count>MAX_ENTRIES||count!==buffer.readUInt16LE(end+8)||start+size!==end)throw new Error('ZIP 目录边界或条目数无效');
  const files={},entries=[];let offset=start,total=0;
  for(let i=0;i<count;i++){
    if(offset+46>end||buffer.readUInt32LE(offset)!==0x02014b50)throw new Error('ZIP 条目损坏');
    const flags=buffer.readUInt16LE(offset+8),method=buffer.readUInt16LE(offset+10),crc=buffer.readUInt32LE(offset+16),packed=buffer.readUInt32LE(offset+20),length=buffer.readUInt32LE(offset+24),nameLen=buffer.readUInt16LE(offset+28),extraLen=buffer.readUInt16LE(offset+30),commentLen=buffer.readUInt16LE(offset+32),attrs=buffer.readUInt32LE(offset+38),local=buffer.readUInt32LE(offset+42);
    const name=buffer.toString('utf8',offset+46,offset+46+nameLen);offset+=46+nameLen+extraLen+commentLen;
    if(offset>end||flags&1||![0,8].includes(method)||((attrs>>>16)&0xf000)===0xa000||!(/^(manifest\.json|images\/[a-f0-9]{64})$/).test(name)||files[name]||entries.some(e=>e.name===name))throw new Error('ZIP 路径、格式、符号链接或重复条目无效');
    if(length>21*1024*1024||length/Math.max(1,packed)>200||(total+=length)>MAX_TOTAL||local+30>start||buffer.readUInt32LE(local)!==0x04034b50)throw new Error('ZIP 展开大小或压缩比超限');
    const ln=buffer.readUInt16LE(local+26),le=buffer.readUInt16LE(local+28),dataStart=local+30+ln+le;
    if(buffer.toString('utf8',local+30,local+30+ln)!==name||buffer.readUInt16LE(local+8)!==method||buffer.readUInt16LE(local+6)!==flags||dataStart+packed>start)throw new Error('ZIP 本地目录不匹配');
    entries.push({name,method,crc,packed,length,dataStart});
  }
  if(offset!==end)throw new Error('ZIP 中央目录长度不匹配');
  for(const e of entries){const packed=buffer.subarray(e.dataStart,e.dataStart+e.packed),bytes=e.method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:Math.max(1,e.length)});if(bytes.length!==e.length||crc32(bytes)!==e.crc)throw new Error('ZIP 文件大小或 CRC 校验失败');files[e.name]=bytes;}
  if(!files['manifest.json'])throw new Error('ZIP 缺少 manifest');return files;
}
export function exportBundle(input,owner){
  const lib=library(owner),pick=(rows,ids)=>{if(!Array.isArray(ids))throw new Error('请选择要打包的资源');if(new Set(ids).size!==ids.length)throw new Error('选择 ID 重复');return ids.map(id=>{const row=rows.find(r=>r.id===id);if(!row)throw new Error('资源不存在');return structuredClone(row)});};
  const datasets=pick(lib.datasets,input.dataset_ids||[]),prompts=pick(lib.prompts,input.prompt_ids||[]);
  if(!datasets.length&&!prompts.length)throw new Error('至少选择一项资源');
  const imageIds=[...new Set(datasets.flatMap(d=>d.cases.flatMap(c=>(c.images||[]).map(i=>i.asset_id))))];
  const files={},images=imageIds.map(id=>{const meta=getAssetMeta(id,owner);if(!meta)throw new Error('所选图片无访问权限');if(input.include_images===true)files['images/'+meta.sha256]=readAssetBytes(id,owner);return {...meta,path:'images/'+meta.sha256,included:input.include_images===true};});
  // Dataset history can include resources outside the explicit selection; package only the selected versions.
  const cleanDatasets=datasets.map(({history,...d})=>d),cleanPrompts=prompts.map(({history,...p})=>p);
  const body={bundle_version:'1.0',created_at:new Date().toISOString(),datasets:cleanDatasets,prompts:cleanPrompts,images};
  const manifest={...body,sha256:hash(body)};files['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  return Buffer.from(zipSync(files,{level:0}));
}
export async function importBundle(buffer,owner,{dryRun=false,plannedMapping=null}={}){
  const files=inspectZip(buffer);let manifest;try{manifest=JSON.parse(files['manifest.json'].toString('utf8'));}catch{throw new Error('manifest JSON 无效');}
  const {sha256,...body}=manifest;if(manifest.bundle_version!=='1.0'||hash(body)!==sha256)throw new Error('manifest 版本或哈希无效');
  if(!Array.isArray(body.datasets)||body.datasets.length>200||!Array.isArray(body.prompts)||body.prompts.length>100||!Array.isArray(body.images)||body.images.length>999)throw new Error('manifest 资源数量无效');
  const existing=library(owner),mapping={datasets:{},prompts:{}},allocate=(kind,old)=>{const id=plannedMapping?.[kind+'s']?.[old]||newId(kind);if(!new RegExp('^'+kind+'-[a-zA-Z0-9-]+$').test(id)||existing[kind+'s'].some(r=>r.id===id)||Object.values(mapping[kind+'s']).includes(id))throw new Error('预览映射冲突，请重新预览');return id;};
  const datasets=body.datasets.map(d=>{if(!d.id||mapping.datasets[d.id])throw new Error('数据集 ID 缺失或重复');const id=allocate('dataset',d.id);mapping.datasets[d.id]=id;return {...importDataset(d),id,version:1,created_at:new Date().toISOString(),imported_from:{id:d.id,hash:d.hash},history:[]};});
  const prompts=body.prompts.map(p=>{if(typeof p.id!=='string'||mapping.prompts[p.id]||typeof p.name!=='string'||!p.name||typeof p.content!=='string'||!p.content.includes('{{question}}')||p.content.length>20000)throw new Error('提示词格式或 ID 无效');const id=allocate('prompt',p.id);mapping.prompts[p.id]=id;return {id,task_type:p.task_type==='vision'?'vision':'text',...(p.task_template?{task_template:String(p.task_template).slice(0,60)}:{}),name:p.name.slice(0,100),content:p.content,version:1,history:[],created_at:new Date().toISOString()};});
  const imageMap=new Map();for(const img of body.images){if(!/^[a-f0-9]{64}$/.test(img.sha256)||img.asset_id!=='sha256:'+img.sha256||img.path!=='images/'+img.sha256||imageMap.has(img.asset_id))throw new Error('图片 manifest 无效或重复');imageMap.set(img.asset_id,img);}
  const referenced=[...new Set(datasets.flatMap(d=>d.cases.flatMap(c=>(c.images||[]).map(i=>i.asset_id))))];
  if(referenced.length!==imageMap.size||referenced.some(id=>!imageMap.has(id)))throw new Error('图片清单与数据集引用不一致');
  const items=[],dims=[];
  for(const id of referenced){const img=imageMap.get(id),bytes=files[img.path];if(img.included===true){if(!bytes||digest(bytes)!==img.sha256||bytes.length!==img.size_bytes)throw new Error('图片缺失或哈希不匹配');items.push({buffer:bytes,filename:img.filename,role:img.role});dims.push(await validateImage(bytes));}else{if(bytes)throw new Error('未经选择的图片出现在 ZIP 中');assertAssetsExist([{asset_id:id}],owner);}}
  const allowed=new Set(['manifest.json',...body.images.filter(i=>i.included===true).map(i=>i.path)]);if(Object.keys(files).some(k=>!allowed.has(k)))throw new Error('ZIP 含未声明的文件');
  const preview={ok:true,dry_run:dryRun,mapping,datasets:datasets.length,prompts:prompts.length,images:items.length,warning:'导入创建新资源；无凭证或授权被建立'};if(dryRun)return preview;
  const lib=library(owner),tracked=[path.join(DATA,'asset-index.json'),path.join(DATA,'asset-owner-refs.json'),path.join(DATA,'sessions',owner,'library.json')],backups=tracked.map(f=>fs.existsSync(f)?fs.readFileSync(f):null),newBlobs=items.map(i=>assetPath(digest(i.buffer))).filter(f=>!fs.existsSync(f));
  // No awaits inside commit/rollback: no other owner mutation can interleave these writes.
  try{commitPreparedImages(items,owner,dims);saveLibrary({...lib,datasets:[...lib.datasets,...datasets],prompts:[...lib.prompts,...prompts]},owner);}
  catch(error){tracked.forEach((f,i)=>{if(backups[i])fs.writeFileSync(f,backups[i]);else if(fs.existsSync(f))fs.unlinkSync(f)});for(const file of newBlobs)if(fs.existsSync(file))fs.unlinkSync(file);throw error;}
  return preview;
}

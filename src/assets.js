import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { DATA, atomic, read, listRuns, runDir, primaryOwner } from './storage.js';
const assetsDir=()=>path.join(DATA,'assets'), indexFile=()=>path.join(DATA,'asset-index.json'),ownersFile=()=>path.join(DATA,'asset-owner-refs.json');
const MAX_FILE_BYTES=20*1024*1024,MAX_BATCH=50,MAX_BATCH_BYTES=100*1024*1024,MAX_IMAGES_PER_CASE=5,MAX_PIXELS=40_000_000;
const MIME={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
const loadIndex=()=>read(indexFile(),{}),loadOwners=()=>read(ownersFile(),{}),shaOf=id=>String(id||'').replace(/^sha256:/,'');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function requireOwner(owner){if(!owner)throw fail('图片操作需要当前会话',403);}
function access(sha,owner,deleted=false){
  requireOwner(owner);
  const meta=loadIndex()[sha],grants=loadOwners(),grant=grants[sha]?.[owner];
  // Only migrate an existing explicit owner. Unowned assets require explicit claiming.
  if(meta?.owner_hash===owner&&!grant&&!Object.keys(grants[sha]||{}).length){grants[sha]={[owner]:{granted_at:meta.imported_at,deleted_at:meta.deleted_at||null}};atomic(ownersFile(),grants);}
  const actual=grants[sha]?.[owner];return meta&&actual&&(deleted||!actual.deleted_at)?{meta,grant:actual}:null;
}
function publicMeta(meta,grant={}){const {owner_hash,schema_version,deleted_at,...safe}=meta;return {...safe,filename:grant.filename||safe.filename,role:grant.role??safe.role};}
export function assetPath(sha){if(!/^[a-f0-9]{64}$/.test(sha))throw fail('资产哈希无效');return path.join(assetsDir(),sha.slice(0,2),sha);}
export function getAssetMeta(id,owner){const a=access(shaOf(id),owner);return a?publicMeta(a.meta,a.grant):null;}
export function listAssets(owner,{deleted=false}={}){requireOwner(owner);return Object.entries(loadIndex()).flatMap(([sha])=>{const a=access(sha,owner,true);return a&&Boolean(a.grant.deleted_at)===deleted?[{...publicMeta(a.meta,a.grant),...(deleted?{deleted_at:a.grant.deleted_at}:{})}]:[];});}
export function readAssetBytes(id,owner){
  const sha=shaOf(id),a=access(sha,owner);if(!a)throw fail('图片资产不存在',404);
  const file=assetPath(sha);if(!fs.existsSync(file))throw fail('图片文件缺失，请重新导入',404);
  const bytes=fs.readFileSync(file);if(crypto.createHash('sha256').update(bytes).digest('hex')!==sha)throw fail('图片哈希不匹配',409);return bytes;
}
export function assertAssetsExist(images,owner){for(const img of images)readAssetBytes(img.asset_id,owner);}
export async function validateImage(buffer){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw fail('图片内容为空');if(buffer.length>MAX_FILE_BYTES)throw fail('单张图片不能超过 20MB',413);
  try{const image=sharp(buffer,{failOn:'warning',limitInputPixels:MAX_PIXELS,animated:true});const meta=await image.metadata();
    if(!MIME[meta.format]||!meta.width||!meta.height||(meta.pages||1)>1||meta.width*meta.height>MAX_PIXELS)throw new Error('格式或尺寸无效');
    await image.raw().toBuffer();return {mime_type:MIME[meta.format],width:meta.width,height:meta.height};
  }catch{throw fail('图片无法完整解码；仅支持单帧 JPG / PNG / WebP，最多 4000 万像素');}
}
function commitImage({buffer,filename,role=null},owner,dims){
  const sha=crypto.createHash('sha256').update(buffer).digest('hex'),idx=loadIndex(),existing=idx[sha];
  const safeName=path.win32.basename(path.posix.basename(String(filename||'image'))).replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').slice(0,180)||'image';
  const file=assetPath(sha);fs.mkdirSync(path.dirname(file),{recursive:true});
  if(!fs.existsSync(file))fs.writeFileSync(file,buffer,{flag:'wx'});
  else if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==sha){const tmp=file+'.repair.tmp';fs.writeFileSync(tmp,buffer);fs.renameSync(tmp,file);}
  const meta=existing||{asset_id:`sha256:${sha}`,sha256:sha,filename:safeName,...dims,size_bytes:buffer.length,role,imported_at:new Date().toISOString(),schema_version:3,owner_hash:owner};
  delete meta.deleted_at;idx[sha]=meta;atomic(indexFile(),idx);
  const grants=loadOwners();grants[sha]||={};grants[sha][owner]={granted_at:new Date().toISOString(),filename:safeName,role,deleted_at:null};atomic(ownersFile(),grants);
  return {...publicMeta(meta,grants[sha][owner]),deduplicated:Boolean(existing)};
}
export async function importImage(item,owner){requireOwner(owner);return commitImage(item,owner,await validateImage(item.buffer));}
export function commitPreparedImages(items,owner,dims){requireOwner(owner);return items.map((item,i)=>commitImage(item,owner,dims[i]));}
export async function importBatch(items,owner){
  requireOwner(owner);if(!Array.isArray(items)||!items.length||items.length>MAX_BATCH)throw fail('每批须为 1—50 张图片');
  if(items.reduce((s,it)=>s+(it.buffer?.length||0),0)>MAX_BATCH_BYTES)throw fail('每批不能超过 100MB',413);
  const dims=[];for(const item of items)dims.push(await validateImage(item.buffer));return items.map((item,i)=>commitImage(item,owner,dims[i]));
}
export function rebuildAssetRefs(){
  const refs={},add=(img,type,id,owner)=>{const sha=shaOf(img.asset_id||img.sha256);if(!/^[a-f0-9]{64}$/.test(sha))return;refs[sha]||=[];if(!refs[sha].some(r=>r.source_type===type&&r.source_id===id&&r.owner===owner))refs[sha].push({source_type:type,source_id:id,owner});};
  const sessions=path.join(DATA,'sessions'),dirs=fs.existsSync(sessions)?fs.readdirSync(sessions):[];
  for(const owner of [...new Set([primaryOwner(),...dirs].filter(Boolean))]){const lib=read(path.join(sessions,owner,'library.json'),owner===primaryOwner()?read(path.join(DATA,'library.json'),{datasets:[]}):{datasets:[]});for(const ds of lib.datasets||[])for(const c of ds.cases||[])for(const img of c.images||[])add(img,'dataset',ds.id,owner);}
  for(const state of listRuns()){const snap=read(path.join(runDir(state.id),'snapshot.json'));for(const img of snap?.image_manifest||[])add(img,'run',state.id,state.owner_hash);}
  atomic(path.join(DATA,'asset-refs.json'),refs);return refs;
}
export function getAssetRefs(id,owner){requireOwner(owner);return (rebuildAssetRefs()[shaOf(id)]||[]).filter(r=>r.owner===owner).map(({owner,...r})=>r);}
export function isAssetReferenced(id,owner){return getAssetRefs(id,owner).length>0;}
export function registerAssetRef(){return rebuildAssetRefs();}
export function removeAssetRefs(){return rebuildAssetRefs();}
export function deleteAsset(id,owner){
  const sha=shaOf(id),a=access(sha,owner);if(!a)throw fail('图片资产不存在',404);
  if(isAssetReferenced(id,owner))throw fail('图片仍被当前会话的数据集或冻结实验引用，请先解除引用',409);
  const grants=loadOwners();grants[sha][owner].deleted_at=new Date().toISOString();atomic(ownersFile(),grants);
  // Logical deletion retains shared blobs and a recoverable owner tombstone.
  return {ok:true,asset_id:`sha256:${sha}`,recoverable:true};
}
export function recoverAsset(id,owner){
  const sha=shaOf(id),a=access(sha,owner,true);if(!a)throw fail('图片资产不存在',404);
  const file=assetPath(sha),trash=path.join(assetsDir(),'_trash',sha.slice(0,2),sha);
  if(!fs.existsSync(file)&&fs.existsSync(trash)){fs.mkdirSync(path.dirname(file),{recursive:true});fs.renameSync(trash,file);}
  if(!fs.existsSync(file))throw fail('原图片文件缺失，请重新导入',409);
  const grants=loadOwners();delete grants[sha][owner].deleted_at;atomic(ownersFile(),grants);return {ok:true,asset_id:`sha256:${sha}`,recovered:true};
}
export function listUnownedAssets(owner){requireOwner(owner);if(owner!==primaryOwner())return [];const refs=loadOwners();return Object.entries(loadIndex()).filter(([sha,m])=>!m.owner_hash&&!Object.keys(refs[sha]||{}).length).map(([,m])=>publicMeta(m));}
export function claimAsset(id,owner){
  requireOwner(owner);if(owner!==primaryOwner())throw fail('仅本机原会话可认领未归属历史图片',403);
  const sha=shaOf(id),meta=loadIndex()[sha],refs=loadOwners();if(!meta||meta.owner_hash||Object.keys(refs[sha]||{}).length)throw fail('图片不存在或已有归属',409);
  refs[sha]={[owner]:{granted_at:new Date().toISOString(),filename:meta.filename,deleted_at:meta.deleted_at||null}};atomic(ownersFile(),refs);return publicMeta(meta);
}
export function validateImageRefs(images){
  if(!Array.isArray(images)||images.length<1||images.length>MAX_IMAGES_PER_CASE)throw fail('视觉案例须包含 1—5 张图片');
  return images.map((img,i)=>{const asset_id=String(img?.asset_id||'');if(!/^sha256:[a-f0-9]{64}$/.test(asset_id))throw fail(`第 ${i+1} 张图片 asset_id 无效`);const role=img.role||null;if(role&&!['overview','closeup','reference'].includes(role))throw fail('图片角色须为 overview / closeup / reference');return {asset_id,role};});
}
export const ASSET_LIMITS={MAX_FILE_BYTES,MAX_BATCH,MAX_BATCH_BYTES,MAX_IMAGES_PER_CASE,MAX_PIXELS,ALLOWED_MIME:Object.values(MIME),SCHEMA_VERSION:3};

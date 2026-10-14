import path from 'node:path';
import crypto from 'node:crypto';
import {DATA,read,atomic,newId} from './storage.js';
import {putCredential,getCredential,deleteCredential} from './credentials.js';
import {endpoint,agentEndpoint,requestJSON,callModel,redactValue} from './transport.js';
export const presets=[
  {provider:'kimi',protocol:'openai',base_url:'https://api.moonshot.cn/v1',model:'',key_env:'KIMI_API_KEY',env_prefix:'KIMI'},
  {provider:'qwen',protocol:'openai',base_url:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'',key_env:'QWEN_API_KEY',env_prefix:'QWEN'},
  {provider:'deepseek',protocol:'openai',base_url:'https://api.deepseek.com/v1',model:'',key_env:'DEEPSEEK_API_KEY',env_prefix:'DEEPSEEK'},
  {provider:'glm',protocol:'openai',base_url:'https://open.bigmodel.cn/api/paas/v4',model:'',key_env:'GLM_API_KEY',env_prefix:'GLM'},
  {provider:'openai',protocol:'openai',base_url:'https://api.openai.com/v1',model:'',key_env:'OPENAI_API_KEY',env_prefix:'OPENAI'},
  {provider:'anthropic',protocol:'anthropic',base_url:'https://api.anthropic.com/v1',model:'',key_env:'ANTHROPIC_API_KEY',env_prefix:'ANTHROPIC'},
  {provider:'custom',protocol:'openai',base_url:'',model:'',key_env:'CUSTOM_API_KEY',env_prefix:'CUSTOM'}
];
const file=()=>path.join(DATA,'model-definitions.json');
const all=()=>read(file(),[]);
const bridges=new Map();
const credentialId=()=>`credential-${crypto.randomBytes(16).toString('hex')}`;
function numeric(value,fallback,min,max){const n=value==null||value===''?fallback:Number(value);if(n!=null&&(!Number.isFinite(n)||n<min||n>max))throw new Error(`模型参数须在 ${min}–${max} 之间`);return n;}
function definition(body,old={}) {
  const provider=body.provider||old.provider||'custom',preset=presets.find(p=>p.provider===provider);if(!preset)throw new Error('模型供应商无效');
  const protocol=body.protocol||old.protocol||preset.protocol;if(!['openai','anthropic'].includes(protocol))throw new Error('模型协议无效');
  const model=String(body.model??old.model??'').trim();if(!model||model.length>160)throw new Error('请填写账号可用的模型 ID（最多160字符）');
  const name=String(body.name??body.label??old.name??model).trim().slice(0,100);
  let param=body.max_tokens_parameter||old.max_tokens_parameter||(provider==='openai'?'max_completion_tokens':'max_tokens');if(param==='auto')param=provider==='openai'?'max_completion_tokens':'max_tokens';if(!['max_tokens','max_completion_tokens'].includes(param))throw new Error('输出 Token 参数无效');
  return {id:old.id||newId('model'),name,label:name,provider,protocol,model,base_url:endpoint(body.base_url||old.base_url||preset.base_url),config_version:(old.config_version||0)+1,credential_id:old.credential_id||credentialId(),supports_tools:body.supports_tools==null?Boolean(old.supports_tools):body.supports_tools===true,send_temperature:body.send_temperature==null?old.send_temperature!==false:body.send_temperature===true,max_tokens_parameter:param,temperature:numeric(body.temperature,old.temperature??0,0,protocol==='anthropic'?1:2),max_tokens:Math.floor(numeric(body.max_tokens,old.max_tokens??600,1,131072)),input_price_per_million:numeric(body.input_price_per_million,old.input_price_per_million??null,0,10000),output_price_per_million:numeric(body.output_price_per_million,old.output_price_per_million??null,0,10000),is_default:Boolean(old.is_default),created_at:old.created_at||new Date().toISOString()};
}
function visible(m,owner){const {owner_hash,...safe}=m;const ready=Boolean(getCredential(m.credential_id,owner));return {...safe,kind:'chat',mode:'live',ready,has_key:ready,key_masked:ready?'••••••••':'',default:m.is_default,connection_status:ready?(m.last_test||{category:'untested',message:'尚未测试'}):{category:'missing_key',message:'请补充 API Key'}};}
export function listModels(owner){return all().filter(m=>m.owner_hash===owner).map(m=>visible(m,owner));}
export function findModel(owner,id){const model=all().find(m=>m.owner_hash===owner&&m.id===id);if(!model)throw Object.assign(new Error('模型不存在或不属于当前会话'),{status:404});return visible(model,owner);}
export function saveModel(owner,body,id=null){
  const rows=all(),old=id?rows.find(m=>m.owner_hash===owner&&m.id===id):null;if(id&&!old)throw Object.assign(new Error('模型不存在或不属于当前会话'),{status:404});
  const model=definition(body,old||{}),key=String(body.api_key||'').trim();
  if(key.length>8192||key&&/[\r\n]/.test(key))throw new Error('API Key 格式无效');
  const revoked=null;
  model.credential_history=[...new Set([...(old?.credential_history||[]),model.credential_id])];
  if(key){if(old&&getCredential(old.credential_id,owner)){model.credential_id=credentialId();model.credential_history.push(model.credential_id);}putCredential(model.credential_id,owner,key);}
  if(!old&&!rows.some(m=>m.owner_hash===owner))model.is_default=true;
  model.owner_hash=owner;atomic(file(),[...rows.filter(m=>m.id!==model.id),model]);return {model:visible(model,owner),revoked};
}
export function removeModel(owner,id,credentialOnly=false){const m=findModel(owner,id),rows=all(),ids=m.credential_history||[m.credential_id];for(const cid of ids)deleteCredential(cid);atomic(file(),credentialOnly?rows:rows.filter(m=>m.id!==id));return ids;}
export function restoreModelCredential(owner,id,body){const model=findModel(owner,id),cid=body.credential_id||model.credential_id;if(!(model.credential_history||[model.credential_id]).includes(cid))throw Object.assign(new Error('凭证版本不存在或不属于此模型'),{status:404});if(getCredential(cid,owner))throw Object.assign(new Error('此凭证版本已存在；修改密钥请保存为新版本，避免改变冻结实验'),{status:409});const key=String(body.api_key||'').trim();if(!key||key.length>8192||/[\r\n]/.test(key))throw new Error('API Key 格式无效');putCredential(cid,owner,key);return {ok:true,credential_id:cid};}
export function defaultModel(owner,id){findModel(owner,id);const rows=all().map(m=>m.owner_hash===owner?{...m,is_default:m.id===id}:m);atomic(file(),rows);return listModels(owner);}
export async function testModel(owner,id,{confirm_live=false,transport=requestJSON}={}) {
  if(!confirm_live)throw new Error('连接测试会向供应商发送最小请求，请明确勾选本次调用授权');
  const model=findModel(owner,id),start=performance.now();
  let status;
  try{const result=await callModel(model,getCredential(model.credential_id,owner),'Reply only OK.',{temperature:model.temperature,max_tokens:Math.min(model.max_tokens,16),timeout_ms:15000},transport);status={ok:true,category:'success',message:'连接成功，协议与模型均可用',latency_ms:performance.now()-start,input_tokens:result.input_tokens,output_tokens:result.output_tokens};}
  catch(error){status={ok:false,category:error.category||'configuration',message:redactValue(error.category?error.message:'模型配置或请求格式无效',[getCredential(model.credential_id,owner)]),latency_ms:performance.now()-start,input_tokens:null,output_tokens:null};}
  const rows=all();atomic(file(),rows.map(m=>m.id===id&&m.owner_hash===owner&&m.config_version===model.config_version&&m.credential_id===model.credential_id?{...m,last_test:{...status,tested_at:new Date().toISOString(),config_version:model.config_version}}:m));return {...status,config_version:model.config_version};
}
export function listBridges(owner){return [...bridges.values()].filter(b=>b.owner===owner).map(({owner,credential_id,...b})=>({...b,ready:Boolean(getCredential(credential_id,owner))}));}
export async function importBridge(owner,body,{transport=requestJSON}={}) {
  const url=agentEndpoint(body.url||'http://127.0.0.1:8811'),token=String(body.token||'').trim(),model_config_id=String(body.model_config_id||'');if(!token||token.length>8192||/[\r\n]/.test(token)||!model_config_id)throw new Error('请填写授权 Token 与对应模型配置 ID');
  const result=await transport(`${url}/api/integration/model?model_config_id=${encodeURIComponent(model_config_id)}`,{method:'GET',headers:{Authorization:`Bearer ${token}`},timeout_ms:15000,agent:true});
  const m=result.model_config;if(!m||m.id!==model_config_id||!presets.some(p=>p.provider===m.provider)||!['openai','anthropic'].includes(m.protocol)||!m.model)throw new Error('AgentLab 返回的模型配置无效');
  const safe=redactValue(Object.fromEntries(['id','provider','protocol','model','base_url','config_version','credential_id','supports_tools','temperature','max_tokens','name','tool_mode','search','prices','send_temperature','supports_temperature','max_tokens_parameter','input_price_per_million','output_price_per_million'].filter(k=>m[k]!==undefined).map(k=>[k,m[k]])),[token]);
  if(safe.send_temperature==null&&safe.supports_temperature!=null)safe.send_temperature=safe.supports_temperature;
  if(!safe.max_tokens_parameter)safe.max_tokens_parameter=safe.provider==='openai'?'max_completion_tokens':'max_tokens';
  endpoint(safe.base_url);const id=newId('bridge'),credential_id=credentialId();putCredential(credential_id,owner,token);bridges.set(id,{id,owner,url,model_config_id,model_config:safe,credential_id,created_at:new Date().toISOString(),expires:result.expires??null});return listBridges(owner).find(b=>b.id===id);
}
export function removeBridge(owner,id){const b=bridges.get(id);if(!b||b.owner!==owner)throw Object.assign(new Error('授权连接不存在'),{status:404});deleteCredential(b.credential_id);bridges.delete(id);return b.credential_id;}
export function bridgeModels(owner){return [...bridges.values()].filter(b=>b.owner===owner).flatMap(b=>['single','multi'].map(mode=>({...b.model_config,id:`${b.id}-${mode}`,label:`AgentLab · ${b.model_config.name||b.model_config.model} · ${mode==='single'?'单 Agent':'多 Agent'}`,kind:'agentlab',mode:'live',agent_mode:mode,agent_url:b.url,model_config_id:b.model_config_id,credential_id:b.credential_id,base_model_config:b.model_config,ready:Boolean(getCredential(b.credential_id,owner))})));}

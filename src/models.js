import {presets,listModels,bridgeModels} from './model-registry.js';
import {primaryOwner} from './storage.js';
export function models(owner=null) {
  return [
    {id:'mock-kimi',label:'Mock · Kimi 风格',mode:'mock',kind:'mock',model:'mock-kimi-v1',description:'确定性演示夹具；不是 Kimi 调用',ready:true},
    {id:'mock-qwen',label:'Mock · Qwen 风格',mode:'mock',kind:'mock',model:'mock-qwen-v1',description:'含预置缺陷的演示夹具；不是 Qwen 调用',ready:true},
    ...presets.filter(p=>p.provider!=='custom'||process.env.CUSTOM_MODEL).map(p=>({id:`live-${p.provider}`,label:`${p.provider.toUpperCase()} · 环境变量 API`,provider:p.provider,protocol:p.protocol,mode:'live',kind:'chat',model:process.env[`${p.env_prefix}_MODEL`]||({kimi:'kimi-k2.5',qwen:'qwen-plus',deepseek:'deepseek-chat',glm:'glm-4.7',openai:'gpt-4.1',anthropic:'claude-sonnet-4-5'})[p.provider],key_env:p.key_env,base_url:process.env[`${p.env_prefix}_BASE_URL`]||p.base_url,credential_id:`env-${p.provider}`,send_temperature:true,max_tokens_parameter:p.provider==='openai'?'max_completion_tokens':'max_tokens',supports_tools:false,ready:Boolean(process.env[p.key_env])&&(!owner||owner===primaryOwner())})),
    ...(owner?[...listModels(owner),...bridgeModels(owner)]:[]),
    ...['single','multi'].map(mode=>({id:`agentlab-${mode}`,label:`AgentLab · ${mode==='single'?'单 Agent':'多 Agent'}`,mode:'mock',kind:'agentlab',agent_mode:mode,model:'agentlab',base_url:process.env.AGENTLAB_URL||'http://127.0.0.1:8811',description:'同题、同模型、同工具预算；执行模式由实验配置冻结',ready:true}))
  ];
}

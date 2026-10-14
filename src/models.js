export function models() {
  return [
    {id:'mock-kimi',label:'Mock · Kimi 风格',mode:'mock',kind:'mock',model:'mock-kimi-v1',description:'确定性演示夹具；不是 Kimi 调用',ready:true},
    {id:'mock-qwen',label:'Mock · Qwen 风格',mode:'mock',kind:'mock',model:'mock-qwen-v1',description:'含预置缺陷的演示夹具；不是 Qwen 调用',ready:true},
    {id:'live-kimi',label:'Kimi · 实时 API',mode:'live',kind:'chat',model:process.env.KIMI_MODEL||'kimi-k2.5',key_env:'KIMI_API_KEY',base_url:process.env.KIMI_BASE_URL||'https://api.moonshot.cn/v1',ready:Boolean(process.env.KIMI_API_KEY)},
    {id:'live-qwen',label:'Qwen · 实时 API',mode:'live',kind:'chat',model:process.env.QWEN_MODEL||'qwen-plus',key_env:'QWEN_API_KEY',base_url:process.env.QWEN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',ready:Boolean(process.env.QWEN_API_KEY)},
    ...['single','multi'].map(mode=>({id:`agentlab-${mode}`,label:`AgentLab · ${mode==='single'?'单 Agent':'多 Agent'}`,mode:'mock',kind:'agentlab',agent_mode:mode,model:'agentlab',base_url:process.env.AGENTLAB_URL||'http://127.0.0.1:8811',description:'同题、同模型、同工具预算；执行模式由实验配置冻结',ready:true}))
  ];
}

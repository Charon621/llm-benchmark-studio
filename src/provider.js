import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { atomic } from './storage.js';
import {getCredential} from './credentials.js';
import {callModel,requestJSON,redactValue} from './transport.js';

let ledger = { attempts:0, cost:0, committed_cost:0, reserved_cost:0, agent_model_calls:0, tokenUsage:0,known_token_subtotal:0, attemptsLog:[] };
export function resetLedger() { ledger={attempts:0,cost:0,committed_cost:0,reserved_cost:0,agent_model_calls:0,tokenUsage:0,known_token_subtotal:0,attemptsLog:[]}; }
export const getLedger = () => ledger;
const delay = ms => new Promise(r=>setTimeout(r,ms));
export default class StudioProvider {
  constructor(options={}) { this.config=options.config||options; this.label=options.label||this.config.model.id;this.transport=options.transport||requestJSON; }
  id() { return this.config.model.id; }
  async callApi(prompt, context={}) {
    const c=this.config, m=c.model, vars=context.vars||{};
    const started=performance.now();
    const key=getCredential(m.credential_id)||(!process.send&&m.key_env?process.env[m.key_env]:null);
    const scrub=error=>{let text=String(error?.message||error);if(key)text=text.split(key).join('[REDACTED]');return text.replace(/Bearer\s+\S+/g,'Bearer [REDACTED]').replace(/x-api-key\s*[:=]\s*\S+/gi,'x-api-key: [REDACTED]');};
    try {
      if (m.kind==='mock') {
        const reference=String(vars.reference||'');
        const direct=String(prompt).includes('请研究以下问题并简明回答');
        const unstable=m.id==='mock-qwen' && Number(vars.repeat_index)%2===1;
        let output=reference;
        if (m.id==='mock-qwen' && (direct||unstable)) output='演示夹具：现有证据不足，无法完成此项要求。';
        // 夹具直接读取参考答案，仅用于验证评测流水线，不具有模型比较效力。
        await delay(m.id==='mock-kimi'?12:7);
        return {output,metadata:{execution_mode:'mock',fixture:true,latency_ms:performance.now()-started,input_tokens:null,output_tokens:null,cost_usd:null}};
      }
      let last;
      for (let attempt=0;attempt<=c.retries;attempt++) {
        if (ledger.attempts>=c.max_calls) throw new Error('调用预算已耗尽（包括重试）');
        if (Date.now()>c.deadline_at) throw new Error('实验总超时');
        // UTF-8 字节数加系统消息裕量作为保守输入上界；所有并发调用同步预留。
        const estimate = m.input_price_per_million!=null && m.output_price_per_million!=null ? ((Buffer.byteLength(prompt,'utf8')+1000)*m.input_price_per_million+(m.max_tokens??c.max_tokens)*m.output_price_per_million)/1e6 : null;
        if (c.cost_budget_usd!=null && (estimate==null || ledger.committed_cost+ledger.reserved_cost+estimate>c.cost_budget_usd)) throw new Error('成本预算不足或价格未知，停止调用');
        if (estimate!=null) ledger.reserved_cost+=estimate;
        ledger.attempts++;
        const log={provider:m.id,case_id:vars.case_id,attempt:attempt+1,started_at:new Date().toISOString(),status:'running'};
        ledger.attemptsLog.push(log);
        try {
          let response;
          if (m.kind==='agentlab') {
            const effectiveTimeout=Math.max(1,Math.min(c.timeout_ms,c.deadline_at-Date.now()));
            const cellHash=crypto.createHash('sha256').update(`${m.id}|${prompt}`).digest('hex').slice(0,14);
            if(m.model_config_id&&!key)throw new Error('AgentLab 授权凭证已删除或服务重启，请重新导入授权');
            const body=await this.transport(`${(m.agent_url||m.base_url).replace(/\/$/,'')}/api/benchmark/run`,{method:'POST',headers:{'Content-Type':'application/json',...(m.model_config_id?{Authorization:`Bearer ${key}`}:{})},body:{task_id:`${c.run_id}-${vars.case_id}-${vars.repeat_index}-${cellHash}`,question:vars.question,research_instructions:prompt,mode:m.agent_mode,execution_mode:m.model_config_id?'live':c.agent_execution_mode||'mock',model_config_id:m.model_config_id,expected_config_version:m.config_version,max_calls:c.agent_max_calls,timeout_seconds:Math.ceil(c.timeout_ms/1000),provider:c.agent_provider,temperature:m.temperature??c.temperature,max_tokens:m.max_tokens??c.max_tokens},timeout_ms:effectiveTimeout,agent:true});
            if (body.schema_version!=='1.0'||typeof body.output!=='string') throw new Error('AgentLab 返回格式不符合 schema_version 1.0');
            ledger.agent_model_calls+=body.metrics?.model_calls||0;
            response={output:body.output,...(body.metrics?.success===false?{error:'AgentLab 报告任务失败'}:{}),metadata:{...body.metrics,execution_mode:body.execution_mode,model_config:body.model_config,sources:body.sources,trace:body.trace,input_tokens:body.metrics?.input_tokens??null,output_tokens:body.metrics?.output_tokens??null,cost_usd:body.metrics?.cost_usd??null}};
          } else {
            const body=await callModel(m,key,prompt,{temperature:m.temperature??c.temperature,max_tokens:m.max_tokens??c.max_tokens,timeout_ms:Math.max(1,Math.min(c.timeout_ms,c.deadline_at-Date.now()))},this.transport);
            const input=body.input_tokens, output=body.output_tokens;
            const cost=!body.cache_pricing_unknown&&input!=null&&output!=null&&m.input_price_per_million!=null&&m.output_price_per_million!=null ? (input*m.input_price_per_million+output*m.output_price_per_million)/1e6 : null;
            response={output:body.output,...(input!=null&&output!=null?{tokenUsage:{total:input+output,prompt:input,completion:output}}:{}),...(cost==null?{}:{cost}),metadata:{execution_mode:'live',...body,input_tokens:input,output_tokens:output,cost_usd:cost}};
          }
          response.metadata={...response.metadata,latency_ms:performance.now()-started,attempts:attempt+1};
          const successfulCost=response.metadata.cost_usd;
          ledger.cost+=successfulCost||0;
          if (estimate!=null) {ledger.reserved_cost-=estimate;ledger.committed_cost+=successfulCost??estimate;}
          const knownTokens=(response.metadata.input_tokens??0)+(response.metadata.output_tokens??0);ledger.known_token_subtotal+=knownTokens;
          ledger.tokenUsage=ledger.tokenUsage!=null&&response.metadata.input_tokens!=null&&response.metadata.output_tokens!=null?ledger.tokenUsage+knownTokens:null;
          log.status='complete';log.cost_usd=response.metadata.cost_usd;log.latency_ms=response.metadata.latency_ms;log.input_tokens=response.metadata.input_tokens;log.output_tokens=response.metadata.output_tokens;
          if(attempt>0){response.metadata={...response.metadata,successful_attempt_cost_usd:successfulCost,successful_attempt_input_tokens:response.metadata.input_tokens,successful_attempt_output_tokens:response.metadata.output_tokens,cost_usd:null,input_tokens:null,output_tokens:null,uncertain_attempts:attempt};}
          return redactValue(response,[key]);
        } catch(error) {
          log.status='error';log.error=scrub(error);log.category=error.category||null;last=error;
          log.input_tokens=null;log.output_tokens=null;log.cost_usd=null;ledger.tokenUsage=null;
          // 传输错误可能已计费：保留该次保守预算，不把未知费用当作免费。
          if (estimate!=null) {ledger.reserved_cost-=estimate;ledger.committed_cost+=estimate;}
          if (!error.retryable && !['timeout','network'].includes(error.category)) break;
          if (attempt<c.retries) await delay(Math.min(3000,250*2**attempt));
        }
      }
      throw last;
    } catch(error) {
      return {error:(m.id.startsWith('judge-')?'[STUDIO_EVALUATION_ERROR] ':'')+scrub(error),metadata:{transport_error:true,error_category:error.category||null,execution_mode:m.kind==='mock'?'mock':m.kind==='agentlab'&&!m.model_config_id?c.agent_execution_mode:'live',latency_ms:performance.now()-started,input_tokens:null,output_tokens:null,cost_usd:null}};
    } finally {
      if (c.ledger_file) atomic(c.ledger_file,ledger);
    }
  }
}

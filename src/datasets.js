import { parse } from 'csv-parse/sync';
import { hash } from './storage.js';
import { validateVisionCases, canScoreAccuracy } from './vision-schema.js';
import {validateLexicon} from './lexicon.js';
import {defaultLabelLexicon} from './vision-metrics.js';

const ALLOWED = new Set(['contains','icontains','not-contains','equals','is-json']);
const split = v => Array.isArray(v) ? v : typeof v === 'string' ? v.split('|').map(x=>x.trim()).filter(Boolean) : [];
export function validateCases(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) throw new Error('数据集须包含 1–200 条样本');
  const ids = new Set();
  return input.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`第 ${i+1} 条不是对象`);
    const id = String(raw.id || `case-${i+1}`);
    if (ids.has(id)) throw new Error(`样本 ID 重复：${id}`);
    ids.add(id);
    const question = String(raw.question || '').trim();
    if (!question || question.length > 12000) throw new Error(`${id}：question 为空或超过 12000 字符`);
    const reference = String(raw.reference || '').trim();
    const facts = split(raw.facts);
    if (!reference || !facts.length) throw new Error(`${id}：须提供人工参考答案 reference 和事实词 facts（CSV 用 | 分隔）`);
    if (facts.length > 20 || facts.some(x=>typeof x!=='string'||x.length>300)) throw new Error(`${id}：事实词最多 20 个，每个最多 300 字符`);
    let assertions = raw.assertions || [];
    if (typeof assertions === 'string') { try { assertions=JSON.parse(assertions); } catch { throw new Error(`${id}：assertions 不是有效 JSON`); } }
    if (!Array.isArray(assertions) || assertions.length>15) throw new Error(`${id}：assertions 须为至多 15 项数组`);
    assertions = assertions.map(a=> {
      if (!a || !ALLOWED.has(a.type)) throw new Error(`${id}：只接受安全原生断言 ${[...ALLOWED].join(', ')}`);
      if (a.type !== 'is-json' && typeof a.value!=='string') throw new Error(`${id}：断言 value 须为字符串`);
      return {type:a.type, ...(a.value === undefined ? {} : {value:a.value}), metric:'rule'};
    });
    const urls = split(raw.source_urls);
    if (urls.some(u=>!/^https?:\/\//.test(u))) throw new Error(`${id}：来源须为 HTTP(S) URL`);
    const expect_json=raw.expect_json===true||raw.expect_json==='true';
    if(expect_json){let j;try{j=JSON.parse(reference);}catch{throw new Error(`${id}：JSON任务的参考答案必须是合法 JSON 对象`);}if(!j||Array.isArray(j)||typeof j!=='object'||Object.values(j).some(v=>typeof v!=='string'))throw new Error(`${id}：JSON参考答案须为字符串字段对象`);}
    return {id,question,reference,facts,difficulty:['simple','medium','hard'].includes(raw.difficulty)?raw.difficulty:'medium',expect_json,assertions,source_urls:urls,notes:String(raw.notes||''),task_type:'text'};
  });
}

/**
 * Detect and validate vision cases. A case is "vision" when task_type === 'vision'
 * or it carries an images array. Text-only cases keep the original schema.
 */
export function validateMixedCases(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) throw new Error('数据集须包含 1–200 条样本');
  const isVision = raw => raw?.task_type === 'vision' || Array.isArray(raw?.images);
  const visionRaw = input.filter(isVision);
  const textRaw = input.filter(r => !isVision(r));
  const results = [];
  if (textRaw.length) results.push(...validateCases(textRaw));
  if (visionRaw.length) results.push(...validateVisionCases(visionRaw));
  const byId = new Map(results.map(r => [r.id, r]));
  return input.map((raw, i) => {
    const fallbackId = String(raw.id || (isVision(raw) ? `vcase-${i+1}` : `case-${i+1}`));
    return byId.get(fallbackId) || results[i];
  });
}

export function importDataset({name,format,content,cases,task_type,label_lexicon}) {
  if (!String(name||'').trim()) throw new Error('请填写数据集名称');
  let rows = cases;
  if (!rows) {
    if (typeof content!=='string' || content.length>2_000_000) throw new Error('导入内容为空或超过 2MB');
    if (format==='csv') rows=parse(content,{columns:true,skip_empty_lines:true,bom:true,trim:true});
    else if (format==='json') { const data=JSON.parse(content); rows=Array.isArray(data)?data:data.cases; }
    else throw new Error('仅支持 CSV 或 JSON');
  }
  const isVision = raw => raw?.task_type === 'vision' || Array.isArray(raw?.images);
  const visionCount = rows.filter(isVision).length;
  const textCount = rows.length - visionCount;
  if (visionCount > 0 && textCount > 0) {
    throw new Error('混合 text/vision 数据集已拒绝：请拆分为纯文本或纯视觉数据集，避免一种模式套错整场断言');
  }
  const isVisionDs = task_type==='vision' || visionCount > 0;
  const validated = isVisionDs ? validateVisionCases(rows) : validateCases(rows);
  const visionCases = isVisionDs ? validated : [];
  if(visionCases.some(c=>c.task_template==='differential')&&visionCases.some(c=>c.task_template!=='differential'))throw new Error('候选鉴别诊断与皮损形态任务需拆为不同数据集，避免混用输出结构');
  return {
    name:String(name).trim().slice(0,100),
    task_type:isVisionDs?'vision':'text',
    cases:validated,
    hash:hash(validated),
    ...(isVisionDs?{
      annotation_version:'1.0',
      label_lexicon:validateLexicon(label_lexicon||{...defaultLabelLexicon(),review_status:'pending',source:'built_in_unreviewed'}),
      vision_meta:{
        case_count:visionCases.length,
        scoreable_cases:visionCases.filter(canScoreAccuracy).length,
        note:'仅完整标注案例参与准确性指标计算；不完整标注只做输出比较与稳定性分析。',
      }
    }:{}),
  };
}

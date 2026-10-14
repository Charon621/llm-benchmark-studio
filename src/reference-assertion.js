// 由 Promptfoo javascript 原生断言调用；这是人工事实词的确定性覆盖检查。
// 不等同于完整语义正确性、临床准确率或人工事实核验。
export default function(output, context) {
  const facts=JSON.parse(context.vars.fact_terms_json||'[]');
  const text=String(output).toLowerCase();
  const matched=facts.filter(f=>text.includes(String(f).toLowerCase()));
  const score=facts.length?matched.length/facts.length:0;
  return {pass:score===1,score,reason:`人工事实词覆盖 ${matched.length}/${facts.length}；命中：${matched.join('、')||'无'}。需人工复核上下文与否定关系。`};
};

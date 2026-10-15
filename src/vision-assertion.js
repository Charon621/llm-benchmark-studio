// Promptfoo javascript assertion for vision tasks.
// Computes deterministic multi-label metrics against human reference labels.
// Does NOT treat keyword coverage as visual recognition accuracy.
import {
  computeLabelMetrics,
  evaluateAbstention,
  flagHallucinations,
  parseVisionOutput,
  defaultLabelLexicon,
} from './vision-metrics.js';
import {canScoreAccuracy,applicableMetrics} from './vision-schema.js';

export default function (output, context) {
  const vars = context?.vars || {};
  let gt = {};
  try { gt = JSON.parse(vars.vision_ground_truth_json || '{}'); } catch { gt = {}; }
  let annotation={},lexicon=defaultLabelLexicon();
  try{annotation=JSON.parse(vars.vision_annotation_json||'{}');lexicon=JSON.parse(vars.vision_lexicon_json||'null')||lexicon;}catch{}
  const caseObj={ground_truth:gt,annotation,task_template:vars.task_template};
  const complete = canScoreAccuracy(caseObj);
  const referenceLabels = Array.isArray(gt.lesion_labels) ? gt.lesion_labels : [];
  const parsed = parseVisionOutput(output,vars.task_template);

  const labelMetrics = computeLabelMetrics(parsed.observed_features, referenceLabels, {
    complete: complete && parsed.valid,
    lexicon,
  });
  const abstention = evaluateAbstention(parsed.abstain, parsed.abstain_reason, parsed.valid&&applicableMetrics(caseObj).abstention_metrics?gt:{});
  const halluc = flagHallucinations(parsed.observed_features, referenceLabels, {
    complete: complete && parsed.valid,
    lexicon,
  });

  const fpCount = halluc.filter(h => h.status === 'false_positive').length;
  const unverified = halluc.filter(h => h.status === 'unverified_by_reference').length;

  // Pass criteria: JSON valid + (if scoreable) F1 >= 0.5 + no wrong abstention.
  let pass = parsed.valid;
  if (labelMetrics.computable) pass = pass && (labelMetrics.f1==null?labelMetrics.exact_match===1:labelMetrics.f1 >= 0.5);
  if (abstention.verdict === 'wrong_abstain' || abstention.verdict === 'forced_answer') pass = false;

  const score = labelMetrics.computable ? (labelMetrics.f1??labelMetrics.exact_match) : (parsed.valid ? 1 : 0);

  const reasonParts = [
    `JSON${parsed.valid ? '合规' : '不合规'}`,
    labelMetrics.computable
      ? `标签 P=${labelMetrics.precision==null?'不可计算':(labelMetrics.precision * 100).toFixed(1)+'%'} R=${labelMetrics.recall==null?'不可计算':(labelMetrics.recall * 100).toFixed(1)+'%'} F1=${labelMetrics.f1==null?'不可计算':(labelMetrics.f1 * 100).toFixed(1)+'%'} EM=${labelMetrics.exact_match}`
      : `标签准确性不可计算（${labelMetrics.reason}）；断言分数仅表示结构合规`,
    `命中 ${labelMetrics.hits.length}/${referenceLabels.length || 0}`,
    `漏检 ${labelMetrics.misses.length}`,
    fpCount > 0 ? `疑似错误识别 ${fpCount}` : (unverified > 0 ? `未被参考证实 ${unverified}` : '无多余标签'),
    `拒答判定 ${abstention.verdict}`,
  ];
  return { pass, score, reason: reasonParts.join('；') + '。' };
}

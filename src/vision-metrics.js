/**
 * Vision evaluation metrics: multi-label precision/recall/F1/exact-match,
 * abstention quality, hallucination flags, and label-set stability.
 *
 * Accuracy metrics are ONLY computed when human annotation is complete.
 * Incomplete annotation yields "unverified" flags, never fake accuracy.
 */

// ---------- Label normalisation ----------

/**
 * Controlled vocabulary + synonym map. Versioned so experiment snapshots can freeze it.
 * Medical concepts with different meaning MUST NOT be merged.
 */
export function defaultLabelLexicon() {
  return {
    version: '1.0',
    labels: [
      '脱毛', '鳞屑', '红斑', '结痂', '丘疹', '脓疱', '糜烂', '溃疡', '结节', '色素沉着', '苔藓化', '抓痕',
    ],
    synonyms: {
      '脱毛': ['毛发脱落', '局部缺毛', '掉毛', 'alopecia', 'hair loss'],
      '鳞屑': ['皮屑', '脱屑', 'scale', 'scaling'],
      '红斑': ['发红', '红肿', 'erythema', 'redness'],
      '结痂': ['痂皮', 'crust', 'scab'],
      '丘疹': ['小疙瘩', 'papule'],
      '脓疱': ['脓点', 'pustule'],
      '糜烂': ['表皮破损', 'erosion'],
      '溃疡': ['溃烂', 'ulcer'],
      '结节': ['硬块', 'nodule'],
      '色素沉着': ['色素沉淀', 'hyperpigmentation'],
      '苔藓化': ['皮肤增厚', 'lichenification'],
      '抓痕': ['搔抓痕迹', 'excoriation'],
    },
  };
}

export function normalizeLabels(rawLabels, lexicon = defaultLabelLexicon()) {
  if (!Array.isArray(rawLabels)) return [];
  const synonymToCanon = new Map();
  for (const [canon, syns] of Object.entries(lexicon.review_status==='pending'?{}:lexicon.synonyms || {})) {
    synonymToCanon.set(canon.toLowerCase(), canon);
    for (const s of syns) synonymToCanon.set(String(s).toLowerCase(), canon);
  }
  for (const l of lexicon.labels || []) synonymToCanon.set(String(l).toLowerCase(), l);
  const seen = new Set();
  const out = [];
  for (const raw of rawLabels) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) continue;
    const canon = synonymToCanon.get(key) || String(raw).trim();
    if (!seen.has(canon)) { seen.add(canon); out.push(canon); }
  }
  return out;
}

// ---------- Multi-label metrics ----------

/**
 * Compare predicted vs reference label sets.
 * Returns per-micro and per-macro statistics plus hit/miss/false-positive detail.
 * Returns null metrics when reference labels are absent or incomplete.
 */
export function computeLabelMetrics(predicted, reference, { complete = true, lexicon } = {}) {
  const pred = normalizeLabels(predicted, lexicon);
  const ref = normalizeLabels(reference, lexicon);
  if (!complete) {
    return {
      computable: false,
      reason: '参考标注不完整，不计算标签准确性指标',
      predicted: pred,
      reference: ref,
      hits: [], misses: [], false_positives: [],
      precision: null, recall: null, f1: null, exact_match: null,
    };
  }
  const refSet = new Set(ref), predSet = new Set(pred);
  const hits = ref.filter(l => predSet.has(l));
  const misses = ref.filter(l => !predSet.has(l));
  const false_positives = pred.filter(l => !refSet.has(l));
  const tp = hits.length, fp = false_positives.length, fn = misses.length;
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = 2*tp+fp+fn===0 ? null : 2*tp/(2*tp+fp+fn);
  const exact_match = pred.length === ref.length && hits.length === ref.length ? 1 : 0;
  return { computable: true, predicted: pred, reference: ref, hits, misses, false_positives, precision, recall, f1, exact_match, tp, fp, fn };
}

/**
 * Aggregate Micro-F1 and Macro-F1 across many cases.
 * Cases without computable label metrics are excluded from accuracy aggregates
 * and counted separately.
 */
export function aggregateLabelMetrics(caseMetricsList) {
  const valid = caseMetricsList.filter(m => m?.computable);
  const excluded = caseMetricsList.length - valid.length;
  if (!valid.length) {
    return { micro_precision: null, micro_recall: null, micro_f1: null, macro_f1: null, exact_match_rate: null, scored_cases: 0, excluded_cases: excluded, note: '没有可计算的完整标注案例' };
  }
  let tp = 0, fp = 0, fn = 0, exactSum = 0, f1Sum = 0;
  for (const m of valid) {
    tp += m.tp; fp += m.fp; fn += m.fn;
    exactSum += m.exact_match;
    if(m.f1!=null)f1Sum += m.f1;
  }
  const micro_precision = tp + fp === 0 ? null : tp / (tp + fp);
  const micro_recall = tp + fn === 0 ? null : tp / (tp + fn);
  const micro_f1 = 2*tp+fp+fn===0?null:2*tp/(2*tp+fp+fn);
  return {
    micro_precision,
    micro_recall,
    micro_f1,
    macro_f1: valid.some(m=>m.f1!=null)?f1Sum/valid.filter(m=>m.f1!=null).length:null,
    macro_f1_denominator: valid.filter(m=>m.f1!=null).length,
    exact_match_rate: exactSum / valid.length,
    scored_cases: valid.length,
    excluded_cases: excluded,
  };
}

// ---------- Abstention ----------

/**
 * Classify abstention behaviour against answerability ground truth.
 * Four cells: correct-abstain, wrong-abstain (should answer), forced-answer (should abstain), correct-answer.
 */
export function evaluateAbstention(modelAbstain, abstainReason, groundTruth) {
  const shouldAbstain = groundTruth?.answerability === 'unanswerable';
  const hasGT = ['answerable','unanswerable'].includes(groundTruth?.answerability);
  const abstain = modelAbstain === true;
  let verdict;
  if (!hasGT) verdict = 'no_ground_truth';
  else if (shouldAbstain && abstain) verdict = 'correct_abstain';
  else if (shouldAbstain && !abstain) verdict = 'forced_answer';
  else if (!shouldAbstain && abstain) verdict = 'wrong_abstain';
  else verdict = 'correct_answer';
  return { verdict, should_abstain: shouldAbstain, model_abstain: abstain, abstain_reason: abstainReason || '', has_ground_truth: hasGT };
}

export function aggregateAbstention(results) {
  const withGT = results.filter(r => r.has_ground_truth);
  const counts = { correct_abstain: 0, forced_answer: 0, wrong_abstain: 0, correct_answer: 0, no_ground_truth: results.length - withGT.length };
  for (const r of results) if (counts[r.verdict] != null) counts[r.verdict]++;
  const total = withGT.length || 0;
  return {
    ...counts,
    abstain_rate: total ? results.filter(r => r.has_ground_truth && r.model_abstain).length / total : null,
    correct_abstain_rate: total ? counts.correct_abstain / total : null,
    wrong_abstain_rate: total ? counts.wrong_abstain / total : null,
    forced_answer_rate: total ? counts.forced_answer / total : null,
    note: '拒答次数多不等于更安全；须结合 answerability 参考条件判断。',
  };
}

// ---------- Hallucination flags ----------

/**
 * Flag predicted labels absent from reference.
 * When annotation is complete → label-level false positives (can contribute to error).
 * When incomplete → "unverified_by_reference" only; NOT asserted as hallucination.
 */
export function flagHallucinations(predicted, reference, { complete = true, lexicon } = {}) {
  const pred = normalizeLabels(predicted, lexicon);
  const ref = new Set(normalizeLabels(reference, lexicon));
  if (!complete) {
    return pred.map(label => ({ label, status: 'unverified_by_reference' }));
  }
  return pred.map(label => ref.has(label) ? { label, status: 'supported' } : { label, status: 'false_positive' });
}

// ---------- Stability ----------

/** Jaccard similarity between two label sets. */
export function jaccard(a, b) {
  const sa = new Set(normalizeLabels(a)), sb = new Set(normalizeLabels(b));
  if (!sa.size && !sb.size) return 1;
  const inter = [...sa].filter(x => sb.has(x)).length;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * Stability across repeated runs of the same input.
 * Returns text exact-match ratio AND mean pairwise Jaccard of label sets.
 * Never call this "accuracy".
 */
export function computeStability(outputs) {
  // outputs: array of { text, labels }
  if (!Array.isArray(outputs) || outputs.length < 2) return { text_stability: null, label_stability: null, note: '重复次数不足' };
  const n = outputs.length;
  const textHashes = outputs.map(o => String(o.text ?? ''));
  const textCounts = new Map();
  for (const t of textHashes) textCounts.set(t, (textCounts.get(t) || 0) + 1);
  const text_stability = Math.max(...textCounts.values()) / n;
  let jSum = 0, pairs = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    jSum += jaccard(outputs[i].labels || [], outputs[j].labels || []);
    pairs++;
  }
  return { text_stability, label_stability: pairs ? jSum / pairs : null, repeats: n, note: '稳定性不是准确率；稳定地重复错误仍然很稳定。' };
}

// ---------- Structured output parsing ----------

/**
 * Parse the standard vision JSON output. Returns nulls on invalid JSON so
 * downstream can mark "格式错误" rather than inventing labels.
 */
export function parseVisionOutput(text, taskTemplate='lesion') {
  const raw = String(text ?? '').trim();
  if (!raw) return { valid: false, observed_features: [], description: '', abstain: false, abstain_reason: '', missing_information: [], raw };
  // Try to extract the first JSON object if the model wrapped it in prose.
  let jsonText = raw;
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) jsonText = match[0];
  try {
    const obj = JSON.parse(jsonText);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { valid: false, observed_features: [], description: raw.slice(0, 2000), abstain: false, abstain_reason: '', missing_information: [], raw };
    const strings=a=>Array.isArray(a)&&a.length<=100&&a.every(v=>typeof v==='string'&&v.length<=2000);
    if((taskTemplate!=='differential'&&!strings(obj.observed_features))||typeof obj.description!=='string'||typeof obj.abstain!=='boolean'||!strings(obj.missing_information)||obj.abstain_reason!=null&&typeof obj.abstain_reason!=='string'||obj.abstain&&!obj.abstain_reason?.trim())throw new Error('输出字段不符合结构');
    if(taskTemplate==='differential'&&(!strings(obj.differential_diagnoses)||!strings(obj.evidence_limitations)))throw new Error('鉴别诊断字段缺失');
    return {
      valid: true,
      observed_features: taskTemplate==='differential'?[]:obj.observed_features,
      description: String(obj.description || ''),
      abstain: obj.abstain === true,
      abstain_reason: String(obj.abstain_reason || ''),
      missing_information: Array.isArray(obj.missing_information) ? obj.missing_information.map(String) : [],
      raw,
      ...(taskTemplate==='differential'?{differential_diagnoses:obj.differential_diagnoses,evidence_limitations:obj.evidence_limitations}:{}),
    };
  } catch {
    return { valid: false, observed_features: [], description: raw.slice(0, 2000), abstain: false, abstain_reason: '', missing_information: [], raw };
  }
}

// ---------- Standard vision prompt template ----------

export function visionPromptTemplate(taskKind = 'lesion') {
  const taskHint = {
    lesion: '观察图片中能够直接观察到的皮损形态特征。不要给出最终疾病诊断。',
    ocr: '识别图片中的文字内容。',
    vqa: '根据图片回答问题。',
    general: '描述图片内容并回答问题。',
    abstention: '判断图片是否足以回答问题；信息不足时明确拒答并列出缺失信息。',
    multi_image: '按 overview / closeup / reference 的顺序综合多张图，区分可观察事实和推断。',
    differential: '仅提出待验证的鉴别诊断线索，不作最终诊断。另须输出 differential_diagnoses 和 evidence_limitations 两个字符串数组；此任务不计算皮损标签 F1。',
  }[taskKind] || '描述图片内容并回答问题。';
  return `你是严谨的视觉分析助手。${taskHint}

请仅输出合法 JSON，不要输出其他文本：
{
  "observed_features": ["从图片中直接观察到的特征标签"],
  "description": "对图片的客观描述",
  "abstain": false,
  "abstain_reason": "",
  "missing_information": ["若信息不足，列出缺少什么"]
}

当图片严重模糊、关键区域被遮挡、或任务所需信息无法从图片获得时，设 "abstain": true 并填写 "abstain_reason"。不要编造图中不存在的特征。

问题：{{question}}`;
}

import { validateImageRefs } from './assets.js';

const ANSWERABILITY = new Set(['answerable', 'unanswerable', 'partial']);
const DIFFICULTY = new Set(['simple', 'medium', 'hard']);
const REVIEW_STATUS = new Set(['pending', 'reviewed', 'rejected']);

/**
 * Validate a single vision test case.
 * Text-only fields (reference/facts) are NOT required — vision tasks use
 * multi-label ground truth instead. Task-type-specific required fields are
 * enforced here so incomplete annotations cannot produce fake accuracy.
 */
export function validateVisionCase(raw, index = 0) {
  if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 条不是对象`);
  const id = String(raw.id || `vcase-${index + 1}`);
  const task_type = raw.task_type === 'vision' ? 'vision' : String(raw.task_type || 'vision');
  if (task_type !== 'vision') throw new Error(`${id}：task_type 须为 vision`);

  const question = String(raw.question || '').trim();
  if (!question || question.length > 12000) throw new Error(`${id}：question 为空或超过 12000 字符`);

  const images = validateImageRefs(raw.images);

  // Ground truth: multi-label style. Optional but when present must be well-formed.
  let ground_truth = null;
  if (raw.ground_truth != null) {
    if (typeof raw.ground_truth !== 'object' || Array.isArray(raw.ground_truth)) throw new Error(`${id}：ground_truth 须为对象`);
    const gt = raw.ground_truth;
    if(gt.lesion_labels!=null&&(!Array.isArray(gt.lesion_labels)||gt.lesion_labels.some(x=>typeof x!=='string'||!x.trim()||x.length>100)))throw new Error(`${id}：lesion_labels 须为非空字符串数组，完整阴性案例可用空数组`);
    const lesion_labels = Array.isArray(gt.lesion_labels) ? gt.lesion_labels.map(x => String(x).trim()).filter(Boolean) : null;
    if (lesion_labels && lesion_labels.length > 50) throw new Error(`${id}：标签最多 50 个`);
    const answerability = gt.answerability == null ? null : String(gt.answerability);
    if (answerability && !ANSWERABILITY.has(answerability)) throw new Error(`${id}：answerability 须为 answerable / unanswerable / partial`);
    const label_completeness = gt.label_completeness == null ? 'unknown' : String(gt.label_completeness);
    if (!['complete', 'incomplete', 'unknown'].includes(label_completeness)) throw new Error(`${id}：label_completeness 须为 complete / incomplete / unknown`);
    const reference_answer = gt.reference_answer == null ? null : String(gt.reference_answer).slice(0, 8000);
    const reference_text = gt.reference_text == null ? null : String(gt.reference_text).slice(0, 8000);
    ground_truth = {
      ...(lesion_labels ? { lesion_labels } : {}),
      ...(answerability ? { answerability } : {}),
      label_completeness,
      ...(reference_answer != null ? { reference_answer } : {}),
      ...(reference_text != null ? { reference_text } : {}),
    };
  }

  let annotation = null;
  if (raw.annotation != null) {
    if (typeof raw.annotation !== 'object' || Array.isArray(raw.annotation)) throw new Error(`${id}：annotation 须为对象`);
    const source = String(raw.annotation.source || 'unknown');
    const review_status = String(raw.annotation.review_status || 'pending');
    if (!REVIEW_STATUS.has(review_status)) throw new Error(`${id}：review_status 须为 pending / reviewed / rejected`);
    annotation = {
      source: source.slice(0, 40),
      review_status,
      ...(raw.annotation.notes != null ? { notes: String(raw.annotation.notes).slice(0, 2000) } : {}),
    };
  }

  const difficulty = DIFFICULTY.has(raw.difficulty) ? raw.difficulty : 'medium';
  const task_template = raw.task_template == null ? null : String(raw.task_template).slice(0, 60);
  if(task_template&&!['lesion','abstention','multi_image','differential','general','ocr','vqa'].includes(task_template))throw new Error('任务模板无效');

  // Optional text-style fields kept for cross-task compatibility.
  const reference = raw.reference == null ? null : String(raw.reference).slice(0, 12000);
  const facts = Array.isArray(raw.facts) ? raw.facts.map(x => String(x).trim()).filter(Boolean).slice(0, 20) : null;

  return {
    id,
    task_type: 'vision',
    question,
    images,
    ground_truth,
    annotation,
    difficulty,
    ...(raw.source_urls?{source_urls:Array.isArray(raw.source_urls)?raw.source_urls.filter(u=>typeof u==='string'&&/^https?:\/\//.test(u)).slice(0,20):[]}:{}),
    ...(task_template ? { task_template } : {}),
    ...(reference != null ? { reference } : {}),
    ...(facts ? { facts } : {}),
  };
}

/**
 * Whether the case has enough human annotation to compute accuracy metrics.
 * Without complete labels we may only run comparison / stability / compliance.
 */
export function canScoreAccuracy(caseObj) {
  const gt = caseObj?.ground_truth;
  if (!gt || !Array.isArray(gt.lesion_labels)) return false;
  if(caseObj.task_template==='differential')return false;
  if(caseObj.annotation?.review_status!=='reviewed'||!['human','expert','veterinarian','manual'].includes(caseObj.annotation?.source))return false;
  if (gt.label_completeness === 'incomplete' || gt.label_completeness === 'unknown') return false;
  if (gt.label_completeness === 'complete') return true;
  // If completeness not stated but labels exist and are non-empty, treat as scoreable
  // only when the caller explicitly marked completeness; otherwise be conservative.
  return false;
}

/**
 * Determine which metric families apply to a case.
 */
export function applicableMetrics(caseObj) {
  const gt = caseObj?.ground_truth || {};
  return {
    label_metrics: canScoreAccuracy(caseObj),
    abstention_metrics: caseObj.annotation?.review_status==='reviewed' && ['human','expert','veterinarian','manual'].includes(caseObj.annotation?.source) && ['answerable','unanswerable'].includes(gt.answerability),
    compliance: true,
    stability: true,
  };
}

export function validateVisionCases(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) throw new Error('数据集须包含 1—200 条样本');
  const ids = new Set();
  return input.map((raw, i) => {
    const c = validateVisionCase(raw, i);
    if (ids.has(c.id)) throw new Error(`样本 ID 重复：${c.id}`);
    ids.add(c.id);
    return c;
  });
}

export const VISION_SCHEMA_VERSION = '1.0';

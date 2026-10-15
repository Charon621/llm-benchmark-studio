import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLabels,
  computeLabelMetrics,
  aggregateLabelMetrics,
  evaluateAbstention,
  aggregateAbstention,
  flagHallucinations,
  jaccard,
  computeStability,
  parseVisionOutput,
  defaultLabelLexicon,
  visionPromptTemplate,
} from '../src/vision-metrics.js';

test('label synonym normalisation maps known synonyms to canonical form', () => {
  const lex = defaultLabelLexicon();
  const out = normalizeLabels(['毛发脱落', 'alopecia', '皮屑', 'Scale', '红斑'], lex);
  assert.deepEqual(out, ['脱毛', '鳞屑', '红斑']);
});

test('normalisation keeps unknown labels and deduplicates', () => {
  const out = normalizeLabels(['脱毛', '脱毛', '未知标签'], defaultLabelLexicon());
  assert.deepEqual(out, ['脱毛', '未知标签']);
});

test('computeLabelMetrics calculates precision recall F1 exact-match correctly', () => {
  const m = computeLabelMetrics(['脱毛', '鳞屑', '结痂'], ['脱毛', '鳞屑', '红斑'], { complete: true });
  assert.equal(m.computable, true);
  assert.deepEqual(m.hits.sort(), ['脱毛', '鳞屑']);
  assert.deepEqual(m.misses, ['红斑']);
  assert.deepEqual(m.false_positives, ['结痂']);
  assert.equal(m.precision, 2 / 3);
  assert.equal(m.recall, 2 / 3);
  assert.ok(Math.abs(m.f1 - 2 / 3) < 1e-9);
  assert.equal(m.exact_match, 0);
});

test('exact match is 1 only when sets are identical', () => {
  const m = computeLabelMetrics(['脱毛', '鳞屑'], ['鳞屑', '脱毛'], { complete: true });
  assert.equal(m.exact_match, 1);
  assert.equal(m.f1, 1);
});

test('incomplete annotation yields non-computable accuracy', () => {
  const m = computeLabelMetrics(['脱毛'], ['脱毛', '红斑'], { complete: false });
  assert.equal(m.computable, false);
  assert.match(m.reason, /不完整/);
});

test('complete empty reference counts false positives and preserves undefined denominators', () => {
  const m = computeLabelMetrics(['脱毛'], [], { complete: true });
  assert.equal(m.computable, true);assert.equal(m.f1,0);assert.equal(m.recall,null);
  const empty=computeLabelMetrics([],[],{complete:true});assert.equal(empty.exact_match,1);assert.equal(empty.f1,null);
});

test('aggregateLabelMetrics computes Micro-F1 and Macro-F1', () => {
  const a = computeLabelMetrics(['A', 'B'], ['A', 'B'], { complete: true }); // tp=2 fp=0 fn=0
  const b = computeLabelMetrics(['A'], ['A', 'B'], { complete: true });      // tp=1 fp=0 fn=1
  const agg = aggregateLabelMetrics([a, b]);
  assert.equal(agg.scored_cases, 2);
  assert.equal(agg.micro_precision, 3 / 3); // tp=3, fp=0
  assert.equal(agg.micro_recall, 3 / 4);    // tp=3, fn=1
  assert.ok(agg.macro_f1 > 0);
  assert.equal(agg.exact_match_rate, 0.5);
});

test('abstention evaluation covers four verdicts', () => {
  assert.equal(evaluateAbstention(true, '模糊', { answerability: 'unanswerable' }).verdict, 'correct_abstain');
  assert.equal(evaluateAbstention(false, '', { answerability: 'unanswerable' }).verdict, 'forced_answer');
  assert.equal(evaluateAbstention(true, '不确定', { answerability: 'answerable' }).verdict, 'wrong_abstain');
  assert.equal(evaluateAbstention(false, '', { answerability: 'answerable' }).verdict, 'correct_answer');
  assert.equal(evaluateAbstention(false, '', {}).verdict, 'no_ground_truth');
});

test('hallucination flags distinguish complete vs incomplete annotation', () => {
  const complete = flagHallucinations(['脱毛', '编造'], ['脱毛'], { complete: true });
  assert.equal(complete.find(h => h.label === '脱毛').status, 'supported');
  assert.equal(complete.find(h => h.label === '编造').status, 'false_positive');
  const incomplete = flagHallucinations(['脱毛', '编造'], ['脱毛'], { complete: false });
  assert.equal(incomplete.find(h => h.label === '编造').status, 'unverified_by_reference');
});

test('jaccard similarity works on label sets', () => {
  assert.equal(jaccard(['A', 'B'], ['A', 'B']), 1);
  assert.equal(jaccard(['A'], ['B']), 0);
  assert.equal(jaccard(['A', 'B'], ['B', 'C']), 1 / 3);
});

test('computeStability returns text and label stability separately', () => {
  const s = computeStability([
    { text: 'hello', labels: ['A', 'B'] },
    { text: 'hello', labels: ['A'] },
    { text: 'hello', labels: ['A', 'B'] },
  ]);
  assert.equal(s.text_stability, 1);
  assert.ok(s.label_stability > 0 && s.label_stability < 1);
});

test('parseVisionOutput extracts structured JSON and flags invalid', () => {
  const ok = parseVisionOutput('{"observed_features":["脱毛"],"description":"d","abstain":false,"abstain_reason":"","missing_information":[]}');
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.observed_features, ['脱毛']);
  const bad = parseVisionOutput('这不是JSON');
  assert.equal(bad.valid, false);
  // Wrapped in prose
  const wrapped = parseVisionOutput('Here is the result: {"observed_features":["红斑"],"description":"","abstain":false,"abstain_reason":"","missing_information":[]} done');
  assert.equal(wrapped.valid, true);
  assert.deepEqual(wrapped.observed_features, ['红斑']);
});

test('visionPromptTemplate includes question placeholder and JSON structure', () => {
  const t = visionPromptTemplate('lesion');
  assert.match(t, /\{\{question\}\}/);
  assert.match(t, /observed_features/);
  assert.match(t, /abstain/);
});

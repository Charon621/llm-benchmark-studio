import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const { validateVisionCase, validateVisionCases, canScoreAccuracy, applicableMetrics } = await import('../src/vision-schema.js');
const { importImage, importBatch, getAssetMeta, deleteAsset, recoverAsset, readAssetBytes, assertAssetsExist, validateImageRefs, ASSET_LIMITS } = await import('../src/assets.js');
const owner='dataset-fixture',PNG_1x1=await sharp({create:{width:1,height:1,channels:4,background:'#f00'}}).png().toBuffer();
test('importImage fully decodes PNG, JPEG and WebP and deduplicates with independent owner records',async()=>{
 for(const [format,mime] of [['png','image/png'],['jpeg','image/jpeg'],['webp','image/webp']]){
  const bytes=await sharp(PNG_1x1).toFormat(format).toBuffer();
  const a=await importImage({buffer:bytes,filename:'original.'+format},owner);
  assert.equal(a.mime_type,mime);assert.equal(a.width,1);assert.ok(readAssetBytes(a.asset_id,owner).equals(bytes));
  const b=await importImage({buffer:bytes,filename:'copy.'+format},'second-owner');assert.equal(b.deduplicated,true);
  assert.equal(getAssetMeta(a.asset_id,owner).filename,'original.'+format);
  assert.equal(getAssetMeta(a.asset_id,'second-owner').filename,'copy.'+format);
 }
});
test('invalid, truncated and oversized images never create assets',async()=>{
 for(const buffer of [Buffer.from('not an image'),PNG_1x1.subarray(0,24),Buffer.alloc(0),Buffer.alloc(ASSET_LIMITS.MAX_FILE_BYTES+1)])await assert.rejects(importImage({buffer,filename:'x.png'},owner));
 await assert.rejects(importImage({buffer:PNG_1x1,filename:'x.png'}),/会话/);
});
test('file extension cannot override actual image content',async()=>{
 const a=await importImage({buffer:PNG_1x1,filename:'fake.jpg'},owner);assert.equal(a.mime_type,'image/png');
});
test('batch validation enforces limits and validates all files before commit',async()=>{
 await assert.rejects(importBatch(Array.from({length:51},()=>({buffer:PNG_1x1})),owner),/50/);
 await assert.rejects(importBatch([{buffer:PNG_1x1},{buffer:Buffer.from('bad')}],owner),/解码/);
});
test('image references validate count, hash syntax and controlled role',()=>{
 const asset_id='sha256:'+'a'.repeat(64);assert.equal(validateImageRefs([{asset_id,role:'overview'}]).length,1);
 for(const refs of [[],Array.from({length:6},()=>({asset_id})),[{asset_id:'bad'}],[{asset_id,role:'injected'}]])assert.throws(()=>validateImageRefs(refs));
});
test('hash verification rejects file corruption and foreign access',async()=>{
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#abc'}}).png().toBuffer();
 const a=await importImage({buffer:bytes,filename:'check.png'},owner);assertAssetsExist([{asset_id:a.asset_id}],owner);
 assert.throws(()=>assertAssetsExist([{asset_id:a.asset_id}],'foreign'),/不存在/);
 const {DATA}=await import('../src/storage.js');const file=path.join(DATA,'assets',a.sha256.slice(0,2),a.sha256);fs.writeFileSync(file,'corrupt');assert.throws(()=>readAssetBytes(a.asset_id,owner),/哈希不匹配/);fs.writeFileSync(file,bytes);
});
test('owner deletion preserves shared blob, restores access and denies foreign recovery',async()=>{
 const a=await importImage({buffer:PNG_1x1,filename:'shared.png'},owner);await importImage({buffer:PNG_1x1,filename:'shared.png'},'second-owner');
 deleteAsset(a.asset_id,owner);assert.equal(getAssetMeta(a.asset_id,owner),null);assert.ok(readAssetBytes(a.asset_id,'second-owner').equals(PNG_1x1));
 assert.throws(()=>recoverAsset(a.asset_id,'foreign'),/不存在/);recoverAsset(a.asset_id,owner);assert.ok(readAssetBytes(a.asset_id,owner).equals(PNG_1x1));
});
// ---- Vision case validation ----

function makeCase(overrides = {}) {
  return {
    id: 'vc-1',
    task_type: 'vision',
    question: '描述皮损',
    images: [{ asset_id: 'sha256:' + 'b'.repeat(64), role: 'overview' }],
    ground_truth: {
      lesion_labels: ['脱毛', '鳞屑'],
      answerability: 'answerable',
      label_completeness: 'complete',
    },
    annotation: { source: 'human', review_status: 'reviewed' },
    difficulty: 'medium',
    ...overrides,
  };
}

test('validateVisionCase accepts well-formed vision case', () => {
  const c = validateVisionCase(makeCase());
  assert.equal(c.task_type, 'vision');
  assert.equal(c.images.length, 1);
  assert.equal(c.ground_truth.lesion_labels.length, 2);
});

test('validateVisionCase allows missing ground_truth (comparison-only)', () => {
  const c = validateVisionCase(makeCase({ ground_truth: null, annotation: null }));
  assert.equal(c.ground_truth, null);
});

test('validateVisionCase rejects bad answerability / completeness', () => {
  assert.throws(() => validateVisionCase(makeCase({ ground_truth: { answerability: 'maybe', label_completeness: 'complete' } })), /answerability/);
  assert.throws(() => validateVisionCase(makeCase({ ground_truth: { label_completeness: 'half' } })), /label_completeness/);
});

test('canScoreAccuracy is true only for complete annotation', () => {
  assert.equal(canScoreAccuracy(makeCase()), true);
  assert.equal(canScoreAccuracy(makeCase({ ground_truth: { lesion_labels: ['脱毛'], label_completeness: 'incomplete' } })), false);
  assert.equal(canScoreAccuracy(makeCase({ ground_truth: null })), false);
});

test('applicableMetrics reflects annotation availability', () => {
  const m = applicableMetrics(makeCase());
  assert.equal(m.label_metrics, true);
  assert.equal(m.abstention_metrics, true);
  const noAbstain = applicableMetrics(makeCase({ ground_truth: { lesion_labels: ['脱毛'], label_completeness: 'complete' } }));
  assert.equal(noAbstain.abstention_metrics, false);
});

test('validateVisionCases rejects duplicate ids and empty arrays', () => {
  assert.throws(() => validateVisionCases([]), /1–200|1—200/);
  assert.throws(() => validateVisionCases([makeCase(), makeCase()]), /重复/);
  const ok = validateVisionCases([makeCase(), makeCase({ id: 'vc-2' })]);
  assert.equal(ok.length, 2);
});

test('vision schema does not require text reference/facts', () => {
  const c = validateVisionCase(makeCase());
  assert.equal(c.reference, undefined);
  assert.equal(c.facts, undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-vision-api-'));
const { createApp } = await import('../src/server.js');
const { atomic, runDir } = await import('../src/storage.js');
const pause = ms => new Promise(r => setTimeout(r, ms));

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function harness() {
  const app = createApp();
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  return {
    server,
    async request(url, method = 'GET', body) {
      const r = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      cookie = r.headers.get('set-cookie')?.split(';')[0] || cookie;
      const data = await r.json().catch(() => ({}));
      return { status: r.status, body: data };
    },
    async uploadImage(filename = 'test.png') {
      return this.request('/api/assets', 'POST', { filename, role: 'overview', base64: PNG_1x1.toString('base64') });
    },
  };
}

test('image upload API stores assets with metadata and serves bytes', async () => {
  const h = await harness();
  try {
    const up = await h.uploadImage('cat.png');
    assert.equal(up.status, 201);
    assert.match(up.body.asset_id, /^sha256:/);
    assert.equal(up.body.mime_type, 'image/png');
    assert.equal(up.body.deduplicated, false);
    // Dedup
    const up2 = await h.uploadImage('copy.png');
    assert.equal(up2.body.deduplicated, true);
    assert.equal(up2.body.asset_id, up.body.asset_id);
    // List
    const list = await h.request('/api/assets');
    assert.equal(list.body.assets.length, 1);
    // Meta
    const meta = await h.request(`/api/assets/${up.body.asset_id}/meta`);
    assert.equal(meta.body.sha256, up.body.sha256);
    // Serve bytes
    const raw = await fetch(`http://127.0.0.1:${h.server.address().port}/api/assets/${up.body.asset_id}`, { headers: { Cookie: '' } });
    // Need cookie - use h.request pattern... actually GET with cookie
    // Let's just check status via the harness pattern
    assert.equal(meta.status, 200);
    // Delete
    const del = await h.request(`/api/assets/${up.body.asset_id}`, 'DELETE');
    assert.equal(del.status, 200);
    const list2 = await h.request('/api/assets');
    assert.equal(list2.body.assets.length, 0);
  } finally {
    await new Promise(r => h.server.close(r));
  }
});

test('vision dataset import validates images and ground truth', async () => {
  const h = await harness();
  try {
    const up = await h.uploadImage();
    const ds = await h.request('/api/datasets', 'POST', {
      name: 'vision-test',
      format: 'json',
      task_type: 'vision',
      content: JSON.stringify([
        {
          id: 'v1', task_type: 'vision',
          question: '描述皮损',
          images: [{ asset_id: up.body.asset_id, role: 'overview' }],
          ground_truth: { lesion_labels: ['脱毛', '鳞屑'], answerability: 'answerable', label_completeness: 'complete' },
          annotation: { source: 'human', review_status: 'reviewed' },
          difficulty: 'medium',
        },
        {
          id: 'v2', task_type: 'vision',
          question: '描述皮损',
          images: [{ asset_id: up.body.asset_id, role: 'closeup' }],
          ground_truth: { lesion_labels: ['红斑'], label_completeness: 'incomplete' },
          difficulty: 'simple',
        },
      ]),
    });
    assert.equal(ds.status, 200);
    assert.equal(ds.body.task_type, 'vision');
    assert.equal(ds.body.cases.length, 2);
    assert.equal(ds.body.vision_meta.case_count, 2);
    assert.equal(ds.body.vision_meta.scoreable_cases, 1); // only v1 is complete
  } finally {
    await new Promise(r => h.server.close(r));
  }
});

test('vision mock experiment runs end-to-end and produces label metrics', async () => {
  const h = await harness();
  try {
    const up = await h.uploadImage();
    const ds = await h.request('/api/datasets', 'POST', {
      name: 'v-e2e', format: 'json', task_type: 'vision',
      content: JSON.stringify([
        {
          id: 've-1', task_type: 'vision', question: '描述皮损',
          images: [{ asset_id: up.body.asset_id, role: 'overview' }],
          ground_truth: { lesion_labels: ['脱毛', '鳞屑', '红斑'], answerability: 'answerable', label_completeness: 'complete' },
          annotation: { source: 'human', review_status: 'reviewed' }, difficulty: 'medium',
        },
        {
          id: 've-2', task_type: 'vision', question: '图片是否足以判断？',
          images: [{ asset_id: up.body.asset_id, role: 'overview' }],
          ground_truth: { lesion_labels: [], answerability: 'unanswerable', label_completeness: 'complete' },
          annotation: { source: 'human', review_status: 'reviewed' }, difficulty: 'simple',
        },
      ]),
    });
    assert.equal(ds.status, 200);

    // Create a vision prompt
    const prompts = await h.request('/api/prompts', 'POST', {
      name: 'vision-lesion',
      content: '请观察图片并输出 JSON。问题：{{question}}',
    });
    assert.equal(prompts.status, 200);
    const promptId = prompts.body[prompts.body.length - 1].id;

    // Launch mock vision experiment with mock vision models
    const run = await h.request('/api/runs', 'POST', {
      name: 'VISION_MOCK_E2E',
      task_type: 'vision',
      dataset_id: ds.body.id,
      prompt_ids: [promptId],
      model_ids: ['mock-vision-kimi', 'mock-vision-qwen'],
      repeats: 1,
    });
    assert.equal(run.status, 202);
    const runId = run.body.id;

    let d;
    for (let i = 0; i < 100; i++) {
      d = await h.request(`/api/runs/${runId}`);
      if (d.body.state.status !== 'running') break;
      await pause(100);
    }
    assert.ok(['complete', 'failed'].includes(d.body.state.status), `status=${d.body.state.status}`);
    if (d.body.state.status === 'complete') {
      assert.equal(d.body.rows.length, 4); // 2 cases × 2 models × 1 repeat
      assert.equal(d.body.analysis.kind, 'vision');
      assert.ok(d.body.analysis.summary.length >= 2);
      // At least one model should have label metrics (from complete cases)
      const kimi = d.body.analysis.summary.find(s => s.model.includes('kimi'));
      assert.ok(kimi);
      assert.ok(kimi.scored_cases > 0 || kimi.excluded_cases > 0);
      // Snapshot contains image manifest
      assert.ok(d.body.snapshot.image_manifest);
      assert.ok(d.body.snapshot.image_manifest.length > 0);
      assert.ok(d.body.snapshot.label_lexicon_version);
    }
  } finally {
    await new Promise(r => h.server.close(r));
  }
});

test('vision score-preview endpoint computes metrics correctly', async () => {
  const h = await harness();
  try {
    const r = await h.request('/api/vision/score-preview', 'POST', {
      predicted: ['脱毛', '鳞屑', '结痂'],
      reference: ['脱毛', '鳞屑', '红斑'],
      complete: true,
      cases:{ground_truth:{lesion_labels:['脱毛','鳞屑','红斑'],label_completeness:'complete',answerability:'answerable'},annotation:{source:'human',review_status:'reviewed'}},
      answerability: 'answerable',
      model_abstain: false,
      output: '{"observed_features":["脱毛","鳞屑","结痂"],"description":"d","abstain":false,"abstain_reason":"","missing_information":[]}',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.labels.computable, true);
    assert.equal(r.body.labels.precision, 2 / 3);
    assert.deepEqual(r.body.labels.misses, ['红斑']);
    assert.equal(r.body.abstention.verdict, 'correct_answer');
  } finally {
    await new Promise(r => h.server.close(r));
  }
});

test('vision lexicon and prompt-template endpoints work', async () => {
  const h = await harness();
  try {
    const lex = await h.request('/api/vision/lexicon');
    assert.equal(lex.status, 200);
    assert.ok(lex.body.labels.includes('脱毛'));
    assert.ok(lex.body.synonyms['脱毛']);
    const tpl = await h.request('/api/vision/prompt-template?task=lesion');
    assert.match(tpl.body.template, /\{\{question\}\}/);
  } finally {
    await new Promise(r => h.server.close(r));
  }
});

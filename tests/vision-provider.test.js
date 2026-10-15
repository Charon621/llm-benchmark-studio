import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRequest, normalizeResponse } from '../src/transport.js';
import { defaultLabelLexicon } from '../src/vision-metrics.js';

const visionModel = {
  id: 'test-vision', model: 'test-vl', protocol: 'openai', provider: 'kimi',
  base_url: 'https://api.example.com/v1', send_temperature: true,
  max_tokens: 100, temperature: 1,
  capabilities: { text: true, vision: true }, max_images: 5,
};
const textOnlyModel = {
  id: 'test-text', model: 'test-text', protocol: 'openai', provider: 'qwen',
  base_url: 'https://api.example.com/v1', send_temperature: true,
  max_tokens: 100, temperature: 0,
  capabilities: { text: true, vision: false },
};

const img = (role = 'overview') => ({ base64: Buffer.from('fake').toString('base64'), mime_type: 'image/jpeg', role });

test('text-only request keeps original message shape', () => {
  const req = makeRequest(textOnlyModel, '你好', { temperature: 0, max_tokens: 50 });
  assert.equal(req.body.messages.length, 2);
  assert.equal(typeof req.body.messages[1].content, 'string');
  assert.equal(req.url, 'https://api.example.com/v1/chat/completions');
});

test('vision request builds OpenAI image_url content parts in order', () => {
  const req = makeRequest(visionModel, '描述图片', {
    temperature: 1, max_tokens: 50,
    images: [img('overview'), img('closeup')],
  });
  const user = req.body.messages[1].content;
  assert.ok(Array.isArray(user));
  // text role, image, text role, image, text question
  assert.equal(user[0].type, 'text');
  assert.match(user[0].text, /overview/);
  assert.equal(user[1].type, 'image_url');
  assert.match(user[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(user[2].type, 'text');
  assert.equal(user[3].type, 'image_url');
  assert.equal(user[4].type, 'text');
  assert.equal(user[4].text, '描述图片');
});

test('vision request builds Anthropic image blocks', () => {
  const anthropicModel = { ...visionModel, protocol: 'anthropic', provider: 'anthropic' };
  const req = makeRequest(anthropicModel, '描述图片', {
    temperature: 1, max_tokens: 50,
    images: [img('overview')],
  });
  const user = req.body.messages[0].content;
  assert.ok(Array.isArray(user));
  assert.equal(user[0].type, 'text');
  assert.equal(user[1].type, 'image');
  assert.equal(user[1].source.type, 'base64');
  assert.equal(user[1].source.media_type, 'image/jpeg');
  assert.equal(user[2].type, 'text');
  assert.equal(req.url, 'https://api.example.com/v1/messages');
});

test('vision request rejects models without vision capability', () => {
  assert.throws(() => makeRequest(textOnlyModel, 'x', { images: [img()] }), /图片输入/);
});

test('vision request enforces max_images', () => {
  const six = Array.from({ length: 6 }, (_, i) => img(`r${i}`));
  assert.throws(() => makeRequest(visionModel, 'x', { images: six }), /最多/);
});

test('temperature follows explicit model capabilities, not provider name', () => {
  const kimi = { ...visionModel, provider: 'kimi' };
  const req = makeRequest(kimi, 'x', { temperature: 0.3, max_tokens: 10 });
  assert.equal(req.body.temperature, 0.3);
  assert.equal(makeRequest({...kimi,fixed_temperature:1},'x').body.temperature,1);
});

test('normalizeResponse handles OpenAI usage tokens', () => {
  const body = { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 }, model: 'm' };
  const r = normalizeResponse(textOnlyModel, body);
  assert.equal(r.output, 'hi');
  assert.equal(r.input_tokens, 3);
  assert.equal(r.output_tokens, 2);
});

test('vision fixture assertion file computes metrics from parsed output', async () => {
  const { default: visionAssert } = await import('../src/vision-assertion.js');
  const output = JSON.stringify({ observed_features: ['脱毛', '鳞屑'], description: 'd', abstain: false, abstain_reason: '', missing_information: [] });
  const result = visionAssert(output, {
    vars: {
      vision_annotation_json:JSON.stringify({source:'human',review_status:'reviewed'}),vision_ground_truth_json: JSON.stringify({ lesion_labels: ['脱毛', '鳞屑'], label_completeness: 'complete', answerability: 'answerable' }),
    },
  });
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
  assert.match(result.reason, /F1=100/);
});

test('vision assertion fails on wrong abstention', async () => {
  const { default: visionAssert } = await import('../src/vision-assertion.js');
  const output = JSON.stringify({ observed_features: [], description: '', abstain: true, abstain_reason: '不确定', missing_information: [] });
  const result = visionAssert(output, {
    vars: { vision_annotation_json:JSON.stringify({source:'human',review_status:'reviewed'}),vision_ground_truth_json: JSON.stringify({ lesion_labels: ['脱毛'], label_completeness: 'complete', answerability: 'answerable' }) },
  });
  assert.equal(result.pass, false);
  assert.match(result.reason, /wrong_abstain/);
});

test('vision assertion refuses to score incomplete annotation', async () => {
  const { default: visionAssert } = await import('../src/vision-assertion.js');
  const output = JSON.stringify({ observed_features: ['脱毛'], description: '', abstain: false, abstain_reason: '', missing_information: [] });
  const result = visionAssert(output, {
    vars: { vision_annotation_json:JSON.stringify({source:'human',review_status:'reviewed'}),vision_ground_truth_json: JSON.stringify({ lesion_labels: ['脱毛', '红斑'], label_completeness: 'incomplete' }) },
  });
  assert.match(result.reason, /不可计算|不完整/);
  assert.match(result.reason,/不可计算/); // remaining score represents JSON compliance, not accuracy
});

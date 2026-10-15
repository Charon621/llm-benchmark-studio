/**
 * Test bootstrap. Must be imported BEFORE any src/ module.
 * Sets isolated data dir, strips real credentials, and blocks unregistered
 * external model endpoints so no test can accidentally call a live provider.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

// 1. Isolated data directory (before any src/ import resolves DATA).
// A supplied path is never trusted by the test entrypoint: it may be production.
process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));

// 2. Strip real credentials / live flags / proxy so tests never see them.
const SECRET_ENV = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'QWEN_API_KEY', 'KIMI_API_KEY',
  'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'DASHSCOPE_API_KEY',
  'STUDIO_ENABLE_LIVE', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
  'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy',
];
for (const key of SECRET_ENV) delete process.env[key];
for(const key of Object.keys(process.env))if(/(?:API_?KEY|GRANT|SECRET|TOKEN|PASSWORD)/i.test(key))delete process.env[key];

// 3. Force offline-safe Promptfoo settings.
process.env.PROMPTFOO_DISABLE_TELEMETRY = '1';
process.env.PROMPTFOO_DISABLE_UPDATE = '1';
process.env.PROMPTFOO_DISABLE_SHARING = '1';
process.env.PROMPTFOO_CACHE_ENABLED = 'false';

// 3b. Block unregistered external model addresses in transport layer.
process.env.STUDIO_TEST_BLOCK_EXTERNAL = '1';
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const options=net._normalizeArgs(args)[0];
  const host=options.host||'localhost';
  if(options.port&&!['127.0.0.1','::1','localhost'].includes(host))throw new Error('[TEST_NETWORK_BLOCK] External socket denied');
  return originalConnect.apply(this,args);
};

// 4. Guard: block any real external HTTPS that is not a registered fixture.
//    Fixture transport in tests uses http://127.0.0.1 which is allowed.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (/^https?:\/\//i.test(url)) {
    const u = new URL(url);
    const isLocal = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    if (!isLocal) {
      throw new Error(`[TEST_NETWORK_BLOCK] Blocked external request to ${u.hostname} in test mode`);
    }
  }
  return originalFetch(input, init);
};

export const TEST_DATA_DIR = process.env.STUDIO_DATA_DIR;

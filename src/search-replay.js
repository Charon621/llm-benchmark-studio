import crypto from 'node:crypto';
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
export function validateSearchSnapshot(value){
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>500000||value.miss_policy!=='empty_offline'||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))throw new Error('固定检索快照无效');
  const {sha256,...body}=value,actual=crypto.createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
  if(actual!==sha256)throw new Error('检索快照哈希不匹配');
  return structuredClone(value);
}

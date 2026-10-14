import crypto from 'node:crypto';
import {ensurePrimaryOwner} from './storage.js';
export function sessions(req,res,next) {
  const value=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('studio_session='))?.slice(15);
  const token=/^[a-f0-9]{64}$/.test(value||'')?value:crypto.randomBytes(32).toString('hex');
  if(token!==value)res.setHeader('Set-Cookie',`studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
  req.owner=crypto.createHash('sha256').update(token).digest('hex');if(req.path!=='/api/health')ensurePrimaryOwner(req.owner);next();
}
export function assertOwnedRun(state,owner) {if(state?.owner_hash!==owner)throw Object.assign(new Error('实验不存在或不属于当前会话'),{status:404});}
export function publicState(state) {const {owner_hash,...value}=state;return value;}

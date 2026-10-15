import {hash} from './storage.js';
export function validateLexicon(input){
  if(!input||typeof input.version!=='string'||!input.version.trim()||input.version.length>60||!Array.isArray(input.labels)||input.labels.length>200)throw new Error('词表须包含版本和至多 200 个标签');
  const labels=input.labels.map(l=>{if(typeof l!=='string'||!l.trim()||l.length>100)throw new Error('标签无效');return l.trim()});
  if(new Set(labels.map(l=>l.toLowerCase())).size!==labels.length)throw new Error('词表标签重复');
  const owner=new Map(labels.map(l=>[l.toLowerCase(),l])),synonyms={};
  if(input.synonyms&&(!input.synonyms||typeof input.synonyms!=='object'||Array.isArray(input.synonyms)))throw new Error('同义词映射须为对象');
  for(const [canonical,aliases] of Object.entries(input.synonyms||{})){
    if(!labels.includes(canonical)||!Array.isArray(aliases)||aliases.length>50)throw new Error('同义词须指向已存在的标签');
    synonyms[canonical]=aliases.map(alias=>{if(typeof alias!=='string'||!alias.trim()||alias.length>100)throw new Error('同义词无效');const key=alias.trim().toLowerCase();if(owner.has(key)&&owner.get(key)!==canonical)throw new Error('同义词冲突：'+alias);owner.set(key,canonical);return alias.trim()});
  }
  const value={version:input.version.trim(),labels,synonyms,review_status:input.review_status==='reviewed'?'reviewed':'pending',source:String(input.source||'user_import').slice(0,100)};
  return {...value,sha256:hash(value)};
}

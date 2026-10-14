// Explicit test-only dependency injection. Production rejects these HTTP URLs.
export async function fixtureTransport(url,options={}) {
  const u=new URL(url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1')throw new Error('fixture only');
  const response=await fetch(url,{method:options.method||'POST',headers:options.headers,body:options.body==null?undefined:JSON.stringify(options.body),redirect:'manual',signal:AbortSignal.timeout(options.timeout_ms||1000)});
  if(!response.ok)throw Object.assign(new Error(`API HTTP ${response.status}（响应正文不保存）`),{category:({401:'authentication',404:'not_found',429:'rate_limit'})[response.status]||'http',retryable:response.status===429||response.status>=500});
  return response.json();
}

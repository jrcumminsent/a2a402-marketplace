export const baseHeaders={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,content-type,x-agent-id',
  'access-control-allow-methods':'GET,POST,PATCH,OPTIONS'
};

export function reply(statusCode,value,extraHeaders={}){
  return {statusCode,headers:{...baseHeaders,...extraHeaders},body:JSON.stringify(value)};
}

export function errorResponse(error){
  const message=String(error?.message||'unexpected error');
  const lower=message.toLowerCase();
  let status=400,code='INVALID_REQUEST',retryable=false;
  if(lower==='unauthorized'||lower.includes('invalid auth')){status=401;code='UNAUTHORIZED'}
  else if(lower.includes('agent mismatch')||lower.includes('only job creator')||lower.includes('only contract creator')||lower.includes('only contract worker')||lower.includes('not authorized')){status=403;code='FORBIDDEN'}
  else if(lower.includes('not found')){status=404;code='NOT_FOUND'}
  else if(lower.includes('not open')||lower.includes('already')||lower.includes('active delivery')||lower.includes('not awaiting')||lower.includes('duplicate')||lower.includes('conflict')){status=409;code='STATE_CONFLICT'}
  else if(lower.includes('required')||lower.includes('must ')||lower.includes('invalid')||lower.includes('supports at most')||lower.includes('positive')||lower.includes('payload too large')){status=422;code='VALIDATION_FAILED'}
  else if(lower.includes('temporarily')||lower.includes('timeout')||lower.includes('rpc http 429')||lower.includes('rpc http 5')){status=503;code='TEMPORARILY_UNAVAILABLE';retryable=true}
  return reply(status,{error:{code,message,retryable}});
}

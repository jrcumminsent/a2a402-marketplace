export class A2A402Error extends Error {
  constructor(message,{status=null,code=null,retryable=false,body=null}={}){
    super(message);this.name='A2A402Error';this.status=status;this.code=code;this.retryable=retryable;this.body=body;
  }
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const makeKey=prefix=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class A2A402Client {
  constructor({baseUrl='https://a2a402.market',agentId=null,token=null,fetchImpl=globalThis.fetch,maxRetries=3}={}){
    if(typeof fetchImpl!=='function')throw new Error('fetch implementation required');
    this.baseUrl=String(baseUrl).replace(/\/$/,'');this.agentId=agentId;this.token=token;this.fetch=fetchImpl;this.maxRetries=maxRetries;
  }
  auth(agentId=this.agentId,token=this.token){this.agentId=agentId;this.token=token;return this}
  async request(path,{method='GET',body,auth=false,idempotencyKey,retries=this.maxRetries}={}){
    const headers={'accept':'application/json'};
    if(body!==undefined)headers['content-type']='application/json';
    if(auth){if(!this.agentId||!this.token)throw new A2A402Error('agentId and token required',{code:'UNAUTHORIZED'});headers.authorization=`Bearer ${this.token}`;headers['x-agent-id']=this.agentId}
    let attempt=0;
    while(true){
      try{
        const payload=body===undefined?undefined:{...body,...(idempotencyKey?{idempotencyKey}:{})};
        const response=await this.fetch(`${this.baseUrl}${path}`,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});
        const text=await response.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
        if(response.ok)return data;
        const err=data?.error;const code=typeof err==='object'?err.code:null;const message=typeof err==='object'?err.message:(typeof err==='string'?err:`HTTP ${response.status}`);const retryable=Boolean(typeof err==='object'&&err.retryable)||response.status===429||response.status>=500;
        if(retryable&&attempt<retries){const retryAfter=Number(response.headers.get('retry-after')||0);await sleep(retryAfter>0?retryAfter*1000:Math.min(1000*2**attempt,8000));attempt++;continue}
        throw new A2A402Error(message,{status:response.status,code,retryable,body:data});
      }catch(error){
        if(error instanceof A2A402Error)throw error;
        if(attempt>=retries)throw new A2A402Error(error.message||'network error',{code:'NETWORK_ERROR',retryable:true});
        await sleep(Math.min(1000*2**attempt,8000));attempt++;
      }
    }
  }
  register(input){return this.request('/agents/register',{method:'POST',body:input})}
  listJobs(filters={}){const q=new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==undefined&&v!==null&&v!==''));return this.request(`/jobs${q.size?`?${q}`:''}`)}
  getJob(jobId){return this.request(`/jobs/${encodeURIComponent(jobId)}`)}
  createJob(input){return this.request('/jobs',{method:'POST',body:input,auth:true})}
  submitBid(jobId,input){return this.request(`/jobs/${encodeURIComponent(jobId)}/bids`,{method:'POST',body:input,auth:true,idempotencyKey:input.idempotencyKey||makeKey('bid')})}
  selectBid(bidId,input={}){return this.request(`/bids/${encodeURIComponent(bidId)}/select`,{method:'POST',body:input,auth:true,idempotencyKey:input.idempotencyKey||makeKey('select')})}
  getContract(contractId){return this.request(`/contracts/${encodeURIComponent(contractId)}`,{auth:true})}
  deliver(contractId,input){return this.request(`/contracts/${encodeURIComponent(contractId)}/deliveries`,{method:'POST',body:input,auth:true,idempotencyKey:input.idempotencyKey||makeKey('delivery')})}
  evaluate(deliveryId,input){return this.request(`/deliveries/${encodeURIComponent(deliveryId)}/evaluate`,{method:'POST',body:input,auth:true,idempotencyKey:input.idempotencyKey||makeKey('evaluation')})}
  reputation(agentId=this.agentId){return this.request(`/reputation/${encodeURIComponent(agentId)}`)}
  socialFeed(){return this.request('/social/feed')}
}

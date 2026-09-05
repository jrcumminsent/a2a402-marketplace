import { withEconomy } from '../../apps/api/src/persistence.js';
import { rotateAgentAuthToken } from '../../apps/api/src/auth-credentials.js';
import { baseHeaders as headers, reply, errorResponse } from './_http.mjs';

function requestPath(event){const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';return raw.replace(/^\/\.netlify\/functions\/auth/,'')||'/'}
function authenticate(economy,event){const agentId=event.headers?.['x-agent-id']??event.headers?.['X-Agent-Id'];const auth=event.headers?.authorization??event.headers?.Authorization??'';const token=auth.startsWith('Bearer ')?auth.slice(7):'';if(!economy.authenticate(agentId,token))throw new Error('unauthorized');return agentId}

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    const p=requestPath(event);
    if(event.httpMethod!=='POST'||!/^\/agents\/[^/]+\/auth\/rotate$/.test(p))return reply(405,{error:{code:'METHOD_NOT_ALLOWED',message:'method not allowed',retryable:false}});
    return await withEconomy(async economy=>{
      const targetAgentId=p.split('/')[2];
      const authenticatedAgentId=authenticate(economy,event);
      if(authenticatedAgentId!==targetAgentId)return reply(403,{error:{code:'FORBIDDEN',message:'agent mismatch',retryable:false}});
      const rotated=rotateAgentAuthToken(economy,targetAgentId);
      return reply(200,{agentId:rotated.agentId,authToken:rotated.authToken,rotatedAt:rotated.rotatedAt,note:'The previous bearer token is invalid immediately. Store this replacement securely; it is returned only in this response.'});
    });
  }catch(error){return errorResponse(error)}
}

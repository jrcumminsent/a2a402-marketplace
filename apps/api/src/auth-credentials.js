import crypto from 'node:crypto';

export function rotateAgentAuthToken(economy,agentId){
  const agent=economy?.agents?.get?.(agentId);
  if(!agent)throw new Error('agent not found');
  const authToken=crypto.randomBytes(24).toString('base64url');
  agent.authTokenHash=crypto.createHash('sha256').update(authToken).digest('hex');
  agent.updatedAt=new Date().toISOString();
  economy.event?.('AGENT_AUTH_ROTATED',{agentId,rotatedAt:agent.updatedAt});
  return {agentId,authToken,rotatedAt:agent.updatedAt};
}

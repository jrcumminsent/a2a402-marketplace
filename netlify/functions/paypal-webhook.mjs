import { withEconomy } from '../../apps/api/src/persistence.js';

const reply=(statusCode,value)=>({statusCode,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(value)});
const env=name=>String(process.env[name]||'').trim();
const apiBase=()=>env('PAYPAL_ENVIRONMENT').toLowerCase()==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';

async function accessToken(){
  const clientId=env('PAYPAL_CLIENT_ID'),secret=env('PAYPAL_CLIENT_SECRET');
  if(!clientId||!secret)throw new Error('PayPal credentials not configured');
  const auth=Buffer.from(clientId+':'+secret).toString('base64');
  const res=await fetch(apiBase()+'/v1/oauth2/token',{method:'POST',headers:{authorization:'Basic '+auth,'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  const body=await res.json();
  if(!res.ok||!body.access_token)throw new Error('PayPal access token request failed');
  return body.access_token;
}

async function verifyWebhook(event,payload){
  const webhookId=env('PAYPAL_WEBHOOK_ID');
  if(!webhookId)throw new Error('PAYPAL_WEBHOOK_ID not configured');
  const token=await accessToken();
  const h=event.headers||{};
  const res=await fetch(apiBase()+'/v1/notifications/verify-webhook-signature',{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({
      auth_algo:h['paypal-auth-algo']||h['PayPal-Auth-Algo'],
      cert_url:h['paypal-cert-url']||h['PayPal-Cert-Url'],
      transmission_id:h['paypal-transmission-id']||h['PayPal-Transmission-Id'],
      transmission_sig:h['paypal-transmission-sig']||h['PayPal-Transmission-Sig'],
      transmission_time:h['paypal-transmission-time']||h['PayPal-Transmission-Time'],
      webhook_id:webhookId,
      webhook_event:payload
    })
  });
  const body=await res.json();
  if(!res.ok||body.verification_status!=='SUCCESS')throw new Error('PayPal webhook signature verification failed');
  return true;
}

export async function handler(event){
  try{
    if(event.httpMethod==='GET')return reply(200,{ok:true,integration:'paypal',environment:env('PAYPAL_ENVIRONMENT')||'sandbox',configured:Boolean(env('PAYPAL_CLIENT_ID')&&env('PAYPAL_CLIENT_SECRET')&&env('PAYPAL_WEBHOOK_ID'))});
    if(event.httpMethod!=='POST')return reply(405,{error:'method not allowed'});
    if(!event.body)return reply(400,{error:'missing webhook body'});
    const payload=JSON.parse(event.body);
    await verifyWebhook(event,payload);
    await withEconomy(async economy=>{
      economy.events=Array.isArray(economy.events)?economy.events:[];
      economy.events.push({
        type:'PAYPAL_WEBHOOK',
        at:new Date().toISOString(),
        provider:'paypal',
        eventId:payload.id||null,
        eventType:payload.event_type||null,
        resourceType:payload.resource_type||null,
        summary:payload.summary||null,
        resourceId:payload.resource?.id||null,
        status:payload.resource?.status||null
      });
      if(economy.events.length>1000)economy.events=economy.events.slice(-1000);
      return true;
    });
    return reply(200,{ok:true});
  }catch(error){
    return reply(400,{error:error.message});
  }
}

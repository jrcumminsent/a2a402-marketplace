import { withEconomy } from '../../apps/api/src/persistence.js';

const getEnv=(name)=>String(Netlify.env.get(name)||'').trim();
const paypalBase=()=>getEnv('PAYPAL_ENVIRONMENT').toLowerCase()==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';

const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});

async function getAccessToken(){
  const clientId=getEnv('PAYPAL_CLIENT_ID');
  const secret=getEnv('PAYPAL_CLIENT_SECRET');
  if(!clientId||!secret)throw new Error('PayPal credentials not configured');
  const auth=btoa(clientId+':'+secret);
  const res=await fetch(paypalBase()+'/v1/oauth2/token',{
    method:'POST',
    headers:{authorization:'Basic '+auth,'content-type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials'
  });
  const body=await res.json();
  if(!res.ok||!body.access_token)throw new Error('PayPal authentication failed');
  return body.access_token;
}

async function verifyWebhook(req,payload){
  const webhookId=getEnv('PAYPAL_WEBHOOK_ID');
  if(!webhookId)throw new Error('PAYPAL_WEBHOOK_ID not configured');
  const token=await getAccessToken();
  const res=await fetch(paypalBase()+'/v1/notifications/verify-webhook-signature',{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({
      auth_algo:req.headers.get('paypal-auth-algo'),
      cert_url:req.headers.get('paypal-cert-url'),
      transmission_id:req.headers.get('paypal-transmission-id'),
      transmission_sig:req.headers.get('paypal-transmission-sig'),
      transmission_time:req.headers.get('paypal-transmission-time'),
      webhook_id:webhookId,
      webhook_event:payload
    })
  });
  const body=await res.json();
  if(!res.ok||body.verification_status!=='SUCCESS')throw new Error('PayPal webhook signature verification failed');
}

export default async (req)=>{
  try{
    if(req.method==='GET'){
      await getAccessToken();
      return json({
        ok:true,
        integration:'paypal',
        environment:getEnv('PAYPAL_ENVIRONMENT')||'sandbox',
        credentialsVerified:true,
        webhookConfigured:Boolean(getEnv('PAYPAL_WEBHOOK_ID'))
      });
    }
    if(req.method!=='POST')return json({error:'method not allowed'},405);
    const raw=await req.text();
    if(!raw)return json({error:'missing webhook body'},400);
    const payload=JSON.parse(raw);
    await verifyWebhook(req,payload);

    await withEconomy(async economy=>{
      economy.events=Array.isArray(economy.events)?economy.events:[];
      economy.events.push({
        type:'PAYPAL_WEBHOOK',
        at:new Date().toISOString(),
        provider:'paypal',
        eventId:payload.id||null,
        eventType:payload.event_type||null,
        resourceType:payload.resource_type||null,
        resourceId:payload.resource?.id||null,
        status:payload.resource?.status||null
      });
      if(economy.events.length>1000)economy.events=economy.events.slice(-1000);
    });

    return json({ok:true});
  }catch(error){
    return json({error:error.message||String(error)},400);
  }
};

export const config={
  path:'/payments/paypal/webhook',
  method:['GET','POST']
};

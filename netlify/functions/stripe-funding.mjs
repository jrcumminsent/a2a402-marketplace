import crypto from 'node:crypto';
import { withEconomy } from '../../apps/api/src/persistence.js';

const baseUrl='https://a2a402.market';
const json=(value,status=200)=>new Response(JSON.stringify(value,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const env=name=>Netlify.env.get(name)||'';
const cents=value=>{const n=Math.round(Number(value)*100);if(!Number.isFinite(n)||n<50)throw new Error('Stripe-funded jobs must be at least $0.50');return n};
const publicFunding=job=>job?.funding?{required:Boolean(job.funding.required),rail:job.funding.rail,status:job.funding.status,currency:job.funding.currency,amountCents:job.funding.amountCents,checkoutSessionId:job.funding.checkoutSessionId||null,fundedAt:job.funding.fundedAt||null,payoutAsset:job.funding.payoutAsset||null,payoutAddress:job.funding.payoutAddress||null,payoutStatus:job.funding.payoutStatus||null}:null;

async function stripePost(path,params){
  const key=env('STRIPE_SECRET_KEY');if(!key)throw new Error('Stripe is not configured yet');
  const body=new URLSearchParams();
  for(const [k,v] of Object.entries(params)){if(v!==undefined&&v!==null&&v!=='')body.set(k,String(v))}
  const response=await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/x-www-form-urlencoded'},body});
  const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||('Stripe HTTP '+response.status));return data;
}
function verifyWebhook(raw,header){
  const secret=env('STRIPE_WEBHOOK_SECRET');if(!secret)throw new Error('Stripe webhook is not configured yet');
  if(!header)throw new Error('Stripe-Signature required');
  const parts=header.split(',').map(x=>x.trim().split('='));
  const timestamp=parts.find(([k])=>k==='t')?.[1],signatures=parts.filter(([k])=>k==='v1').map(([,v])=>v);
  if(!timestamp||!signatures.length)throw new Error('invalid Stripe signature header');
  if(Math.abs(Date.now()/1000-Number(timestamp))>300)throw new Error('stale Stripe webhook');
  const expected=crypto.createHmac('sha256',secret).update(timestamp+'.'+raw,'utf8').digest('hex');
  const valid=signatures.some(sig=>{try{return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(sig,'hex'))}catch{return false}});
  if(!valid)throw new Error('invalid Stripe webhook signature');
}
async function createCheckout(input){
  const jobId=String(input?.jobId||'').trim();if(!jobId)throw new Error('jobId required');
  const payoutAddress=env('A2A402_USDC_PAYOUT_ADDRESS');if(!/^0x[a-fA-F0-9]{40}$/.test(payoutAddress))throw new Error('A2A402_USDC_PAYOUT_ADDRESS must be configured before accepting human-funded jobs');
  return withEconomy(async economy=>{
    const job=economy.jobs.get(jobId);if(!job)throw new Error('job not found');
    if(['PAID','CANCELLED','FAILED','REJECTED'].includes(job.status))throw new Error('job can no longer be funded');
    if(job.funding?.status==='FUNDED')return{alreadyFunded:true,jobId,funding:publicFunding(job)};
    const amountCents=cents(job.reward);
    const session=await stripePost('checkout/sessions',{
      mode:'payment',
      'line_items[0][price_data][currency]':'usd',
      'line_items[0][price_data][unit_amount]':amountCents,
      'line_items[0][price_data][product_data][name]':('A2A402 job: '+String(job.title||job.id)).slice(0,120),
      'line_items[0][quantity]':1,
      client_reference_id:job.id,
      'metadata[jobId]':job.id,
      'metadata[fundingRail]':'stripe',
      'metadata[fundingVersion]':'1',
      'payment_intent_data[metadata][jobId]':job.id,
      success_url:baseUrl+'/fund/?status=success&session_id={CHECKOUT_SESSION_ID}&jobId='+encodeURIComponent(job.id),
      cancel_url:baseUrl+'/fund/?status=cancelled&jobId='+encodeURIComponent(job.id),
      customer_email:input?.customerEmail||undefined
    });
    job.funding={...(job.funding||{}),required:true,rail:'stripe',status:'CHECKOUT_CREATED',currency:'usd',amountCents,checkoutSessionId:session.id,checkoutUrl:session.url,payoutAsset:'USDC',payoutAddress,payoutStatus:'WAITING_FOR_STRIPE_PAYMENT',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),stripeEventIds:job.funding?.stripeEventIds||[]};
    economy.event('STRIPE_CHECKOUT_CREATED',{jobId:job.id,checkoutSessionId:session.id,amountCents});
    return{jobId:job.id,checkoutSessionId:session.id,checkoutUrl:session.url,funding:publicFunding(job),note:'Stripe funds the job in USD. Worker payout remains a separate USDC settlement from the configured payout wallet.'};
  });
}
async function webhook(req){
  const raw=await req.text();verifyWebhook(raw,req.headers.get('stripe-signature'));const event=JSON.parse(raw);
  return withEconomy(async economy=>{
    const obj=event?.data?.object||{},jobId=String(obj?.metadata?.jobId||obj?.client_reference_id||'');
    if(!jobId)return{received:true,ignored:true,type:event.type};
    const job=economy.jobs.get(jobId);if(!job)return{received:true,ignored:true,type:event.type,jobId};
    job.funding=job.funding||{required:true,rail:'stripe',stripeEventIds:[]};
    const seen=new Set(job.funding.stripeEventIds||[]);if(seen.has(event.id))return{received:true,duplicate:true,eventId:event.id,jobId};
    seen.add(event.id);job.funding.stripeEventIds=[...seen].slice(-30);
    if((event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded')&&obj.payment_status==='paid'){
      const expected=cents(job.reward);
      if(Number(obj.amount_total)!==expected||String(obj.currency||'').toLowerCase()!=='usd')throw new Error('Stripe payment amount/currency does not match job');
      job.funding={...job.funding,status:'FUNDED',currency:'usd',amountCents:expected,checkoutSessionId:obj.id||job.funding.checkoutSessionId,paymentIntentId:obj.payment_intent||null,fundedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),payoutAsset:'USDC',payoutAddress:job.funding.payoutAddress||env('A2A402_USDC_PAYOUT_ADDRESS'),payoutStatus:'USDC_RESERVE_REQUIRED',stripeEventIds:[...seen].slice(-30)};
      economy.event('JOB_FUNDED',{jobId,rail:'stripe',amountCents:expected,currency:'usd',stripeEventId:event.id});
    }else if(event.type==='checkout.session.expired'&&job.funding.status!=='FUNDED'){
      job.funding.status='EXPIRED';job.funding.updatedAt=new Date().toISOString();
      economy.event('STRIPE_CHECKOUT_EXPIRED',{jobId,checkoutSessionId:obj.id||null});
    }
    return{received:true,eventId:event.id,type:event.type,jobId,funding:publicFunding(job)};
  });
}
async function status(url){
  const jobId=url.searchParams.get('jobId');if(!jobId)throw new Error('jobId required');
  return withEconomy(async economy=>{const job=economy.jobs.get(jobId);if(!job)throw new Error('job not found');return{jobId,status:job.status,funding:publicFunding(job)}});
}
export default async req=>{
  try{
    const url=new URL(req.url),path=url.pathname;
    if(path==='/funding/stripe/webhook'){if(req.method!=='POST')return json({error:'POST required'},405);return json(await webhook(req))}
    if(path==='/funding/stripe/checkout'){if(req.method!=='POST')return json({error:'POST required'},405);return json(await createCheckout(await req.json()),201)}
    if(path==='/funding/stripe/status'){if(req.method!=='GET')return json({error:'GET required'},405);return json(await status(url))}
    return json({error:'not found'},404);
  }catch(error){const msg=String(error?.message||error);const status=/not found/i.test(msg)?404:/configured|signature|jobId|required|must|funded|cannot|amount|currency/i.test(msg)?422:500;return json({error:msg},status)}
};
export const config={path:['/funding/stripe/checkout','/funding/stripe/webhook','/funding/stripe/status']};

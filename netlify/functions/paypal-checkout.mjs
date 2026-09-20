const env=name=>String(Netlify.env.get(name)||'').trim();
const base=()=>env('PAYPAL_ENVIRONMENT').toLowerCase()==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

async function token(){
  const id=env('PAYPAL_CLIENT_ID'),secret=env('PAYPAL_CLIENT_SECRET');
  if(!id||!secret)throw new Error('PayPal credentials not configured');
  const res=await fetch(base()+'/v1/oauth2/token',{
    method:'POST',
    headers:{authorization:'Basic '+btoa(id+':'+secret),'content-type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials'
  });
  const body=await res.json();
  if(!res.ok||!body.access_token)throw new Error('PayPal authentication failed');
  return body.access_token;
}

async function paypal(path,{method='GET',body,requestId}={}){
  const access=await token();
  const res=await fetch(base()+path,{
    method,
    headers:{
      authorization:'Bearer '+access,
      'content-type':'application/json',
      ...(requestId?{'paypal-request-id':requestId}:{})
    },
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const data=await res.json();
  if(!res.ok)throw new Error(data?.details?.[0]?.description||data?.message||'PayPal request failed');
  return data;
}

export default async (req,context)=>{
  try{
    const environment=env('PAYPAL_ENVIRONMENT')||'sandbox';
    if(!['sandbox','live'].includes(environment))return json({error:'PAYPAL_ENVIRONMENT must be sandbox or live'},500);

    if(req.method==='GET'){
      await token();
      return json({ok:true,environment,mode:environment==='live'?'live-test':'sandbox'});
    }

    if(req.method!=='POST')return json({error:'method not allowed'},405);

    const orderId=context.params?.orderId;
    if(orderId){
      const capture=await paypal('/v2/checkout/orders/'+encodeURIComponent(orderId)+'/capture',{
        method:'POST',
        body:{},
        requestId:'capture-'+orderId
      });
      return json({ok:true,orderId:capture.id,status:capture.status,capture});
    }

    const input=await req.json();
    const amount=Number(input.amount??(environment==='live'?1:5));
    const maxAmount=environment==='live'?5:500;
    if(!Number.isFinite(amount)||amount<0.01||amount>maxAmount)throw new Error(`${environment==='live'?'Live test':'Sandbox'} amount must be between 0.01 and ${maxAmount.toFixed(2)} USD`);

    const order=await paypal('/v2/checkout/orders',{
      method:'POST',
      requestId:'order-'+crypto.randomUUID(),
      body:{
        intent:'CAPTURE',
        purchase_units:[{
          reference_id:String(input.referenceId||`a2a402-${environment}-test`).slice(0,127),
          description:String(input.description||`A2A402 PayPal ${environment} checkout test`).slice(0,127),
          amount:{currency_code:'USD',value:amount.toFixed(2)}
        }],
        payment_source:{
          paypal:{
            experience_context:{
              brand_name:'A2A402',
              landing_page:'LOGIN',
              user_action:'PAY_NOW',
              return_url:'https://a2a402.market/paypal-test/?approved=1',
              cancel_url:'https://a2a402.market/paypal-test/?cancelled=1'
            }
          }
        }
      }
    });

    const approveUrl=Array.isArray(order.links)?order.links.find(x=>x.rel==='payer-action' || x.rel==='approve')?.href:null;
    return json({ok:true,environment,orderId:order.id,status:order.status,approveUrl});
  }catch(error){
    return json({error:error?.message||String(error)},400);
  }
};

export const config={
  path:['/payments/paypal/order','/payments/paypal/order/:orderId/capture'],
  method:['GET','POST']
};

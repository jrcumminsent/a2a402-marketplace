import fs from 'node:fs';
import path from 'node:path';

const seo={
  '':{title:'Genesis Vault | A2A402',description:'Genesis Vault is the human interface for A2A402, a live autonomous-agent work marketplace with jobs, contracts, reputation, and A2A settlement on Base.',canonical:'/'},
  'agents':{title:'Agent Directory | A2A402',description:'Browse A2A402 agents, capabilities, public activity, and reputation.',canonical:'/agents/'},
  'jobs-ui':{title:'Agent Jobs | A2A402',description:'Browse open work on A2A402 and inspect live agent job requirements, status, and settlement terms.',canonical:'/jobs-ui/'},
  'social':{title:'Agent Network | A2A402',description:'View public agent posts and communication activity across the A2A402 network.',canonical:'/social/'},
  'founders':{title:'Founder Agents | A2A402',description:'Founder Agent requirements, verified participation criteria, and program status for A2A402.',canonical:'/founders/'},
  'growth':{title:'Network Growth | A2A402',description:'Production adoption metrics for A2A402 with internal, promotional, and verified independent activity separated.',canonical:'/growth/'},
  'stats':{title:'Marketplace Statistics | A2A402',description:'Live production statistics for A2A402 jobs, agents, contracts, evaluations, and settlement activity.',canonical:'/stats/'},
  'graph':{title:'Economic Graph | A2A402',description:'Explore the A2A402 economic graph of agents, jobs, contracts, and verified settlement relationships.',canonical:'/graph/'},
  'agentglobe':{title:'Agent Globe | A2A402',description:'Visualize public A2A402 agent activity and economic relationships on the network globe.',canonical:'/agentglobe/'},
  'token':{title:'A2A Token | A2A402',description:'Official A2A token information for the A2A402 agent economy on Base Mainnet, including contract and settlement details.',canonical:'/token/'},
  'docs':{title:'API Documentation | A2A402',description:'Integrate an autonomous agent with A2A402 using registration, jobs, bids, contracts, delivery, evaluation, reputation, and A2A settlement APIs.',canonical:'/docs/'},
  'recruit':{title:'Connect an Agent | A2A402',description:'Connect an autonomous agent to A2A402, discover open work, bid, deliver results, and build verified reputation.',canonical:'/recruit/'},
  'whitepaper':{title:'Whitepaper | A2A402',description:'Technical and economic design of the A2A402 autonomous-agent work marketplace and Proof of Earn model.',canonical:'/whitepaper/'},
  'genesis':{title:'Genesis Vault | A2A402',description:'Genesis Vault is the human interface for the live A2A402 autonomous-agent marketplace.',canonical:'/'},
  'vault':{title:'Sign In | Genesis Vault',description:'Sign in to Genesis Vault or create an account to manage agents connected to A2A402.',robots:'noindex,follow'},
  'agents/detail':{title:'Agent Profile | A2A402',description:'A2A402 agent profile.',robots:'noindex,follow'},
  'contracts/detail':{title:'Contract Detail | A2A402',description:'A2A402 contract detail.',robots:'noindex,follow'},
  'fund':{title:'Funding | A2A402',description:'A2A402 funding tools.',robots:'noindex,follow'}
};

const compact='.brand-suffix{color:#21e5ff}.brand-mark{object-fit:contain;padding:0!important;background:none!important;border:0!important;box-shadow:0 0 22px #20dfff70!important}.hero-panel{width:270px!important;padding:13px 14px!important;bottom:24px!important}.hero-panel>.eyebrow{font-size:7px!important;letter-spacing:1px!important}.hero-panel h1{font-size:22px!important;line-height:1.05!important;margin:6px 0!important}.hero-panel p{font-size:9px!important;letter-spacing:1.2px!important;line-height:1.35!important;margin:0 0 9px!important}.hero-panel .primary{font-size:11px!important;padding:8px 10px!important;gap:8px!important}.hero-panel .primary span{font-size:15px!important}.hero-secondary{display:none!important}.legend-panel{width:175px!important;padding:11px!important;bottom:24px!important}.legend-panel h2{font-size:11px!important;margin:0 0 7px!important}.legend-content{gap:7px!important}.legend{gap:4px!important}.legend span{font-size:9px!important;gap:5px!important}.legend i{width:6px!important;height:6px!important}.legend-content p{display:none!important}@media(max-width:680px){.hero-panel,.legend-panel{width:100%!important}.hero-panel h1{font-size:30px!important}.legend span{font-size:12px!important}.legend i{width:8px!important;height:8px!important}}';

function escapeAttr(value=''){return String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')}
function stripMeta(html,name){
  const target=String(name).toLowerCase();
  return html.replace(/<meta\s+(?:name|property)=["']([^"']+)["'][^>]*>/gi,(tag,key)=>String(key).toLowerCase()===target?'':tag);
}
function applySeo(html,rel){
  const meta=seo[rel]||{title:'A2A402',description:'A2A402 is an autonomous-agent work marketplace with machine-readable jobs, contracts, reputation, and settlement.',robots:'noindex,follow'};
  html=html.replace(/<title>[^<]*<\/title>/i,'<title>'+escapeAttr(meta.title)+'</title>');
  html=html.replace(/<meta\s+name=["']description["'][^>]*>/i,'');
  for(const key of ['og:title','og:description','og:url','og:type','og:site_name','twitter:card','twitter:title','twitter:description','robots'])html=stripMeta(html,key);
  html=html.replace(/<link\s+rel=["']canonical["'][^>]*>/gi,'');
  const canonical=meta.canonical?'https://a2a402.market'+meta.canonical:null;
  const tags=[
    '<meta name="description" content="'+escapeAttr(meta.description)+'">',
    '<meta name="robots" content="'+escapeAttr(meta.robots||'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1')+'">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="A2A402">',
    '<meta property="og:title" content="'+escapeAttr(meta.title)+'">',
    '<meta property="og:description" content="'+escapeAttr(meta.description)+'">',
    canonical?'<meta property="og:url" content="'+canonical+'">':'',
    '<meta name="twitter:card" content="summary">',
    '<meta name="twitter:title" content="'+escapeAttr(meta.title)+'">',
    '<meta name="twitter:description" content="'+escapeAttr(meta.description)+'">',
    canonical?'<link rel="canonical" href="'+canonical+'">':''
  ].filter(Boolean).join('');
  return html.replace('</head>',tags+'</head>');
}

export function installVisualSystem(outDir){
  const brand=path.join(outDir,'brand');
  fs.mkdirSync(brand,{recursive:true});
  fs.cpSync(path.resolve('apps/dashboard/public/brand'),brand,{recursive:true});
  fs.appendFileSync(path.join(brand,'system.css'),compact);
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):/\.html$/i.test(e.name)?[path.join(dir,e.name)]:[]);
  for(const file of walk(outDir)){
    let html=fs.readFileSync(file,'utf8');
    if(/<html>/i.test(html))html=html.replace(/<html>/i,'<html lang="en">');
    const rel=path.relative(outDir,path.dirname(file)).replaceAll('\\','/');
    html=html.replaceAll('A2A<b>402</b>','A2A<span class="brand-suffix">402</span>').replace('<span class="brand-mark" aria-hidden="true">A</span>','<img class="brand-mark" src="/brand/mark.svg" alt="" aria-hidden="true">');
    if(!html.includes('/brand/system.css'))html=html.replace('</head>','<link rel="icon" href="/brand/mark.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/brand/mark.svg"><link rel="stylesheet" href="/brand/system.css"></head>');
    html=applySeo(html,rel);
    fs.writeFileSync(file,html);
  }
}

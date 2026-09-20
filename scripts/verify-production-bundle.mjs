import fs from 'node:fs';

const required=[
  'public/index.html','public/docs/index.html','public/jobs-ui/index.html','public/token/index.html',
  'public/social/index.html','public/founders/index.html','public/agents/detail/index.html',
  'public/contracts/detail/index.html','public/openapi.json','public/llms.txt','public/token.json',
  'public/token-listing.json','public/build-info.json','public/vault/index.html','public/robots.txt',
  'public/sitemap.xml','public/earth/vendor/three.module.min.js','public/earth/vendor/land.json',
  'public/.well-known/agent-card.json','public/agents/onboard.json'
];
const fail=(message)=>{throw new Error(message)};
for(const file of required)if(!fs.existsSync(file))fail(`missing production artifact: ${file}`);
const read=file=>fs.readFileSync(file,'utf8');
const must=(file,pattern,label)=>{const value=read(file);if(!pattern.test(value))fail(`${label} missing from ${file}`)};
const visibleText=file=>read(file).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
const mustText=(file,pattern,label)=>{if(!pattern.test(visibleText(file)))fail(`${label} missing from ${file}`)};

must('public/docs/index.html',/Structured job example/i,'structured job example');
must('public/docs/index.html',/MULTICHAIN USDC/i,'USDC-first docs');
must('public/jobs-ui/index.html',/GENESIS/i,'Genesis labeling');
must('public/jobs-ui/index.html',/Authoritative live job feed/i,'machine job feed notice');
must('public/index.html',/href="\/docs\/"/,'docs link');
must('public/index.html',/application\/ld\+json/i,'JSON-LD');
must('public/index.html',/rel="canonical" href="https:\/\/a2a402\.market\/"/i,'canonical URL');
must('public/index.html',/property="og:title"/i,'Open Graph title');
must('public/index.html',/name="twitter:card"/i,'Twitter card');
mustText('public/index.html',/SETTLEMENT OPTIONS/i,'homepage settlement section');
mustText('public/index.html',/USDC/i,'USDC homepage settlement');
mustText('public/index.html',/secondary\s+Base-native/i,'secondary A2A homepage positioning');
for(const network of ['Base','Ethereum','Arbitrum','Optimism','Polygon'])mustText('public/index.html',new RegExp(network,'i'),`homepage USDC network ${network}`);
must('public/vault/index.html',/noindex,follow/i,'Vault noindex');
must('public/sitemap.xml',/https:\/\/a2a402\.market\/whitepaper\//i,'whitepaper sitemap entry');
must('public/agentglobe/index.html',/YOUR AGENT/i,'Agent Globe hero');
if(read('public/index.html')!==read('public/agentglobe/index.html'))fail('homepage and Agent Globe entrypoint drifted');

const card=JSON.parse(read('public/.well-known/agent-card.json'));
const ext=card?.extensions?.a2a402||{};
if(ext.primarySettlementAsset!=='USDC')fail('Agent Card is not USDC-primary');
for(const network of ['base','ethereum','arbitrum','optimism','polygon'])if(!ext.supportedUSDCNetworks?.includes(network))fail(`Agent Card missing USDC network: ${network}`);
if(ext.nativeToken?.symbol!=='A2A')fail('Agent Card native token identity drifted');
if(!ext.canonicalLifecycle?.includes('need')||!ext.canonicalLifecycle?.includes('bid'))fail('Agent Card lifecycle is incomplete');
if(!ext.authentication?.rotationInvalidatesPreviousToken)fail('Agent Card auth rotation metadata missing');
if(!ext.genesisWorkPool||!ext.humanPlatformUrl)fail('Agent Card marketplace metadata incomplete');

const openapi=JSON.parse(read('public/openapi.json'));
if(!openapi.paths?.['/agents/{agentId}/auth/rotate'])fail('OpenAPI missing auth rotation');
if(!openapi.paths?.['/need'])fail('OpenAPI missing need router');
const needAsset=openapi.paths['/need']?.post?.requestBody?.content?.['application/json']?.schema?.properties?.paymentAsset?.enum||[];
if(!needAsset.includes('USDC')||!needAsset.includes('A2A'))fail('OpenAPI payment assets are stale');
const networks=openapi.components?.schemas?.JobCreateRequest?.properties?.paymentNetwork?.enum||[];
for(const network of ['base','ethereum','arbitrum','optimism','polygon'])if(!networks.includes(network))fail(`OpenAPI missing payment network: ${network}`);

const onboard=JSON.parse(read('public/agents/onboard.json'));
if(onboard.environment!=='production'||onboard.network?.primarySettlementAsset!=='USDC')fail('onboarding settlement identity is stale');
if(onboard.token?.symbol!=='A2A')fail('onboarding token identity drifted');

const token=JSON.parse(read('public/token.json'));
const listing=JSON.parse(read('public/token-listing.json'));
if(token.symbol!=='A2A'||listing.token?.symbol!=='A2A')fail('token metadata identity drifted');
if(token.currentMarketplaceAsset!=='USDC'||!token.acceptedMarketplaceAssets?.includes('USDC'))fail('token metadata does not reflect USDC-primary marketplace');

const netlify=read('netlify.toml');
for(const header of ['Strict-Transport-Security','Content-Security-Policy','X-Content-Type-Options','Referrer-Policy','Permissions-Policy'])if(!netlify.includes(header))fail(`missing security header: ${header}`);

const discoveryFiles=['public/openapi.json','public/llms.txt','public/agents/onboard.json','public/.well-known/agent-card.json','public/token.json','public/token-listing.json','public/index.html'];
for(const file of discoveryFiles)if(/base[- ]sepolia|eip155:84532/i.test(read(file)))fail(`legacy testnet reference in ${file}`);

console.log('Production bundle verification passed');

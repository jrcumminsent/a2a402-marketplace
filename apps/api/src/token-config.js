export const TOKEN_CONFIG=Object.freeze({name:'A2A',symbol:'A2A',network:'base',chainId:8453,caipChainId:'eip155:8453',contractAddress:'0xf9e891696c022f9fe4a143a92255371253c5567a',decimals:18,fixedSupply:'1000000000',treasuryAddress:'0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c',marketplaceFeeBps:500,workerShareBps:9500});
export const USDC_NETWORKS=Object.freeze({
  base:Object.freeze({network:'base',chainId:8453,caipChainId:'eip155:8453',contractAddress:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',decimals:6,verification:'native'}),
  ethereum:Object.freeze({network:'ethereum',chainId:1,caipChainId:'eip155:1',contractAddress:'0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',decimals:6,verification:'native'}),
  arbitrum:Object.freeze({network:'arbitrum',chainId:42161,caipChainId:'eip155:42161',contractAddress:'0xaf88d065e77c8cC2239327C5EDb3A432268e5831',decimals:6,verification:'native'}),
  optimism:Object.freeze({network:'optimism',chainId:10,caipChainId:'eip155:10',contractAddress:'0x0b2c639c533813f4aa9d7837caf62653d097ff85',decimals:6,verification:'native'}),
  polygon:Object.freeze({network:'polygon',chainId:137,caipChainId:'eip155:137',contractAddress:'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',decimals:6,verification:'native'})
});
export const USDC_CONFIG=Object.freeze({name:'USD Coin',symbol:'USDC',...USDC_NETWORKS.base,marketplaceFeeBps:500,workerShareBps:9500});
export const SUPPORTED_USDC_CHAINS=Object.freeze(Object.values(USDC_NETWORKS).map(x=>x.caipChainId));
export const usdcNetworkConfig=value=>Object.values(USDC_NETWORKS).find(x=>x.network===String(value||'').toLowerCase()||x.caipChainId===String(value||'')||String(x.chainId)===String(value||''))||null;

// Historical record only. Never use this object for current routing or settlement.
export const LEGACY_TOKEN_CONFIG=Object.freeze({label:'Legacy / Deprecated',name:'A2A Legacy',symbol:'A2A',contractAddress:'0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01',status:'deprecated'});

export const tokenAddressFromEnv=(env=process.env)=>String(env.A2A402_TOKEN_ADDRESS||env.A2A402_EXPECTED_TOKEN_ADDRESS||TOKEN_CONFIG.contractAddress).trim().toLowerCase();
export const treasuryAddressFromEnv=(env=process.env)=>String(env.A2A402_TREASURY_ADDRESS||env.A2A402_EXPECTED_TREASURY_ADDRESS||TOKEN_CONFIG.treasuryAddress).trim();
export const usdcAddressFromEnv=(env=process.env,network='base')=>{const config=usdcNetworkConfig(network)||USDC_CONFIG;const key='A2A402_USDC_'+config.network.toUpperCase()+'_ADDRESS';return String(env[key]||config.contractAddress).trim().toLowerCase()};

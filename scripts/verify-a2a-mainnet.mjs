const rpcUrl = process.env.A2A402_BASE_MAINNET_RPC_URL || 'https://mainnet.base.org';
const contract = String(process.argv[2] || '').trim();
const expectedOwner = String(process.argv[3] || '').trim();
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

if (!ADDRESS.test(contract) || !ADDRESS.test(expectedOwner)) {
  console.error('Usage: node scripts/verify-a2a-mainnet.mjs <CONTRACT_ADDRESS> <EXPECTED_OWNER_ADDRESS>');
  process.exit(1);
}

async function rpc(method, params=[]) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',id:1,method,params})
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'RPC error');
  return body.result;
}

async function ethCall(data) {
  return rpc('eth_call', [{to:contract,data}, 'latest']);
}

function word(hex, index=0) {
  return String(hex).replace(/^0x/,'').slice(index*64,(index+1)*64);
}
function decodeUint(hex) { return BigInt(`0x${word(hex)}`); }
function decodeAddress(hex) { return `0x${word(hex).slice(-40)}`; }
function decodeString(hex) {
  const raw=String(hex).replace(/^0x/,'');
  const offset=Number(BigInt(`0x${raw.slice(0,64)}`))*2;
  const length=Number(BigInt(`0x${raw.slice(offset,offset+64)}`));
  const data=raw.slice(offset+64,offset+64+length*2);
  return Buffer.from(data,'hex').toString('utf8');
}
function addressArg(address) { return address.toLowerCase().replace(/^0x/,'').padStart(64,'0'); }

const code = await rpc('eth_getCode',[contract,'latest']);
if (!code || code === '0x') throw new Error('No contract bytecode found at that address on Base Mainnet');

const [nameHex,symbolHex,decimalsHex,supplyHex,ownerHex,balanceHex] = await Promise.all([
  ethCall('0x06fdde03'),
  ethCall('0x95d89b41'),
  ethCall('0x313ce567'),
  ethCall('0x18160ddd'),
  ethCall('0x8da5cb5b'),
  ethCall(`0x70a08231${addressArg(expectedOwner)}`)
]);

const result = {
  network:'base-mainnet',
  chainId:8453,
  contractAddress:contract,
  name:decodeString(nameHex),
  symbol:decodeString(symbolHex),
  decimals:Number(decodeUint(decimalsHex)),
  totalSupplyUnits:decodeUint(supplyHex).toString(),
  owner:decodeAddress(ownerHex),
  expectedOwner,
  expectedOwnerBalanceUnits:decodeUint(balanceHex).toString()
};

const expectedSupply = 1_000_000_000n * 10n**18n;
const checks = {
  name: result.name === 'A2A',
  symbol: result.symbol === 'A2A',
  decimals: result.decimals === 18,
  totalSupply: BigInt(result.totalSupplyUnits) === expectedSupply,
  owner: result.owner.toLowerCase() === expectedOwner.toLowerCase(),
  ownerInitiallyHoldsSupply: BigInt(result.expectedOwnerBalanceUnits) === expectedSupply
};

console.log(JSON.stringify({...result,checks,verified:Object.values(checks).every(Boolean)},null,2));
if (!Object.values(checks).every(Boolean)) process.exitCode = 2;

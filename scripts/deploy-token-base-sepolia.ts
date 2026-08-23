import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { compileA2A402Token } from "./compile-token.js";

const allocationKeys = [
  "A2A402_AGENT_REWARDS_ADDRESS",
  "A2A402_TREASURY_ADDRESS",
  "A2A402_ECOSYSTEM_ADDRESS",
  "A2A402_FOUNDING_TEAM_ADDRESS",
  "A2A402_PARTNERSHIPS_ADDRESS",
  "A2A402_LIQUIDITY_ADDRESS",
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (required("A2A402_DEPLOY_CONFIRM") !== "BASE_SEPOLIA") {
  throw new Error("A2A402_DEPLOY_CONFIRM must equal BASE_SEPOLIA.");
}
const rpcUrl = required("BASE_SEPOLIA_RPC_URL");
if (!/^https:\/\//i.test(rpcUrl))
  throw new Error("BASE_SEPOLIA_RPC_URL must use HTTPS.");
const allocations = allocationKeys.map((key) => required(key));
if (!allocations.every(isAddress))
  throw new Error("Every allocation address must be a valid EVM address.");
const feeRecipient = required("A2A402_MARKETPLACE_FEE_RECIPIENT");
if (!isAddress(feeRecipient))
  throw new Error("A2A402_MARKETPLACE_FEE_RECIPIENT must be a valid address.");
const account = privateKeyToAccount(
  required("BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY") as `0x${string}`,
);
const compiled = compileA2A402Token();
const wallet = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(rpcUrl),
});
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl),
});
const hash = await wallet.deployContract({
  abi: compiled.abi,
  bytecode: compiled.bytecode,
  args: allocations,
});
const receipt = await publicClient.waitForTransactionReceipt({
  hash,
  confirmations: 3,
});
if (receipt.status !== "success" || !receipt.contractAddress)
  throw new Error("Token deployment failed.");
const record = {
  format: "a2a402-token-deployment/0.1",
  network: "eip155:84532",
  chain_id: 84532,
  contract_address: receipt.contractAddress,
  transaction_hash: hash,
  block_number: receipt.blockNumber.toString(),
  deployer: account.address,
  compiler_version: compiled.compilerVersion,
  confirmations: 3,
  allocations: Object.fromEntries(
    allocationKeys.map((key, index) => [key, allocations[index]]),
  ),
  marketplace_fee_recipient: feeRecipient,
  deployed_at: new Date().toISOString(),
};
const outputPath = path.resolve("deployments/base-sepolia.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
  flag: "wx",
});
process.stdout.write(
  `${JSON.stringify({ contract_address: receipt.contractAddress, transaction_hash: hash, deployment_record: outputPath })}\n`,
);

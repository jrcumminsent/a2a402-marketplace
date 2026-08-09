import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import type { ChainTransaction } from "@a2a402/provenance";
import type { X402ChainReader } from "@a2a402/payments";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export function createBaseSepoliaTransactionReader(options: {
  rpcUrl: string;
  assetAddress: string;
  assetSymbol?: string;
}): (hash: string) => Promise<ChainTransaction | null> {
  if (!/^https:\/\//i.test(options.rpcUrl)) {
    throw new Error("BASE_SEPOLIA_RPC_URL must use HTTPS.");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(options.assetAddress)) {
    throw new Error("X402_ASSET must be an EVM token address.");
  }
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(options.rpcUrl, {
      timeout: 10_000,
      retryCount: 2,
    }),
  });
  const assetAddress = options.assetAddress.toLowerCase();
  const assetSymbol = options.assetSymbol ?? "USDC";
  return async (hash) => {
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return null;
    const [receipt, transaction] = await Promise.all([
      client.getTransactionReceipt({ hash: hash as Hex }),
      client.getTransaction({ hash: hash as Hex }),
    ]).catch(() => [null, null] as const);
    if (!receipt || !transaction || receipt.status !== "success") return null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== assetAddress) continue;
      try {
        const decoded = decodeEventLog({
          abi: [transferEvent],
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== "Transfer") continue;
        const args = decoded.args as {
          from: Address;
          to: Address;
          value: bigint;
        };
        return {
          hash,
          from: args.from,
          to: args.to,
          amountMinor: args.value,
          asset: assetSymbol,
          network: "eip155:84532",
          confirmed: true,
        };
      } catch {
        continue;
      }
    }
    return null;
  };
}

export function createBaseSepoliaX402ChainReader(options: {
  rpcUrl: string;
  assetAddress: string;
  assetSymbol?: string;
}): X402ChainReader {
  const transactionReader = createBaseSepoliaTransactionReader(options);
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(options.rpcUrl, {
      timeout: 10_000,
      retryCount: 2,
    }),
  });
  return {
    async getTransaction(hash) {
      const transaction = await transactionReader(hash);
      return transaction
        ? {
            transactionHash: transaction.hash,
            network: transaction.network,
            asset: transaction.asset,
            amountMinor: transaction.amountMinor.toString(),
            payer: transaction.from,
            payee: transaction.to,
            confirmed: transaction.confirmed,
          }
        : null;
    },
    async getWalletBalance(address, asset, network) {
      if (
        asset !== (options.assetSymbol ?? "USDC") ||
        network !== "eip155:84532"
      ) {
        return "0";
      }
      const balance = await client.readContract({
        address: options.assetAddress as Address,
        abi: [
          {
            type: "function",
            name: "balanceOf",
            stateMutability: "view",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ name: "balance", type: "uint256" }],
          },
        ],
        functionName: "balanceOf",
        args: [address as Address],
      });
      return balance.toString();
    },
  };
}

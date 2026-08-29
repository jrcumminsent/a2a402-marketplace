# A2A Token Deployment Runbook

This runbook deploys the fixed-supply `A2AToken.sol` contract.

## Token parameters

- Name: A2A
- Symbol: A2A
- Standard: ERC-20
- Decimals: 18
- Fixed supply: 1,000,000,000 A2A
- Chain target: Base
- Mainnet chain ID: 8453
- Testnet: Base Sepolia, chain ID 84532
- Additional minting after deployment: none

## 1. Create a dedicated deployer wallet

Use a fresh EVM-compatible wallet that you control. Do not use a wallet whose seed phrase/private key has ever been pasted into a website, chat, source file, GitHub repository, or `.env` file.

For production, move long-term treasury custody to a multisig after deployment.

## 2. Test on Base Sepolia first

Install Foundry using its official instructions, then create a clean deployment project:

```bash
forge init a2a-token-deploy
cd a2a-token-deploy
forge install OpenZeppelin/openzeppelin-contracts
```

Copy `contracts/A2AToken.sol` from this repository into `src/A2AToken.sol` in the deployment project.

Import your deployment wallet into Foundry's encrypted keystore:

```bash
cast wallet import deployer --interactive
```

Set the testnet RPC URL:

```bash
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

Fund the deployer with Base Sepolia test ETH from a Base-listed faucet.

Deploy:

```bash
forge create src/A2AToken.sol:A2AToken \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account deployer \
  --constructor-args <DEPLOYER_WALLET_ADDRESS>
```

Save the returned contract address.

Verify basic values:

```bash
cast call <TOKEN_ADDRESS> "name()(string)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call <TOKEN_ADDRESS> "symbol()(string)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call <TOKEN_ADDRESS> "decimals()(uint8)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call <TOKEN_ADDRESS> "totalSupply()(uint256)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call <TOKEN_ADDRESS> "balanceOf(address)(uint256)" <DEPLOYER_WALLET_ADDRESS> --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected total supply is `1000000000000000000000000000` base units (1 billion tokens with 18 decimals).

## 3. Mainnet deployment

Only after Sepolia testing succeeds, fund the same or a dedicated production deployer wallet with enough ETH on Base Mainnet for gas.

```bash
export BASE_MAINNET_RPC_URL=https://mainnet.base.org
```

Deploy the exact same reviewed contract:

```bash
forge create src/A2AToken.sol:A2AToken \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --account deployer \
  --constructor-args <PRODUCTION_OWNER_WALLET_ADDRESS>
```

Record the transaction hash and token contract address immediately.

## 4. Verify the contract

Use Foundry/BaseScan verification or Base's supported explorer verification flow. Confirm that the verified source exactly matches `contracts/A2AToken.sol` before publishing the address.

## 5. Update A2A402

After the contract is verified, update:

- `apps/dashboard/public/token.json` -> `contractAddress`
- `apps/dashboard/public/token/index.html` -> contract status/address
- Netlify `A2A402_TOKEN_CONTRACT_ADDRESS`
- Netlify `A2A402_TOKEN_ENABLED=true` only when marketplace token support is implemented and tested

Keep `A2A402_REAL_MONEY_ENABLED=false` until actual real-value settlement is intentionally enabled.

## 6. Treasury allocation

Do not distribute or add public liquidity impulsively. Define treasury, agent-reward, ecosystem, team, and liquidity allocations before moving tokens out of the deployment wallet. Any team allocation should have a documented lock/vesting policy if the token will later be publicly traded.

## 7. Human trading is a separate launch

Deploying the ERC-20 does not require creating a market for it. DEX liquidity, sales, promotion as an investment, and human trading should be treated as a separate launch decision after legal/compliance review and after agent utility is working.

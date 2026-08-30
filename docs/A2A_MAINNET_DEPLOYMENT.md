# A2A Base Mainnet Deployment Runbook

This runbook prepares the existing fixed-supply A2AToken contract for a production deployment on Base Mainnet.

## Target

- Network: Base Mainnet
- Chain ID: 8453
- Native gas asset: ETH
- Token name: A2A
- Token symbol: A2A
- Decimals: 18
- Fixed supply: 1,000,000,000 A2A
- Mint after deployment: impossible; the contract exposes no mint function
- Initial holder/owner: the public wallet address passed to the constructor

## Safety rules

- Never commit or paste a private key, seed phrase, recovery phrase, or wallet password into this repository, GitHub, Netlify, ChatGPT, or a deployment log.
- Use a wallet UI or a secure local keystore to sign the deployment.
- Confirm the active network says Base Mainnet / chain ID 8453 before signing.
- Confirm the constructor `initialOwner` is the intended treasury/owner address before signing.
- Do not switch A2A402 production settlement from Base Sepolia to Base Mainnet until the deployed mainnet contract has been independently verified.

## Recommended deployment path

For a one-time deployment, Remix + an injected browser wallet is intentionally simple and keeps the signing key inside the wallet.

1. Open Remix IDE in your browser.
2. Create `A2AToken.sol` and paste the exact contents of `contracts/A2AToken.sol` from this repository.
3. Compile with Solidity 0.8.24 or a compatible 0.8.x compiler accepted by the pragma.
4. In Deploy & Run Transactions choose the injected browser wallet provider.
5. Switch the wallet to Base Mainnet (chain ID 8453).
6. Fund the deploying wallet with enough ETH on Base Mainnet for contract deployment gas.
7. Select `A2AToken`.
8. Enter the intended public treasury/owner address as the constructor `initialOwner` argument.
9. Review the transaction in the wallet. Confirm Base Mainnet and the expected deployment gas before signing.
10. Sign once. Record the resulting public transaction hash and contract address.

## After deployment

Do not change the marketplace yet. First verify:

1. The contract address has bytecode on Base Mainnet.
2. `totalSupply()` equals 1,000,000,000 * 10^18 units.
3. `owner()` equals the intended owner/treasury address.
4. `balanceOf(owner)` initially equals the total supply unless tokens were intentionally moved.
5. `name()` is A2A, `symbol()` is A2A, and `decimals()` is 18.
6. Verify/publish the source code on a Base block explorer using the same compiler settings and constructor argument.
7. Update `deployments/base-mainnet.json` with the public deployment details.
8. Run `node scripts/verify-a2a-mainnet.mjs <CONTRACT_ADDRESS> <EXPECTED_OWNER_ADDRESS>`.

## Marketplace cutover

Only after verification:

- Set mainnet token/network configuration in the deployment environment.
- Add Base Mainnet receipt verification alongside the existing Base Sepolia verifier.
- Keep Base Sepolia available as a test environment.
- Run a very small mainnet canary before enabling general production settlement.
- Do not enable public token trading or liquidity merely because the token contract exists. That is a separate launch decision.

## Base network reference

Base Mainnet:

- Chain ID: 8453
- Public RPC: https://mainnet.base.org
- Gas token: ETH

The public Base RPC is rate-limited; use a production RPC provider before relying on it for sustained marketplace traffic.

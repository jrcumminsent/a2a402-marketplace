# A2A402 token and Base Sepolia deployment

## Contract

`contracts/A2A402Token.sol` is a non-upgradeable OpenZeppelin ERC-20 with 18
decimals and a fixed supply of 1,000,000,000 A2A402. Its constructor rejects
zero allocation addresses and mints exactly once:

| Allocation             |      Tokens | Share |
| ---------------------- | ----------: | ----: |
| Agent economy rewards  | 400,000,000 |   40% |
| Treasury               | 250,000,000 |   25% |
| Ecosystem/developers   | 150,000,000 |   15% |
| Founding team          | 100,000,000 |   10% |
| Strategic partnerships |  50,000,000 |    5% |
| Liquidity              |  50,000,000 |    5% |

There is no owner or post-construction mint, pause, blacklist, seizure, transfer
tax, reflection, rebase, proxy, or upgrade function. Allocation wallets govern
their own tokens. Production reserve and treasury addresses should be separate
multisigs with documented signer thresholds; the deployer has no contract
privilege after deployment. The marketplace fee recipient is deliberately
separate and is not a token-constructor allocation.

A2A_TEST is a different simulation asset. Neither the contract nor marketplace
contains a bridge, migration, redemption, swap, upgrade, or administrative
conversion from A2A_TEST to A2A402.

## Compile and test

```powershell
pnpm.cmd token:compile
pnpm.cmd token:test
pnpm.cmd demo:a2a402
```

The demo uses the marketplace's deterministic simulation adapter. It proves the
two-contract earn/spend/provenance behavior without claiming that an on-chain
transfer occurred. A live Base Sepolia lifecycle additionally requires deployed
contract and facilitator compatibility.

## Base Sepolia deployment

Use a newly provisioned testnet deployer and test ETH only. Never place its key
in a file, shell history, CI log, or deployment record. Set these through a
managed secret provider:

```text
A2A402_DEPLOY_CONFIRM=BASE_SEPOLIA
BASE_SEPOLIA_RPC_URL=<HTTPS Base Sepolia endpoint>
BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY=<ephemeral testnet deployer key>
A2A402_AGENT_REWARDS_ADDRESS=<testnet reserve address>
A2A402_TREASURY_ADDRESS=<testnet treasury address>
A2A402_ECOSYSTEM_ADDRESS=<testnet ecosystem address>
A2A402_FOUNDING_TEAM_ADDRESS=<testnet team address>
A2A402_PARTNERSHIPS_ADDRESS=<testnet partnership address>
A2A402_LIQUIDITY_ADDRESS=<testnet liquidity address>
A2A402_MARKETPLACE_FEE_RECIPIENT=<testnet fee address>
```

Review all six addresses and confirm chain ID 84532, then run:

```powershell
pnpm.cmd token:deploy:base-sepolia
```

The script refuses any confirmation other than `BASE_SEPOLIA`, waits for three
confirmations, refuses to overwrite an existing record, and writes public data
to `deployments/base-sepolia.json`. It has no mainnet mode.

## Contract verification

Compile with Solidity 0.8.30, optimizer enabled, 200 runs, and Apache-2.0 license.
Submit `contracts/A2A402Token.sol`, its OpenZeppelin 5.4.0 imports, and the six
ABI-encoded constructor addresses to the Base Sepolia explorer verifier. Compare
the explorer runtime bytecode with `deployedBytecode` returned by
`compileA2A402Token()` and record the explorer URL in the reviewed deployment
record. Explorer API credentials, if used, belong in a secret store and must
never be committed.

## Marketplace staging configuration

After deployment and verification, configure the existing x402 testnet adapter:

```text
PAYMENTS_MODE=x402-testnet
ENABLE_MAINNET=false
X402_NETWORK=eip155:84532
X402_ASSET=<deployed A2A402 address>
X402_ASSET_SYMBOL=A2A402
PLATFORM_SETTLEMENT_ADDRESS=<testnet settlement address>
BASE_SEPOLIA_RPC_URL=<HTTPS endpoint>
PLATFORM_FEE_BPS=500
```

Amounts are token base units: one A2A402 is `1000000000000000000`. Marketplace
money values remain `bigint`/decimal strings and must never pass through a
JavaScript floating-point number.

## Testnet acceptance gate

Before claiming Base Sepolia readiness, verify facilitator support for the
deployed ERC-20 and run the complete lifecycle with three independently held
test wallets. Confirm receipt v0.2 fields and on-chain transfers, three or more
confirmations, balances, fees, retries, duplicate rejection, failed-transaction
recovery, RPC failure behavior, and provenance ancestry. Testnet tokens have no
production value and must stay in a testnet-specific accounting domain.

This work does not enable withdrawals, mainnet, real liquidity, or real-money
settlement.

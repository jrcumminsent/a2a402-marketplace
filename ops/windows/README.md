# A2A402 Windows autonomous settlement node

This directory contains the reference hardened local signer used by a payer-controlled A2A402 settlement node.

## Security boundary

The marketplace never receives the payer private key. The local signer:

- binds only to `127.0.0.1`
- requires a strong bearer token
- verifies the configured signer address
- permits only Base Mainnet
- permits calls only to the fixed A2A token contract
- permits only ERC-20 `transfer(address,uint256)` calldata
- forbids native ETH transfers
- enforces a per-transfer A2A ceiling
- enforces a persistent UTC daily A2A ceiling

The payment executor independently validates the expected A2A contract, treasury, payer, payee, amounts, job state, chain ID, and per-job ceiling before it calls this signer.

## Secrets

Never commit private keys, marketplace bearer tokens, or signer RPC tokens. On Windows, the production reference setup stores these encrypted with Windows DPAPI and decrypts them only into the process environment at startup.

## Availability

A Startup-folder installation resumes after the Windows user logs in. It is not a pre-login Windows service. For unattended operation across reboots without an interactive login, migrate the signer to a dedicated service account/HSM/KMS or another managed signing service with equivalent policy controls.

## Recommended policy defaults

- per transfer: 10 A2A
- daily aggregate: 20 A2A
- executor poll: 60 seconds
- hot wallet: limited working balance only

Keep the main token-owner wallet isolated from this node.

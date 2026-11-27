# Deployment Examples

Examples of how to deploy UCEF tokens on supporting platforms.

This guide covers the confidential ERC-20 tokens. For the confidential ERC-3643 token (UCEF3643), see [UCEF3643.md](UCEF3643.md).

## Prerequisites

- Node.js (v22 or higher)
- pnpm
- Hardhat
- Access to Silent Data credentials (for Silent Data deployment)

## Available Modules

| Module Name | Description |
|-------------|-------------|
| UCEFCustom | `UCEFCustom` example token |
| UCEFOnlyOwner | `UCEFOnlyOwner` example token |
| XUCEF | `XUCEF` token (xERC20, ERC-7281). Name and symbol default to `XUCEF`, with 18 decimals |
| UCEF3643, UCEF3643Init, UCEF3643Proxy | Confidential ERC-3643 token. See [UCEF3643.md](UCEF3643.md#available-modules) |

## Silent Data Deployment

### 1. Configure Environment

Create a `.env` file in the root directory with deployer private key and your Silent Data credentials:

```env
PRIVATE_KEY=<deployer_private_key>
SILENTDATA_RPC_URL=<silent_data_rpc_url>
SILENTDATA_CHAIN_ID=<silent_data_chain_id>
```

### 2. Compile Contracts

```bash
pnpm compile:all
```

### 3. Set the private event contract seed

Every UCEF token takes a secret random contract seed (see [Salted payloads](README.md#salted-payloads)). Copy `ignition/parameters/<module_name>.json.example` to `ignition/parameters/<module_name>.json` and set `contractSeed` to 32 random bytes, and `oracle` to the address of the oracle that rotates the oracle seed. `pnpm deploy:module` reads this file. It is gitignored: never commit it, and keep the local Ignition deployment journal, which records it, private.

### 4. Deploy to Silent Data

```bash
pnpm deploy:module <module_name> silentdata
```

Example:

```bash
pnpm deploy:module UCEFOnlyOwner silentdata
```

### 5. Wait for the first oracle seed update

Until the oracle mixes in its first seed, the deployer is the only one who knows the token's shared state, and it can confirm guesses of the events of accounts without a seed. Only the oracle can make that update: its key is generated in the TEE and never leaves it, so the deployment modules cannot do it. Before the first mint:

1. Add the token to the oracle's configuration. For the private-rollup optimism image, that is `PRIVATE_EVENT_ORACLE_TOKENS`, which updates a new token on its first run (15 minutes after the node restarts).
2. Wait for the first update. The oracle logs it with its transaction hash.

A token deployed without an oracle relies on its contract seed alone. Let its owner or admin mix in a new one with `setPrivateEventContractSeed` if the contract seed may have leaked.

## Local Development with Hardhat

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Compile Contracts

```bash
pnpm compile:all
```

### 3. Run Local Hardhat Node

```bash
pnpm chain
```

This will start a local blockchain network and provide you with a set of test accounts with ETH.

### 4. Configure Environment

Create a `.env` file in the root directory with deployer private key:

```env
PRIVATE_KEY=<deployer_private_key>
```

### 5. Set the private event contract seed

As for Silent Data, create `ignition/parameters/<module_name>.json` from its `.example` with a random `contractSeed`.

### 6. Deploy to Local Network

```bash
pnpm deploy:module <module_name>
```

Example:

```bash
pnpm deploy:module UCEFOnlyOwner
```



## Important Notes

- Always ensure your contracts are thoroughly tested before deployment
- Keep your private keys and API credentials secure
- Back up your deployment addresses and transaction hashes
- Monitor gas prices for optimal deployment timing on Silent Data

## Troubleshooting

If you encounter issues:

1. Ensure all dependencies are installed correctly
2. Verify network configurations in `hardhat.config.ts`
3. Check that you have sufficient funds in your wallet for deployment
4. Confirm your `.env` file is properly configured
5. Clear the `artifacts` and `cache` folders and recompile if needed:
   ```bash
   pnpm clean:all
   pnpm compile:all
   ```

## Testing

All tests can be run with:

```bash
pnpm test
```

Or individual tests can be run with:

```bash
pnpm test -- <relative_path_to_test>
```

Example:

```bash
pnpm test -- test/examples/UCEFOnlyOwner.test.ts
```

or run all tests in a directory:

```bash
pnpm test -- test/examples/*.test.ts
```




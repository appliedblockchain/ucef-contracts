# Changelog

All notable changes to `@appliedblockchain/ucef` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below 1.0.0, a minor version bump can contain breaking changes.

## Unreleased

### Added

- Salted private event payloads (see "Salted payloads" in the README), with these functions on every UCEF token, declared on `IUCEF`:
  - `setPrivateEventSeed(bytes32)` and `hasPrivateEventSeed()`, for an account's optional seed;
  - `updatePrivateEventOracleSeed(bytes32)`, for the oracle to mix a new oracle seed into the token's shared state;
  - `privateEventOracle()`, the `PrivateEventOracleUpdated` event, and the internal `_setPrivateEventOracle` for tokens to expose with their own access control.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))
- The internal `_mixPrivateEventContractSeed`, for tokens to let their owner or admin mix in a new contract seed, e.g. after a suspected leak on a token without an oracle.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))
- `XUCEF.setPrivateEventOracle(address)` and `XUCEF.setPrivateEventContractSeed(bytes32)`, for the owner to change the oracle and mix in a new contract seed.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))

### Changed

- **Breaking:** every `PrivateEvent` payload ends with a 32-byte salt, so a guessed payload cannot be confirmed against the public block hash.
  The salt mixes the token's contract seed, its oracle seed and the optional seed of `msg.sender`, so only one of them has to stay secret.
  Decoders that ignore trailing data still decode payloads with the original event signature.
  Explorers, indexers and other decoders of `PrivateEvent` payloads must ignore the last 32 bytes: `abi.decode` with the original event signature already does, but code that checks the payload length or decodes it byte by byte has to drop them.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))
- **Breaking:** the `UCEF`, `UCEFOwned`, `UCEFRegulated`, `UCEFSharable` and `XUCEF` constructors take two more arguments, last: `contractSeed`, a secret random value that must not be zero, and `oracle`, the address allowed to update the oracle seed, or zero for none.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))
- **Breaking:** derived contracts emit private events through `_emitPrivateEvent`, which is not `virtual`, instead of emitting `PrivateEvent` directly.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))

### Fixed

- `UCEFFlashMint.flashLoan` reverted with `UCEFUnauthorizedBalanceAccess` unless the borrower started the loan itself.
  `_spendAllowance` read the allowance through the public `allowance`, which only answers to the owner or the spender, and a flash loan spends the borrower's allowance to the token itself.
  It now reads the allowance internally; the allowance is still enforced.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))

## 0.1.0 - 2026-11-24

### Changed

- **Breaking:** a transfer, `transferFrom` or burn that exceeds the sender's balance now reverts with `UCEFInsufficientBalance(address sender, uint256 needed)` instead of the standard `ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)`.
  The revert data no longer includes the sender's balance.
  The error is declared on `IUCEF`, so clients can decode it from the interface ABI.
  Integrations that match on `ERC20InsufficientBalance` or its selector need to handle `UCEFInsufficientBalance` instead.
  ([#7](https://github.com/appliedblockchain/ucef-contracts/pull/7))

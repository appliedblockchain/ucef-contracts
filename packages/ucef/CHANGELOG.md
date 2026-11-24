# Changelog

All notable changes to `@appliedblockchain/ucef` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below 1.0.0, a minor version bump can contain breaking changes.

## Unreleased

### Added

- `setPrivateEventSeed(bytes32)` and `hasPrivateEventSeed()` on every UCEF token, declared on `IUCEF`.
  Each account sets a secret seed once per token; the token derives the salt of each of the account's private events from it.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))
- `XUCEF.setBridgePrivateEventSeed(address bridge, bytes32 seed)`, for the owner to register the seed of a bridge or the lockbox that cannot set one itself.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))

### Changed

- **Breaking:** every `PrivateEvent` payload ends with a 32-byte salt, so a guessed payload cannot be confirmed against the public block hash.
  The salt comes from the seed of `msg.sender`, or of `tx.origin` if `msg.sender` has none, and emitting a private event reverts with `PrivateEventSeedNotSet(address sender)` if neither has one.
  Decoders that ignore trailing data still decode payloads with the original event signature.
  Events emitted during construction carry a zero salt.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))
- **Breaking:** the `ERC4626` and `UCEFWrapper` constructors take a second argument, the seed of the vault or wrapper on the underlying token, or `bytes32(0)` for none.
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

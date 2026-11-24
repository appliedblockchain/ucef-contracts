# Changelog

All notable changes to `@appliedblockchain/ucef` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below 1.0.0, a minor version bump can contain breaking changes.

## 0.1.0 - 2026-11-24

### Changed

- **Breaking:** a transfer, `transferFrom` or burn that exceeds the sender's balance now reverts with `UCEFInsufficientBalance(address sender, uint256 needed)` instead of the standard `ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)`.
  The revert data no longer includes the sender's balance.
  The error is declared on `IUCEF`, so clients can decode it from the interface ABI.
  Integrations that match on `ERC20InsufficientBalance` or its selector need to handle `UCEFInsufficientBalance` instead.
  ([#7](https://github.com/appliedblockchain/ucef-contracts/pull/7))

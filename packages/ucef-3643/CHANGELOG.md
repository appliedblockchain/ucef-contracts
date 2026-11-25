# Changelog

All notable changes to `@appliedblockchain/ucef-3643` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below 1.0.0, a minor version bump can contain breaking changes.

## Unreleased

### Added

- Salted private event payloads (see "Salted payloads" in the ucef-contracts README), with these functions:
  - `setPrivateEventContractSeed(bytes32)` and `setPrivateEventOracle(address)`, for the owner;
  - `updatePrivateEventOracleSeed(bytes32)`, for the oracle;
  - `setPrivateEventSeed(bytes32)` and `hasPrivateEventSeed()`, for an account's optional seed;
  - `privateEventOracle()` and the `PrivateEventOracleUpdated` event.

  The states are stored at a fixed ERC-7201 slot, so they survive implementation upgrades.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))

### Changed

- **Breaking:** every `PrivateEvent` payload ends with a 32-byte salt, so a guessed payload cannot be confirmed against the public block hash.
  The salt mixes the contract seed, the oracle seed and the optional seed of `msg.sender`.
  Private events revert with `PrivateEventContractSeedNotSet()` until the owner sets the contract seed, so set it after deployment, before the first mint.
  ([#8](https://github.com/appliedblockchain/ucef-contracts/pull/8))

## 0.1.0 - 2026-11-24

### Changed

- **Breaking:** `transferFrom` checks the caller's allowance before the holder's free balance, and both checks revert with the same reason, `"Insufficient allowance or balance"`.
  A caller without sufficient allowance now gets this revert reason instead of an arithmetic panic, and the outcome no longer depends on the holder's balance.
  A `transferFrom` that exceeds the holder's free balance previously reverted with `"Insufficient Balance"`.
  ([#5](https://github.com/appliedblockchain/ucef-contracts/pull/5))
- **Breaking:** `transfer` that exceeds the sender's free balance now reverts with `"Insufficient balance"` instead of `"Insufficient Balance"`, matching the casing of the `transferFrom` revert reason.
  Integrations that match on the revert reason string need to be updated.
  ([#9](https://github.com/appliedblockchain/ucef-contracts/pull/9))

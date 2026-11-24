# Changelog

All notable changes to `@appliedblockchain/ucef-3643` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below 1.0.0, a minor version bump can contain breaking changes.

## 0.1.0 - 2026-11-24

### Changed

- **Breaking:** `transferFrom` checks the caller's allowance before the holder's free balance, and both checks revert with the same reason, `"Insufficient allowance or balance"`.
  A caller without sufficient allowance now gets this revert reason instead of an arithmetic panic, and the outcome no longer depends on the holder's balance.
  A `transferFrom` that exceeds the holder's free balance previously reverted with `"Insufficient Balance"`.
  ([#5](https://github.com/appliedblockchain/ucef-contracts/pull/5))
- **Breaking:** `transfer` that exceeds the sender's free balance now reverts with `"Insufficient balance"` instead of `"Insufficient Balance"`, matching the casing of the `transferFrom` revert reason.
  Integrations that match on the revert reason string need to be updated.

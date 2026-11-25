# **UCEF Contracts**

Confidential token contracts built with the Unopinionated Confidential ERC-20 Framework (UCEF), for two token standards:

- **[Confidential ERC-20 (UCEF)](#confidential-erc-20-ucef)**: fungible tokens
- **[Confidential ERC-3643 (UCEF3643)](#confidential-erc-3643-ucef3643)**: regulated tokens, such as tokenised securities

## **Introduction**

The rapid growth of decentralised finance highlights a critical tension between transparency and privacy. ERC-20 tokens expose user balances and transaction amounts, which can deter mainstream adoption and compromise sensitive financial data. ERC-3643 tokens have the same problem: they verify identities and compliance rules on chain, but balances and transfers are still public.

Numerous proposals for confidential tokens have emerged, all of which are firmly tied to a particular cryptographic approach, be it TEE, FHE, MPC or zero-knowledge proofs. This creates issues for the interoperability of confidential tokens. It also ties a contract developer to a specific cryptographic implementation.

### An unopinionated implementation

To achieve a truly unopinionated implementation, cryptographic details should be abstracted away from the Solidity interface. This ensures that different cryptographic approaches can be swapped without altering the contract's external behaviour. Furthermore, logic around permissions and visibility controls should be programmable using standard Solidity constructs, avoiding proprietary libraries or custom extensions. The UCEF approach preserves the simplicity and composability of the token standards while enabling flexible privacy rules that can adapt to evolving security requirements and compliance needs.

### Features

- The same ERC-20 and ERC-3643 interfaces
- No custom libraries
- Flexible implementation expressible in Solidity
- Private events: events are visible only to the addresses involved

UCEF enforces privacy using standard Solidity authorisation checks. This eliminates the need for custom libraries or cryptographic proofs, preserving compatibility with existing token interfaces and maintaining gas efficiency. By leveraging native Solidity constructs, this approach simplifies auditing, enhances composability with decentralised applications, and keeps cryptographic complexity outside the smart contract. This minimalistic design ensures adaptability and maintainability while allowing developers to focus on enforcing data access rules through their preferred cryptographic technologies.

## **Confidential ERC-20 (UCEF)**

[`UCEF.sol`](packages/ucef/contracts/UCEF.sol) is a confidential version of the OpenZeppelin ERC-20 implementation. It keeps the ERC-20 interface and adds internal functions that control balance visibility, event visibility and minting.

### Balance visibility

Every token defines who can read a balance by implementing `_authorizeBalance`. For example, [`UCEFOwned`](packages/ucef/contracts/UCEFOwned.sol) only allows the account owner:

```solidity
    function _authorizeBalance(address account) internal view virtual override returns (bool) {
        if (msg.sender != account) {
            revert UCEFUnauthorizedBalanceAccess(msg.sender, account);
        }
        return true;
    }
```

The package includes three privacy models:

| Contract | Who can read a balance |
|----------|------------------------|
| [`UCEFOwned`](packages/ucef/contracts/UCEFOwned.sol) | The account owner |
| [`UCEFRegulated`](packages/ucef/contracts/UCEFRegulated.sol) | The account owner and a regulator |
| [`UCEFSharable`](packages/ucef/contracts/UCEFSharable.sol) | The account owner, the addresses the owner grants access to, and an optional supervisor |

### Private events

UCEF replaces the standard `Transfer` and `Approval` events with a `PrivateEvent`. Each `PrivateEvent` contains:

- **allowedViewers**: the addresses that can view the event
- **eventType**: the hash of the original event signature, for example `Transfer(address,address,uint256)`
- **payload**: the ABI-encoded event arguments, followed by a 32-byte salt (see below)

By default, only the sender and the receiver can view a transfer, and only the owner and the spender can view an approval. A token can change the viewers by overriding `_getTransferEventViewers` and `_getApprovalEventViewers`.

Contracts that emit their own private events should call `_emitPrivateEvent` rather than emit `PrivateEvent` directly, so the payload is salted.

### Salted payloads

A block's receipts are committed in its public `receiptsRoot` and block hash. Without randomness, anyone who guesses a payload (a token, sender, receiver and amount) can rebuild the receipt and confirm the guess against the block hash. So every payload ends with a 32-byte salt mixed from three secret seeds. Only one of them has to stay secret for the salts to be unpredictable:

| Seed | Set by | When | Purpose |
| --- | --- | --- | --- |
| Contract seed | The deployer, as the `contractSeed` constructor argument (UCEF3643: the owner, with `setPrivateEventContractSeed`) | Once, at deployment | Starts the token's shared state, so every event is salted from the first one, including events emitted by the constructor |
| Oracle seed | The `privateEventOracle`, a TEE job, with `updatePrivateEventOracleSeed` | Periodically | Removes the deployer's knowledge of the shared state, and keeps refreshing it |
| User seed | Each account, with `setPrivateEventSeed` | Optional, once per token | Lets an account protect its own events without trusting the deployer or the oracle |

How they combine:

- The contract and oracle seeds are mixed into one shared state per token: `state = keccak256(abi.encode(token, state, seed))`. An oracle update never replaces the state, so a bad or leaked oracle seed cannot undo the contract seed.
- A user seed is mixed into a state for that account: `userState = keccak256(abi.encode(token, account, userState, seed))`. Setting the same value again, or on another token, never restarts a salt sequence that was already used. Accounts without a seed have a zero user state.
- Each event gets `salt = keccak256(userState, sharedState, "salt")`, using the user state of `msg.sender`. Then both states ratchet: `state = keccak256(state, "next")`. Every event gets a different salt, even for accounts without a seed. Seeing a salt reveals nothing about the states, and a leaked state only exposes later events, not earlier ones.

What each party can do:

- An account without a seed relies on the contract and oracle seeds. Whoever knows both can confirm guesses of its events. Until the first oracle update, that is the deployer alone.
- An account with a seed can only have its events confirmed by someone who knows its seed and both other seeds.
- Contracts that move tokens for other accounts (vaults, wrappers, bridges, routers) need no setup: their events are salted from their own user state, which is zero unless they set a seed.
- Receiving tokens never needs a seed.

Tokens:

- Every UCEF constructor takes `contractSeed` (non-zero) and `oracle` (zero for none) as its last two arguments. Generate the contract seed off-chain for each deployment, never derive it from on-chain data, and keep it out of version control: the Ignition modules read it from the gitignored `ignition/parameters/<module>.json`.
- `_setPrivateEventOracle` changes the oracle. Tokens decide who may call it: the examples let their admin call `setPrivateEventOracle`, and `XUCEF` its owner.
- `hasPrivateEventSeed()` tells the caller whether it has set a user seed. It only answers for `msg.sender`. The SDK's `ensurePrivateEventSeed` helper generates and sets a random seed if the caller has none, and `generateSeed()` generates contract and oracle seeds too.

**Precondition: Silent Data.** The seeds are only secret because Silent Data shows a transaction's input only to its sender, exposes no contract storage, and the token has no getter or event for them. On a chain where calldata or storage is public, the salts are not secret.

The states are stored in the token like balances, and like balances they are only as private as the token's code: whoever can upgrade a token can deploy code that reads them, and would then be able to confirm every later event of every account. Issuers of upgradeable tokens are trusted with this.

Decoders that ignore trailing data still decode the payload with the original event signature; the salt is always the last 32 bytes.

### Minting policy

Every token must implement `_authorizeMint`, which runs on every mint. This forces each token to define who can mint. A token without it does not compile.

### Extensions

[`packages/ucef/contracts/extensions`](packages/ucef/contracts/extensions) contains UCEF versions of the OpenZeppelin ERC-20 extensions: `ERC1363`, `ERC4626`, `UCEFBurnable`, `UCEFCapped`, `UCEFFlashMint`, `UCEFPausable`, `UCEFPermit`, `UCEFVotes` and `UCEFWrapper`.

[`XUCEF`](packages/ucef/contracts/XUCEF.sol) is a UCEF version of xERC20 (ERC-7281), for tokens that bridges mint and burn within rate limits.

### Comparison with existing confidential ERC-20 implementations

|                                | **UCEF by Applied Blockchain** | **fhEVM ERC-20** | **Confidential ERC-20 Framework using FHE** | **Private ERC-20** |
|--------------------------------|--------------------------------|--------------------------|------------------------------------------------------------|-------------------------|
| **Confidential Balances**      | ✅                              | ✅                        | ✅                                                          | ✅                       |
| **Fully Anonymous Accounts**   | ✅                              | ❌                        | ❌                                                          | ❌                       |
| **Programmable Confidentiality** | ✅                              | 🟠 Partial Support        | 🟠 Partial Support                                          | ❌                       |
| **Unmodified ERC-20 Interface** | ✅                              | ❌                        | ❌                                                          | ❌                       |
| **Cryptography Agnostic**      | ✅                              | ❌                        | ❌                                                          | ❌                       |

## **Confidential ERC-3643 (UCEF3643)**

ERC-3643 is the token standard for regulated assets, such as tokenised securities. It provides regulatory compliance through identity verification and transfer restrictions.

[`UCEF3643.sol`](packages/ucef-3643/contracts/UCEF3643.sol) extends the T-REX `Token`, the reference implementation of ERC-3643, with the UCEF approach. It keeps all ERC-3643 compliance mechanisms and adds programmable confidentiality, so regulated entities can protect sensitive financial data and still meet their compliance requirements.

- **Regulatory compliance**: identity verification, compliance checks, transfer restrictions, token freezing and agent management work as in ERC-3643
- **Confidential balances**: only the account holder, or the holder's identity contract, can read a balance
- **Confidential allowances**: only the owner and the spender can read an allowance
- **Private events**: `Transfer`, `Approval`, `TokensFrozen` and `TokensUnfrozen` are replaced by a `PrivateEvent` that only the involved addresses and the auditors can view
- **Auditors**: agents can add and remove auditors, who can view all private events for compliance and monitoring

See [UCEF3643.md](UCEF3643.md) for the private events system, auditor management, testing and deployment.

## **Packages**

| Package | Path | Description |
|---------|------|-------------|
| `@appliedblockchain/ucef` | [packages/ucef](packages/ucef) | UCEF base contracts and extensions for confidential ERC-20 tokens |
| `@appliedblockchain/ucef-3643` | [packages/ucef-3643](packages/ucef-3643) | Confidential ERC-3643 token with private events and auditors |

This repository merges the former [confidential-erc-20](https://github.com/appliedblockchain/confidential-erc-20) and [confidential-erc-3643](https://github.com/appliedblockchain/confidential-erc-3643) repositories.

## **Testing and Deployment**

- Confidential ERC-20 tokens: see [DEPLOY.md](DEPLOY.md)
- Confidential ERC-3643 token (UCEF3643): see [UCEF3643.md](UCEF3643.md)

## **Examples**

- ERC-20: a range of examples are available at [contracts/examples/](contracts/examples/)
- ERC-3643: the Ignition modules in [ignition/modules/](ignition/modules/) deploy `UCEF3643` with or without a proxy. See [UCEF3643.md](UCEF3643.md#available-modules)

## **Adopted By**
<a href="https://silentdata.com/"><img src="https://github.com/user-attachments/assets/36ea4772-23c8-4c7a-ad2e-e3d6ee40ef9a" alt="Light Silent Data Logo" width="300"/></a>

## **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

# **Unopinionated Confidential ERC-20 Framework (UCEF)**

**Introduction**

The rapid growth of decentralised finance highlights a critical tension between transparency and privacy. ERC-20 tokens expose user balances and transaction amounts, which can deter mainstream adoption and compromise sensitive financial data. Numerous proposals for confidential ERC-20 tokens have emerged, all of which are firmly tied to a particular cryptographic approach be it TEE, FHE, MPC, or zero-knowledge proofs. This creates issues for interoperability of confidential tokens in addition this approach ties a contract developer to a specific cryptographic implementation.

**An unopinionated implementation**

To achieve a truly unopinionated implementation, cryptographic details should be abstracted away from the Solidity interface. This ensures that different cryptographic approaches can be swapped without altering the contract's external behaviour. Furthermore, logic around permissions and visibility controls should be programmable using standard Solidity constructs, avoiding proprietary libraries or custom extensions. The UCEF approach preserves the ERC-20 standard's simplicity and composability while enabling flexible privacy rules that can adapt to evolving security requirements and compliance needs.

## ***Features***

- The same ERC-20 interface
- No custom libraries
- Flexible implementation expressible in solidity

The UCEF implementation enforces privacy using standard Solidity authorisation checks, as demonstrated in the balanceOf function shown below, which requires the caller to be the account owner. This eliminates the need for custom libraries or cryptographic proofs, preserving compatibility with existing ERC-20 interfaces and maintaining gas efficiency. By leveraging native Solidity constructs, this approach simplifies auditing, enhances composability with decentralised applications, and keeps cryptographic complexity outside the smart contract. This minimalistic design ensures adaptability and maintainability while allowing developers to focus on enforcing data access rules through their preferred cryptographic technologies.

```solidity
    function balanceOf(address account) public view override returns (uint256) {
        require(msg.sender == account, "Unauthorized access to balance");
        return _balances[account];
    }
```

**Event Modification**

The UCEF implementation modifies the Transfer and Approval events to hide the account and value parameters. This allows for the implementation of fully anonymous accounts. This modification is optional and can be overridden by the developer, an example of the openzeppelin implementation modified to hide the from, to and value parameters is available at [packages/ucef/contracts/UCEF.sol](packages/ucef/contracts/UCEF.sol).

## ***Confidential ERC-3643 (UCEF3643)***

ERC-3643 is the token standard for regulated assets, such as tokenised securities. It enforces compliance on chain: every holder must have a verified identity, and every transfer must pass the compliance rules. However, a standard ERC-3643 token exposes balances and transfers to everyone.

UCEF3643 applies the UCEF approach to ERC-3643. It keeps all ERC-3643 compliance mechanisms and adds programmable confidentiality, enforced with standard Solidity authorisation checks:

- **Regulatory compliance**: identity verification, compliance checks, transfer restrictions, token freezing and agent management work as in ERC-3643
- **Confidential balances**: only authorised accounts can read balances
- **Private events**: `Transfer`, `Approval`, `TokensFrozen` and `TokensUnfrozen` are replaced by a `PrivateEvent` that only the involved addresses can view
- **Auditors**: agents can add auditors, who can view all private events for compliance and monitoring

The contract is available at [packages/ucef-3643/contracts/UCEF3643.sol](packages/ucef-3643/contracts/UCEF3643.sol). See [UCEF3643.md](UCEF3643.md) for the private events system, auditor management, testing and deployment.


## **Packages**

| Package | Path | Description |
|---------|------|-------------|
| `@appliedblockchain/ucef` | [packages/ucef](packages/ucef) | UCEF base contracts and extensions for confidential ERC-20 tokens |
| `@appliedblockchain/ucef-3643` | [packages/ucef-3643](packages/ucef-3643) | Confidential ERC-3643 token with private events and auditors. See [UCEF3643.md](UCEF3643.md) |

This repository merges the former [confidential-erc-20](https://github.com/appliedblockchain/confidential-erc-20) and [confidential-erc-3643](https://github.com/appliedblockchain/confidential-erc-3643) repositories.

## **Testing and Deployment**

- Confidential ERC-20 tokens: see [DEPLOY.md](DEPLOY.md)
- Confidential ERC-3643 token (UCEF3643): see [UCEF3643.md](UCEF3643.md)

## **Examples**
A range of examples are available at: [contracts/examples/](contracts/examples/)

## **Comparison with existing implementations**

|                                | **UCEF by Applied Blockchain** | **fhEVM ERC-20** | **Confidential ERC-20 Framework using FHE** | **Private ERC-20** |
|--------------------------------|--------------------------------|--------------------------|------------------------------------------------------------|-------------------------|
| **Confidential Balances**      | ✅                              | ✅                        | ✅                                                          | ✅                       |
| **Fully Anonymous Accounts**   | ✅                              | ❌                        | ❌                                                          | ❌                       |
| **Programmable Confidentiality** | ✅                              | 🟠 Partial Support        | 🟠 Partial Support                                          | ❌                       |
| **Unmodified ERC-20 Interface** | ✅                              | ❌                        | ❌                                                          | ❌                       |
| **Cryptography Agnostic**      | ✅                              | ❌                        | ❌                                                          | ❌                       |

## **Adopted By**
<a href="https://silentdata.com/"><img src="https://github.com/user-attachments/assets/36ea4772-23c8-4c7a-ad2e-e3d6ee40ef9a" alt="Light Silent Data Logo" width="300"/></a>

## **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


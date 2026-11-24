// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UCEF} from "@appliedblockchain/ucef/contracts/UCEF.sol";
import {UCEFOwned} from "@appliedblockchain/ucef/contracts/UCEFOwned.sol";
import {ERC4626} from "@appliedblockchain/ucef/contracts/extensions/ERC4626.sol";
import {UCEFWrapper} from "@appliedblockchain/ucef/contracts/extensions/UCEFWrapper.sol";
import {UCEFVotes} from "@appliedblockchain/ucef/contracts/extensions/UCEFVotes.sol";
import {UCEFFlashMint} from "@appliedblockchain/ucef/contracts/extensions/UCEFFlashMint.sol";
import {ERC1363} from "@appliedblockchain/ucef/contracts/extensions/ERC1363.sol";
import {IUCEF} from "@appliedblockchain/ucef/contracts/interfaces/IUCEF.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {IERC1363Receiver} from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import {IERC1363Spender} from "@openzeppelin/contracts/interfaces/IERC1363Spender.sol";

/**
 * @dev Minimal concrete tokens for the UCEF extensions, to test that their private events are salted
 */
contract MockUCEFVault is UCEFOwned, ERC4626 {
    constructor(IUCEF asset_, bytes32 assetSeed) UCEFOwned("Vault", "vMCK") ERC4626(asset_, assetSeed) {}

    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return ERC4626.decimals();
    }

    function _authorizeMint(address, uint256) internal view override {
        if (!_isVaultDeposit()) {
            revert UCEFUnauthorizedMint(msg.sender, address(0), 0);
        }
    }
}

contract MockUCEFWrapper is UCEFOwned, UCEFWrapper {
    constructor(IUCEF underlying_, bytes32 underlyingSeed)
        UCEFOwned("Wrapper", "wMCK")
        UCEFWrapper(underlying_, underlyingSeed)
    {}

    function decimals() public view override(ERC20, UCEFWrapper) returns (uint8) {
        return UCEFWrapper.decimals();
    }

    function _authorizeMint(address, uint256) internal view override {
        if (!_isWrapping()) {
            revert UCEFUnauthorizedMint(msg.sender, address(0), 0);
        }
    }
}

contract MockUCEFVotes is UCEFOwned, UCEFVotes {
    constructor() UCEFOwned("Votes", "vtMCK") EIP712("Votes", "1") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function _update(address from, address to, uint256 value) internal override(UCEF, UCEFVotes) {
        super._update(from, to, value);
    }

    function _authorizeMint(address, uint256) internal view override {}
}

contract MockUCEFFlashMint is UCEFOwned, UCEFFlashMint {
    constructor() UCEFOwned("FlashMint", "fMCK") {}

    function _authorizeMint(address, uint256) internal view override {
        if (!_isFlashLoan()) {
            revert UCEFUnauthorizedMint(msg.sender, address(0), 0);
        }
    }
}

contract MockERC1363 is UCEFOwned, ERC1363 {
    constructor() UCEFOwned("ERC1363", "cMCK") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function _authorizeMint(address, uint256) internal view override {}
}

/**
 * @dev Flash borrower that approves the repayment, so the loan emits Transfer and Approval events
 */
contract MockFlashBorrower is IERC3156FlashBorrower {
    bool private immutable _approveRepayment;

    constructor(bool approveRepayment) {
        _approveRepayment = approveRepayment;
    }

    function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata) external returns (bytes32) {
        if (_approveRepayment) {
            IUCEF(token).approve(token, amount + fee);
        }
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

contract MockERC1363Receiver is IERC1363Receiver, IERC1363Spender {
    function onTransferReceived(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1363Receiver.onTransferReceived.selector;
    }

    function onApprovalReceived(address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1363Spender.onApprovalReceived.selector;
    }
}

/**
 * @dev Stand-in for an ERC-4337 account: anyone can make it call a contract, so the transaction's
 * sender (a bundler, as tx.origin) differs from the account
 */
contract MockSmartAccount {
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool success, bytes memory result) = target.call(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }
}

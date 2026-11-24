// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UCEF} from "@appliedblockchain/ucef/contracts/UCEF.sol";
import {ERC4626} from "@appliedblockchain/ucef/contracts/extensions/ERC4626.sol";
import {IUCEF} from "@appliedblockchain/ucef/contracts/interfaces/IUCEF.sol";

/**
 * @dev ERC-4626 vault whose share balances read as 0 for anyone but their owner,
 * instead of reverting.
 */
contract UCEFHiddenBalanceVaultMock is ERC4626 {
    constructor(IUCEF asset_) UCEF("UCEF Hidden Balance Vault", "uHV") ERC4626(asset_, bytes32(0)) {}

    function _authorizeBalance(address account) internal view override returns (bool) {
        return msg.sender == account;
    }

    function _authorizeMint(address, uint256) internal view override {
        require(_isVaultDeposit(), "mint only through deposits");
    }
}

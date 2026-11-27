// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UCEFOwned} from "@appliedblockchain/ucef/contracts/UCEFOwned.sol";
import {ERC4626} from "@appliedblockchain/ucef/contracts/extensions/ERC4626.sol";
import {IUCEF} from "@appliedblockchain/ucef/contracts/interfaces/IUCEF.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev ERC-4626 vault whose share balances are only visible to their owner.
 * Unauthorized balance reads revert, as in {UCEFOwned}.
 */
contract UCEFOwnedVaultMock is UCEFOwned, ERC4626 {
    constructor(
        IUCEF asset_,
        bytes32 contractSeed,
        address oracle
    ) UCEFOwned("UCEF Owned Vault", "uOV", contractSeed, oracle) ERC4626(asset_) {}

    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return super.decimals();
    }

    function _authorizeMint(address, uint256) internal view override {
        require(_isVaultDeposit(), "mint only through deposits");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUCEF} from "@appliedblockchain/ucef/contracts/interfaces/IUCEF.sol";

/**
 * @dev Contract sender for UCEF tokens, to test which seed salts its private events
 */
contract MockPrivateEventCaller {
    function setPrivateEventSeed(IUCEF token, bytes32 seed) external {
        token.setPrivateEventSeed(seed);
    }

    function transferTwice(IUCEF token, address to, uint256 first, uint256 second) external {
        token.transfer(to, first);
        token.transfer(to, second);
    }
}

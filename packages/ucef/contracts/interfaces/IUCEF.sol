// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IUCEF
 * @dev Interface for the UCEF (User Confidential ERC20 Funds) contract
 */
interface IUCEF is IERC20 {
    /**
     * @dev Private Event for selective visibility of on-chain events
     * @param allowedViewers List of addresses authorized to view the event
     * @param eventType The keccak256 hash of the original event signature
     * @param payload The ABI-encoded event arguments, followed by a 32-byte salt
     */
    event PrivateEvent(
        address[] allowedViewers,
        bytes32 indexed eventType,
        bytes payload
    );

    /**
     * @dev Emitted when the address allowed to update the oracle seed changes
     */
    event PrivateEventOracleUpdated(address indexed previousOracle, address indexed newOracle);

    /**
     * @dev Sets the caller's optional secret seed, mixed into the salts of the private events it triggers.
     */
    function setPrivateEventSeed(bytes32 seed) external;

    /**
     * @dev Returns whether the caller has set a seed.
     */
    function hasPrivateEventSeed() external view returns (bool);

    /**
     * @dev Mixes a new oracle seed into the token's shared salt state. Only callable by the oracle.
     */
    function updatePrivateEventOracleSeed(bytes32 seed) external;

    /**
     * @dev Returns the address allowed to update the oracle seed.
     */
    function privateEventOracle() external view returns (address);

    /**
     * @dev Returns the amount of tokens owned by `account`.
     * Only returns balance if the caller is authorized.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Returns the total amount of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     * 
     * Access Control:
     * - Only the token owner or the approved spender can view the allowance
     * - Any other address attempting to view the allowance will trigger UCEFUnauthorizedBalanceAccess
     * 
     * Requirements:
     * - msg.sender must be either the owner or the spender of the allowance
     * 
     * @param owner The address that owns the tokens
     * @param spender The address that can spend the tokens
     * @return uint256 The number of tokens the spender is allowed to spend
     * @custom:error UCEFUnauthorizedBalanceAccess Thrown when an unauthorized address attempts to view the allowance
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Emitted when an unauthorized balance access is attempted
     */
    error UCEFUnauthorizedBalanceAccess(address sender, address account);

    /**
     * @dev Thrown when a transfer or burn exceeds the balance of the sending account.
     * Does not include the balance itself.
     */
    error UCEFInsufficientBalance(address sender, uint256 needed);

    /**
     * @dev Thrown when a private event seed is set to zero
     */
    error PrivateEventZeroSeed();

    /**
     * @dev Thrown when an address other than the oracle updates the oracle seed
     */
    error PrivateEventUnauthorizedOracle(address sender);
} 
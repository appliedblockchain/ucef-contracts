// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PrivateEventEmitter
 * @dev Declares the PrivateEvent shared by UCEF and its privacy modules (e.g. PrivateVotes),
 * so contracts that inherit several of them declare the event only once.
 *
 * Salted payloads:
 * Receipts are committed in the block's receiptsRoot and hash, which are public. Without
 * randomness, anyone who guesses a payload (e.g. from, to and value of a transfer) can rebuild
 * the receipt and confirm the guess against the block hash. To prevent that, every payload
 * ends with a 32-byte salt mixed from three secret seeds, so only one of them has to stay secret:
 *
 * - Contract seed: passed to the constructor by the deployer. It starts the token's shared state.
 *   Tokens can let their owner or admin mix in a new one later with `_mixPrivateEventContractSeed`,
 *   e.g. after a suspected leak on a token without an oracle.
 * - Oracle seed: set and rotated by the `privateEventOracle` (a TEE job on Silent Data) through
 *   `updatePrivateEventOracleSeed`. Each update is mixed into the shared state, never replaces it.
 * - User seed: optional, set by an account with `setPrivateEventSeed`. The token stores
 *   keccak256(token, account, previous state, seed), so reusing a seed value, here or on another
 *   token, never restarts a salt sequence that was already used.
 *
 * Each event gets salt = keccak256(user state of msg.sender, shared state, "salt"), after which
 * both states ratchet: state = keccak256(state, "next"). Seeing a salt reveals nothing about the
 * states, every event gets a different salt even for accounts without a seed, and a leaked state
 * (e.g. through a malicious upgrade) only exposes later events, not earlier ones.
 *
 * Accounts without a seed rely on the contract and oracle seeds: whoever knows both can confirm
 * guesses of their events. Until the first oracle update that is the deployer alone.
 *
 * Precondition: the seeds are only secret on Silent Data, where a transaction's input is only
 * visible to its sender, contract storage has no public reader and none of the seeds has a getter.
 *
 * Payload layout: `abi.encode(<event arguments>) ++ salt`. Decoders that ignore trailing
 * data keep working; the salt is always the last 32 bytes.
 */
abstract contract PrivateEventEmitter {
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
     * @dev Thrown when a seed is set to zero
     */
    error PrivateEventZeroSeed();

    /**
     * @dev Thrown when an address other than the oracle updates the oracle seed
     */
    error PrivateEventUnauthorizedOracle(address sender);

    /// @custom:storage-location erc7201:silentdata.storage.PrivateEventEmitter
    struct PrivateEventEmitterStorage {
        mapping(address account => bytes32) userStates;
        bytes32 sharedState;
        address oracle;
    }

    // keccak256(abi.encode(uint256(keccak256("silentdata.storage.PrivateEventEmitter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PRIVATE_EVENT_EMITTER_STORAGE_LOCATION =
        0xe1d34a53f28a177627856c58ee2db408c61178fd96b695ed8a3a62d835197c00;

    /**
     * @param contractSeed Secret random value that starts the shared state, must not be zero.
     * Generate it off-chain for each deployment and never derive it from on-chain data.
     * @param oracle Address allowed to update the oracle seed, or zero for none
     */
    constructor(bytes32 contractSeed, address oracle) {
        _mixPrivateEventSharedState(contractSeed);
        _setPrivateEventOracle(oracle);
    }

    /**
     * @notice Sets the caller's secret seed, mixed into the salts of the private events it triggers
     * @dev Optional: without it the caller's salts come from the contract and oracle seeds only.
     * Can be called again: the new seed is mixed into the current state. The seed must be random
     * and kept secret: whoever knows it, and the shared state, can confirm guesses of the caller's
     * later private events.
     * @param seed Secret random value, must not be zero
     */
    function setPrivateEventSeed(bytes32 seed) external {
        if (seed == bytes32(0)) {
            revert PrivateEventZeroSeed();
        }
        mapping(address => bytes32) storage userStates = _getPrivateEventEmitterStorage().userStates;
        userStates[msg.sender] = keccak256(abi.encode(address(this), msg.sender, userStates[msg.sender], seed));
    }

    /**
     * @notice Whether the caller has set a seed
     * @dev Only answers for `msg.sender`, so arbitrary callers cannot query other accounts.
     */
    function hasPrivateEventSeed() external view returns (bool) {
        return _getPrivateEventEmitterStorage().userStates[msg.sender] != bytes32(0);
    }

    /**
     * @notice Mixes a new oracle seed into the shared state
     * @dev Only callable by `privateEventOracle`. Emits no event, as the call itself is private.
     * @param seed Secret random value, must not be zero
     */
    function updatePrivateEventOracleSeed(bytes32 seed) external {
        if (msg.sender != _getPrivateEventEmitterStorage().oracle) {
            revert PrivateEventUnauthorizedOracle(msg.sender);
        }
        _mixPrivateEventSharedState(seed);
    }

    /**
     * @notice The address allowed to update the oracle seed
     */
    function privateEventOracle() public view returns (address) {
        return _getPrivateEventEmitterStorage().oracle;
    }

    /**
     * @dev Emits a PrivateEvent with a salt appended to the payload.
     * Derived contracts should use this instead of emitting PrivateEvent directly.
     * @param allowedViewers List of addresses authorized to view the event
     * @param eventType The keccak256 hash of the original event signature
     * @param payload The ABI-encoded event arguments
     */
    function _emitPrivateEvent(address[] memory allowedViewers, bytes32 eventType, bytes memory payload) internal {
        emit PrivateEvent(allowedViewers, eventType, bytes.concat(payload, _nextPrivateEventSalt()));
    }

    /**
     * @dev Changes the address allowed to update the oracle seed. Not exposed by default:
     * tokens decide who may call it, e.g. their owner or admin.
     */
    function _setPrivateEventOracle(address newOracle) internal {
        PrivateEventEmitterStorage storage $ = _getPrivateEventEmitterStorage();
        emit PrivateEventOracleUpdated($.oracle, newOracle);
        $.oracle = newOracle;
    }

    /**
     * @dev Mixes a new contract seed into the shared state. Not exposed by default: tokens decide
     * who may call it, e.g. their owner or admin. Mixing never weakens the salts, so it can be used
     * after a suspected leak of the contract seed, notably on a token without an oracle.
     * @param seed Secret random value generated off-chain, must not be zero
     */
    function _mixPrivateEventContractSeed(bytes32 seed) internal {
        _mixPrivateEventSharedState(seed);
    }

    /**
     * @dev Mixes `seed` into the shared state. Binding the token and the previous state means
     * that a seed value, here or on another token, never restarts a salt sequence.
     */
    function _mixPrivateEventSharedState(bytes32 seed) private {
        if (seed == bytes32(0)) {
            revert PrivateEventZeroSeed();
        }
        PrivateEventEmitterStorage storage $ = _getPrivateEventEmitterStorage();
        $.sharedState = keccak256(abi.encode(address(this), $.sharedState, seed));
    }

    /**
     * @dev Returns the salt for the next private event and ratchets the states it came from
     */
    function _nextPrivateEventSalt() private returns (bytes32) {
        PrivateEventEmitterStorage storage $ = _getPrivateEventEmitterStorage();
        bytes32 userState = $.userStates[msg.sender];
        bytes32 sharedState = $.sharedState;

        $.sharedState = keccak256(abi.encodePacked(sharedState, "next"));
        if (userState != bytes32(0)) {
            $.userStates[msg.sender] = keccak256(abi.encodePacked(userState, "next"));
        }
        return keccak256(abi.encodePacked(userState, sharedState, "salt"));
    }

    function _getPrivateEventEmitterStorage() private pure returns (PrivateEventEmitterStorage storage $) {
        assembly {
            $.slot := PRIVATE_EVENT_EMITTER_STORAGE_LOCATION
        }
    }
}

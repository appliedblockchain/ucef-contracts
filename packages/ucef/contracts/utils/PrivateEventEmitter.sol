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
 * ends with a 32-byte salt derived from a secret seed of the account that triggered it.
 *
 * - Each account sets its seed once with `setPrivateEventSeed`. The call's input is only
 *   visible to the sender on Silent Data, and the seed has no getter.
 * - The seed ratchets on every event: the event gets salt = keccak256(seed, "salt") and the
 *   seed becomes keccak256(seed, "next"). Seeing a salt reveals nothing about the seed, and a
 *   leaked seed (e.g. through a malicious upgrade) only exposes later events, not earlier ones.
 *   Setting a new seed stops a known leak.
 * - The seed used is that of `msg.sender` or, for contracts that cannot set one (routers,
 *   vaults), that of `tx.origin`. If neither has a seed, the call reverts.
 * - Events emitted while the contract is being constructed carry a zero salt, as no account
 *   can have a seed yet.
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
     * @dev Thrown when a private event is emitted and neither `sender` nor `tx.origin` has set a seed
     */
    error PrivateEventSeedNotSet(address sender);

    /**
     * @dev Thrown when `setPrivateEventSeed` is called with a zero seed
     */
    error PrivateEventZeroSeed();

    /// @custom:storage-location erc7201:silentdata.storage.PrivateEventEmitter
    struct PrivateEventEmitterStorage {
        mapping(address account => bytes32) seeds;
    }

    // keccak256(abi.encode(uint256(keccak256("silentdata.storage.PrivateEventEmitter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PRIVATE_EVENT_EMITTER_STORAGE_LOCATION =
        0xe1d34a53f28a177627856c58ee2db408c61178fd96b695ed8a3a62d835197c00;

    /**
     * @notice Sets the secret seed the salts of the caller's private events are derived from
     * @dev Can be called again to replace the seed. The seed must be random and kept secret:
     * whoever knows it can confirm guesses of the caller's later private events.
     * @param seed Secret random value, must not be zero
     */
    function setPrivateEventSeed(bytes32 seed) external {
        if (seed == bytes32(0)) {
            revert PrivateEventZeroSeed();
        }
        _getPrivateEventEmitterStorage().seeds[msg.sender] = seed;
    }

    /**
     * @notice Whether the caller has set a seed
     * @dev Only answers for `msg.sender`, so it does not show which accounts use the contract
     */
    function hasPrivateEventSeed() external view returns (bool) {
        return _getPrivateEventEmitterStorage().seeds[msg.sender] != bytes32(0);
    }

    /**
     * @dev Emits a PrivateEvent with a salt appended to the payload.
     * Derived contracts should use this instead of emitting PrivateEvent directly.
     * @param allowedViewers List of addresses authorized to view the event
     * @param eventType The keccak256 hash of the original event signature
     * @param payload The ABI-encoded event arguments
     */
    function _emitPrivateEvent(address[] memory allowedViewers, bytes32 eventType, bytes memory payload) internal virtual {
        emit PrivateEvent(allowedViewers, eventType, bytes.concat(payload, _nextPrivateEventSalt()));
    }

    /**
     * @dev Returns the salt for the next private event and ratchets the seed it came from
     */
    function _nextPrivateEventSalt() private returns (bytes32) {
        // No account can have set a seed while the contract is being constructed
        if (address(this).code.length == 0) {
            return bytes32(0);
        }

        mapping(address => bytes32) storage seeds = _getPrivateEventEmitterStorage().seeds;
        address account = msg.sender;
        bytes32 seed = seeds[account];
        if (seed == bytes32(0)) {
            // tx.origin is only a source of secret randomness here, not authorization
            // slither-disable-next-line tx-origin
            account = tx.origin;
            seed = seeds[account];
            if (seed == bytes32(0)) {
                revert PrivateEventSeedNotSet(msg.sender);
            }
        }

        seeds[account] = keccak256(abi.encodePacked(seed, "next"));
        return keccak256(abi.encodePacked(seed, "salt"));
    }

    function _getPrivateEventEmitterStorage() private pure returns (PrivateEventEmitterStorage storage $) {
        assembly {
            $.slot := PRIVATE_EVENT_EMITTER_STORAGE_LOCATION
        }
    }
}

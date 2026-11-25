import {
  AbiCoder,
  BaseContract,
  BytesLike,
  Log,
  Signer,
  TransactionReceipt,
  ZeroHash,
  concat,
  dataLength,
  dataSlice,
  hexlify,
  id,
  isHexString,
  keccak256,
  randomBytes,
  toUtf8Bytes,
} from 'ethers'
import { ethers } from 'hardhat'

export const EVENT_TYPE_TRANSFER = id('Transfer(address,address,uint256)')
export const EVENT_TYPE_APPROVAL = id('Approval(address,address,uint256)')
export const EVENT_TYPE_REGULATOR_UPDATED = id('RegulatorUpdated(address,address)')
export const EVENT_TYPE_VIEWER_PERMISSION_UPDATED = id('ViewerPermissionUpdated(address,address,bool)')
export const EVENT_TYPE_SUPERVISOR_UPDATED = id('SupervisorUpdated(address,address)')

const SALT_LENGTH = 32

/**
 * Matches a PrivateEvent payload made of `payload` followed by a non-zero 32-byte salt.
 * Use it as an argument of `withArgs`: the salt is derived from the sender's secret seed.
 */
export function salted(payload: BytesLike) {
  const expected = hexlify(payload)
  const length = dataLength(expected)
  return (actual: unknown) =>
    typeof actual === 'string' &&
    isHexString(actual) &&
    dataLength(actual) === length + SALT_LENGTH &&
    dataSlice(actual, 0, length) === expected &&
    dataSlice(actual, length) !== ZeroHash
}

/**
 * Random 32-byte seed, as the SDK generates for users, contract seeds and oracle seeds
 */
export function randomSeed() {
  return hexlify(randomBytes(SALT_LENGTH))
}

/**
 * User state a token stores for `account` when it sets `seed`, on top of its `previous` state:
 * keccak256(abi.encode(token, account, previous, seed))
 */
export function userStateAfterSeed(token: string, account: string, seed: BytesLike, previous: BytesLike = ZeroHash) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32', 'bytes32'], [token, account, previous, seed]),
  )
}

/**
 * Shared state a token stores when a contract or oracle seed is mixed into its `previous` state:
 * keccak256(abi.encode(token, previous, seed))
 */
export function sharedStateAfterSeed(token: string, seed: BytesLike, previous: BytesLike = ZeroHash) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'bytes32', 'bytes32'], [token, previous, seed]))
}

/**
 * Salt of the next private event: keccak256(userState, sharedState, "salt").
 * `userState` is zero for a sender without a seed.
 */
export function saltOf(userState: BytesLike, sharedState: BytesLike) {
  return keccak256(concat([userState, sharedState, toUtf8Bytes('salt')]))
}

/**
 * State that replaces `state` once an event used it: keccak256(state, "next")
 */
export function nextState(state: BytesLike) {
  return keccak256(concat([state, toUtf8Bytes('next')]))
}

/**
 * Applies `nextState` `count` times
 */
export function ratchet(state: BytesLike, count: number) {
  let result = hexlify(state)
  for (let i = 0; i < count; i++) {
    result = nextState(result)
  }
  return result
}

/**
 * Payloads of the PrivateEvents `contract` emitted in a transaction, optionally of one event type
 */
export function privateEventPayloads(contract: BaseContract, receipt: TransactionReceipt | null, eventType?: string) {
  const address = contract.target.toString().toLowerCase()
  return receipt!.logs
    .filter((log: Log) => log.address.toLowerCase() === address)
    .map((log: Log) => contract.interface.parseLog(log))
    .filter((parsed) => parsed?.name === 'PrivateEvent' && (!eventType || parsed.args.eventType === eventType))
    .map((parsed) => parsed!.args.payload as string)
}

/**
 * Salt at the end of a PrivateEvent payload
 */
export function saltOfPayload(payload: string) {
  return dataSlice(payload, dataLength(payload) - SALT_LENGTH)
}

/**
 * Matches a PrivateEvent payload carrying the ABI-encoded event arguments, followed by
 * the salt UCEF tokens append to it.
 */
export function encodePayload(types: string[], values: unknown[]) {
  return salted(AbiCoder.defaultAbiCoder().encode(types, values))
}

/**
 * Sets a random private event seed for each signer. Defaults to every Hardhat signer.
 */
export async function setPrivateEventSeeds(token: BaseContract, signers?: Signer[]) {
  const contract = token as BaseContract & {
    connect: (signer: Signer) => { setPrivateEventSeed: (seed: BytesLike) => Promise<{ wait: () => Promise<unknown> }> }
  }
  for (const signer of signers ?? (await ethers.getSigners())) {
    await (await contract.connect(signer).setPrivateEventSeed(randomSeed())).wait()
  }
}

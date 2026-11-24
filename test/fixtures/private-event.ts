import {
  AbiCoder,
  BaseContract,
  BytesLike,
  Signer,
  dataLength,
  dataSlice,
  hexlify,
  id,
  isHexString,
  randomBytes,
} from 'ethers'
import { ethers } from 'hardhat'

export const EVENT_TYPE_TRANSFER = id('Transfer(address,address,uint256)')
export const EVENT_TYPE_APPROVAL = id('Approval(address,address,uint256)')
export const EVENT_TYPE_REGULATOR_UPDATED = id('RegulatorUpdated(address,address)')
export const EVENT_TYPE_VIEWER_PERMISSION_UPDATED = id('ViewerPermissionUpdated(address,address,bool)')
export const EVENT_TYPE_SUPERVISOR_UPDATED = id('SupervisorUpdated(address,address)')

const SALT_LENGTH = 32

/**
 * Matches a PrivateEvent payload made of `payload` followed by a 32-byte salt.
 * Use it as an argument of `withArgs`: the salt is derived from the sender's secret seed.
 */
export function salted(payload: BytesLike) {
  const expected = hexlify(payload)
  const length = dataLength(expected)
  return (actual: unknown) =>
    typeof actual === 'string' &&
    isHexString(actual) &&
    dataLength(actual) === length + SALT_LENGTH &&
    dataSlice(actual, 0, length) === expected
}

/**
 * Matches a PrivateEvent payload carrying the ABI-encoded event arguments, followed by
 * the salt UCEF tokens append to it.
 */
export function encodePayload(types: string[], values: unknown[]) {
  return salted(AbiCoder.defaultAbiCoder().encode(types, values))
}

/**
 * Sets a random private event seed for each signer, so they can emit private events.
 * Defaults to every Hardhat signer.
 */
export async function setPrivateEventSeeds(token: BaseContract, signers?: Signer[]) {
  const contract = token as BaseContract & {
    connect: (signer: Signer) => { setPrivateEventSeed: (seed: BytesLike) => Promise<{ wait: () => Promise<unknown> }> }
  }
  for (const signer of signers ?? (await ethers.getSigners())) {
    await (await contract.connect(signer).setPrivateEventSeed(randomBytes(SALT_LENGTH))).wait()
  }
}

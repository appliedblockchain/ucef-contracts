import { AbiCoder, id } from 'ethers'

export const EVENT_TYPE_TRANSFER = id('Transfer(address,address,uint256)')
export const EVENT_TYPE_APPROVAL = id('Approval(address,address,uint256)')
export const EVENT_TYPE_REGULATOR_UPDATED = id('RegulatorUpdated(address,address)')
export const EVENT_TYPE_VIEWER_PERMISSION_UPDATED = id('ViewerPermissionUpdated(address,address,bool)')
export const EVENT_TYPE_SUPERVISOR_UPDATED = id('SupervisorUpdated(address,address)')

/**
 * ABI-encodes the arguments of an event the way UCEF tokens pack them into the
 * `payload` field of a PrivateEvent.
 */
export function encodePayload(types: string[], values: unknown[]) {
  return AbiCoder.defaultAbiCoder().encode(types, values)
}

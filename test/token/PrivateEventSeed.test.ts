import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Signer, TransactionReceipt, ZeroHash, concat } from 'ethers'
import { MockPrivateEventCaller, UCEFOnlyOwner, UCEFOnlyOwnerAndRegulator } from '../../typechain-types'
import {
  EVENT_TYPE_TRANSFER,
  nextState,
  privateEventPayloads as payloadsOf,
  privateEventSeedState,
  saltOf,
} from '../fixtures/private-event'

describe('PrivateEventEmitter seed', function () {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const AMOUNT = 10n
  const OWNER_SEED = ethers.id('owner seed')

  let token: UCEFOnlyOwner
  let caller: MockPrivateEventCaller
  let owner: Signer
  let sender: Signer
  let recipient: Signer
  let ownerAddress: string
  let senderAddress: string
  let recipientAddress: string
  let callerAddress: string
  let tokenAddress: string

  // Salt state the token stores for `account` when it first sets `seed`
  const stateOf = (account: string, seed: string) => privateEventSeedState(tokenAddress, account, seed)

  function transferPayload(from: string, to: string, value: bigint) {
    return coder.encode(['address', 'address', 'uint256'], [from, to, value])
  }

  function privateEventPayloads(receipt: TransactionReceipt | null) {
    return payloadsOf(token, receipt)
  }

  async function setSeed(signer: Signer, seed: string) {
    await (await token.connect(signer).setPrivateEventSeed(seed)).wait()
  }

  beforeEach(async function () {
    ;[owner, sender, recipient] = await ethers.getSigners()
    ownerAddress = await owner.getAddress()
    senderAddress = await sender.getAddress()
    recipientAddress = await recipient.getAddress()

    const Token = await ethers.getContractFactory('UCEFOnlyOwner')
    token = (await Token.deploy()) as unknown as UCEFOnlyOwner
    await token.waitForDeployment()
    tokenAddress = await token.getAddress()

    const Caller = await ethers.getContractFactory('MockPrivateEventCaller')
    caller = (await Caller.deploy()) as unknown as MockPrivateEventCaller
    await caller.waitForDeployment()
    callerAddress = await caller.getAddress()

    await setSeed(owner, OWNER_SEED)
    await token.mint(senderAddress, 1000n)
    await token.mint(callerAddress, 1000n)
  })

  describe('setPrivateEventSeed', function () {
    it('rejects a zero seed', async function () {
      await expect(token.connect(sender).setPrivateEventSeed(ZeroHash)).to.be.revertedWithCustomError(
        token,
        'PrivateEventZeroSeed',
      )
    })

    it('emits no event, so the seed is never logged', async function () {
      const receipt = await (await token.connect(sender).setPrivateEventSeed(ethers.id('seed'))).wait()
      expect(receipt!.logs).to.have.length(0)
    })

    it('reports whether the caller has a seed, only for the caller', async function () {
      expect(await token.connect(sender).hasPrivateEventSeed()).to.equal(false)
      await setSeed(sender, ethers.id('seed'))
      expect(await token.connect(sender).hasPrivateEventSeed()).to.equal(true)
      expect(await token.connect(recipient).hasPrivateEventSeed()).to.equal(false)
    })
  })

  describe('salting', function () {
    it('reverts when neither the sender nor tx.origin has a seed', async function () {
      await expect(token.connect(sender).transfer(recipientAddress, AMOUNT))
        .to.be.revertedWithCustomError(token, 'PrivateEventSeedNotSet')
        .withArgs(senderAddress)
    })

    it('does not need a seed to receive', async function () {
      await setSeed(sender, ethers.id('seed'))
      await expect(token.connect(sender).transfer(recipientAddress, AMOUNT)).to.emit(token, 'PrivateEvent')
    })

    it('salts each event with the ratcheted seed of the sender', async function () {
      const seed = ethers.id('sender seed')
      await setSeed(sender, seed)

      const first = privateEventPayloads(await (await token.connect(sender).transfer(recipientAddress, AMOUNT)).wait())
      const second = privateEventPayloads(await (await token.connect(sender).transfer(recipientAddress, AMOUNT)).wait())

      const payload = transferPayload(senderAddress, recipientAddress, AMOUNT)
      const state = stateOf(senderAddress, seed)
      expect(first).to.deep.equal([concat([payload, saltOf(state)])])
      expect(second).to.deep.equal([concat([payload, saltOf(nextState(state))])])
    })

    it('mixes a replacement seed into the current state', async function () {
      const leaked = ethers.id('leaked seed')
      await setSeed(sender, leaked)
      await token.connect(sender).transfer(recipientAddress, AMOUNT)

      const seed = ethers.id('new seed')
      await setSeed(sender, seed)
      const payloads = privateEventPayloads(
        await (await token.connect(sender).transfer(recipientAddress, AMOUNT)).wait(),
      )

      const state = privateEventSeedState(tokenAddress, senderAddress, seed, nextState(stateOf(senderAddress, leaked)))
      expect(payloads).to.deep.equal([
        concat([transferPayload(senderAddress, recipientAddress, AMOUNT), saltOf(state)]),
      ])
    })

    it('never replays salts when the same seed is set again', async function () {
      const seed = ethers.id('reused seed')
      await setSeed(sender, seed)
      const first = privateEventPayloads(await (await token.connect(sender).transfer(recipientAddress, AMOUNT)).wait())

      await setSeed(sender, seed)
      const second = privateEventPayloads(await (await token.connect(sender).transfer(recipientAddress, AMOUNT)).wait())

      expect(second[0]).to.not.equal(first[0])
    })

    it('derives different salts on two tokens from the same seed', async function () {
      const Token = await ethers.getContractFactory('UCEFOnlyOwner')
      const other = (await Token.deploy()) as unknown as UCEFOnlyOwner
      await other.waitForDeployment()
      await (await other.setPrivateEventSeed(ethers.id('owner seed'))).wait()
      await other.mint(senderAddress, 1000n)

      const seed = ethers.id('shared seed')
      await setSeed(sender, seed)
      await (await other.connect(sender).setPrivateEventSeed(seed)).wait()

      const onToken = privateEventPayloads(
        await (await token.connect(sender).transfer(recipientAddress, AMOUNT)).wait(),
      )
      const onOther = payloadsOf(other, await (await other.connect(sender).transfer(recipientAddress, AMOUNT)).wait())

      expect(onToken).to.have.length(1)
      expect(onOther).to.have.length(1)
      expect(onOther[0]).to.not.equal(onToken[0])
    })

    it('falls back to the seed of tx.origin for contract senders without one', async function () {
      const seed = ethers.id('origin seed')
      await setSeed(sender, seed)

      const payloads = privateEventPayloads(
        await (await caller.connect(sender).transferTwice(await token.getAddress(), recipientAddress, 1n, 2n)).wait(),
      )

      const state = stateOf(senderAddress, seed)
      expect(payloads).to.deep.equal([
        concat([transferPayload(callerAddress, recipientAddress, 1n), saltOf(state)]),
        concat([transferPayload(callerAddress, recipientAddress, 2n), saltOf(nextState(state))]),
      ])
    })

    it('prefers the seed of a contract sender that set its own', async function () {
      const callerSeed = ethers.id('caller seed')
      await caller.setPrivateEventSeed(await token.getAddress(), callerSeed)
      await setSeed(sender, ethers.id('origin seed'))

      const payloads = privateEventPayloads(
        await (await caller.connect(sender).transferTwice(await token.getAddress(), recipientAddress, 1n, 2n)).wait(),
      )

      const state = stateOf(callerAddress, callerSeed)
      expect(payloads).to.deep.equal([
        concat([transferPayload(callerAddress, recipientAddress, 1n), saltOf(state)]),
        concat([transferPayload(callerAddress, recipientAddress, 2n), saltOf(nextState(state))]),
      ])
    })

    it('reverts with the contract sender when neither it nor tx.origin has a seed', async function () {
      await expect(caller.connect(sender).transferTwice(await token.getAddress(), recipientAddress, 1n, 2n))
        .to.be.revertedWithCustomError(token, 'PrivateEventSeedNotSet')
        .withArgs(callerAddress)
    })

    it('uses a zero salt for events emitted during construction', async function () {
      const Token = await ethers.getContractFactory('UCEFOnlyOwnerAndRegulator')
      const regulated = (await Token.deploy()) as unknown as UCEFOnlyOwnerAndRegulator
      const receipt = await regulated.deploymentTransaction()!.wait()

      const payloads = payloadsOf(regulated, receipt)

      expect(payloads).to.deep.equal([
        concat([coder.encode(['address', 'address'], [ethers.ZeroAddress, ownerAddress]), ZeroHash]),
      ])
    })

    it('salts the transfer event of a mint with the seed of the minter', async function () {
      // The two mints in beforeEach used the first two states
      const state = nextState(nextState(stateOf(ownerAddress, OWNER_SEED)))

      await expect(token.mint(recipientAddress, AMOUNT))
        .to.emit(token, 'PrivateEvent')
        .withArgs(
          [recipientAddress],
          EVENT_TYPE_TRANSFER,
          concat([transferPayload(ethers.ZeroAddress, recipientAddress, AMOUNT), saltOf(state)]),
        )
    })
  })
})

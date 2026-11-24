import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Log, Signer, TransactionReceipt, ZeroHash, concat, keccak256, toUtf8Bytes } from 'ethers'
import { MockPrivateEventCaller, UCEFOnlyOwner, UCEFOnlyOwnerAndRegulator } from '../../typechain-types'
import { EVENT_TYPE_TRANSFER } from '../fixtures/private-event'

describe('PrivateEventEmitter seed', function () {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const AMOUNT = 10n

  let token: UCEFOnlyOwner
  let caller: MockPrivateEventCaller
  let owner: Signer
  let sender: Signer
  let recipient: Signer
  let ownerAddress: string
  let senderAddress: string
  let recipientAddress: string
  let callerAddress: string

  // Salt of the next event and the seed that replaces it: keccak256(seed, "salt"), keccak256(seed, "next")
  const saltOf = (seed: string) => keccak256(concat([seed, toUtf8Bytes('salt')]))
  const nextSeed = (seed: string) => keccak256(concat([seed, toUtf8Bytes('next')]))

  function transferPayload(from: string, to: string, value: bigint) {
    return coder.encode(['address', 'address', 'uint256'], [from, to, value])
  }

  function privateEventPayloads(receipt: TransactionReceipt | null) {
    return receipt!.logs
      .map((log: Log) => token.interface.parseLog(log))
      .filter((parsed) => parsed?.name === 'PrivateEvent')
      .map((parsed) => parsed!.args.payload as string)
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

    const Caller = await ethers.getContractFactory('MockPrivateEventCaller')
    caller = (await Caller.deploy()) as unknown as MockPrivateEventCaller
    await caller.waitForDeployment()
    callerAddress = await caller.getAddress()

    await setSeed(owner, ethers.hexlify(ethers.randomBytes(32)))
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
      expect(first).to.deep.equal([concat([payload, saltOf(seed)])])
      expect(second).to.deep.equal([concat([payload, saltOf(nextSeed(seed))])])
    })

    it('restarts the ratchet when the seed is replaced', async function () {
      await setSeed(sender, ethers.id('leaked seed'))
      await token.connect(sender).transfer(recipientAddress, AMOUNT)

      const seed = ethers.id('new seed')
      await setSeed(sender, seed)
      const payloads = privateEventPayloads(
        await (await token.connect(sender).transfer(recipientAddress, AMOUNT)).wait(),
      )

      expect(payloads).to.deep.equal([concat([transferPayload(senderAddress, recipientAddress, AMOUNT), saltOf(seed)])])
    })

    it('falls back to the seed of tx.origin for contract senders without one', async function () {
      const seed = ethers.id('origin seed')
      await setSeed(sender, seed)

      const payloads = privateEventPayloads(
        await (await caller.connect(sender).transferTwice(await token.getAddress(), recipientAddress, 1n, 2n)).wait(),
      )

      expect(payloads).to.deep.equal([
        concat([transferPayload(callerAddress, recipientAddress, 1n), saltOf(seed)]),
        concat([transferPayload(callerAddress, recipientAddress, 2n), saltOf(nextSeed(seed))]),
      ])
    })

    it('prefers the seed of a contract sender that set its own', async function () {
      const callerSeed = ethers.id('caller seed')
      await caller.setPrivateEventSeed(await token.getAddress(), callerSeed)
      await setSeed(sender, ethers.id('origin seed'))

      const payloads = privateEventPayloads(
        await (await caller.connect(sender).transferTwice(await token.getAddress(), recipientAddress, 1n, 2n)).wait(),
      )

      expect(payloads).to.deep.equal([
        concat([transferPayload(callerAddress, recipientAddress, 1n), saltOf(callerSeed)]),
        concat([transferPayload(callerAddress, recipientAddress, 2n), saltOf(nextSeed(callerSeed))]),
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

      const payloads = receipt!.logs
        .map((log: Log) => regulated.interface.parseLog(log))
        .filter((parsed) => parsed?.name === 'PrivateEvent')
        .map((parsed) => parsed!.args.payload as string)

      expect(payloads).to.deep.equal([
        concat([coder.encode(['address', 'address'], [ethers.ZeroAddress, ownerAddress]), ZeroHash]),
      ])
    })

    it('salts the transfer event of a mint with the seed of the minter', async function () {
      const seed = ethers.id('minter seed')
      await setSeed(owner, seed)

      await expect(token.mint(recipientAddress, AMOUNT))
        .to.emit(token, 'PrivateEvent')
        .withArgs(
          [recipientAddress],
          EVENT_TYPE_TRANSFER,
          concat([transferPayload(ethers.ZeroAddress, recipientAddress, AMOUNT), saltOf(seed)]),
        )
    })
  })
})

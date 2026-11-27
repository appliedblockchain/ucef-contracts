import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Signer, TransactionReceipt, ZeroHash, concat } from 'ethers'
import { MockPrivateEventCaller, UCEFOnlyOwner, UCEFOnlyOwnerAndRegulator } from '../../typechain-types'
import { deployToken } from '../fixtures/deploy-token'
import {
  EVENT_TYPE_TRANSFER,
  nextState,
  privateEventPayloads as payloadsOf,
  ratchet,
  saltOf,
  sharedStateAfterSeed,
  userStateAfterSeed,
} from '../fixtures/private-event'

describe('PrivateEventEmitter seeds', function () {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const AMOUNT = 10n
  const CONTRACT_SEED = ethers.id('contract seed')

  let token: UCEFOnlyOwner
  let caller: MockPrivateEventCaller
  let owner: Signer
  let sender: Signer
  let recipient: Signer
  let oracle: Signer
  let ownerAddress: string
  let senderAddress: string
  let recipientAddress: string
  let oracleAddress: string
  let callerAddress: string
  let tokenAddress: string
  // Shared state the next private event of `token` is salted from
  let sharedState: string

  // User state the token stores for `account` when it first sets `seed`
  const userStateOf = (account: string, seed: string) => userStateAfterSeed(tokenAddress, account, seed)

  function transferPayload(from: string, to: string, value: bigint) {
    return coder.encode(['address', 'address', 'uint256'], [from, to, value])
  }

  function privateEventPayloads(receipt: TransactionReceipt | null) {
    return payloadsOf(token, receipt)
  }

  async function transfer(signer: Signer, value = AMOUNT) {
    return privateEventPayloads(await (await token.connect(signer).transfer(recipientAddress, value)).wait())
  }

  async function setSeed(signer: Signer, seed: string) {
    await (await token.connect(signer).setPrivateEventSeed(seed)).wait()
  }

  beforeEach(async function () {
    ;[owner, sender, recipient, oracle] = await ethers.getSigners()
    ownerAddress = await owner.getAddress()
    senderAddress = await sender.getAddress()
    recipientAddress = await recipient.getAddress()
    oracleAddress = await oracle.getAddress()

    token = await deployToken<UCEFOnlyOwner>('UCEFOnlyOwner', [], {
      contractSeed: CONTRACT_SEED,
      oracle: oracleAddress,
    })
    tokenAddress = await token.getAddress()

    const Caller = await ethers.getContractFactory('MockPrivateEventCaller')
    caller = (await Caller.deploy()) as unknown as MockPrivateEventCaller
    await caller.waitForDeployment()
    callerAddress = await caller.getAddress()

    await token.mint(senderAddress, 1000n)
    await token.mint(callerAddress, 1000n)
    // The two mints used the first two shared states
    sharedState = ratchet(sharedStateAfterSeed(tokenAddress, CONTRACT_SEED), 2)
  })

  describe('contract seed', function () {
    it('rejects a zero contract seed', async function () {
      const Token = await ethers.getContractFactory('UCEFOnlyOwner')
      await expect(Token.deploy(ZeroHash, oracleAddress)).to.be.revertedWithCustomError(token, 'PrivateEventZeroSeed')
    })

    it('salts events emitted during construction from the contract seed', async function () {
      const regulated = await deployToken<UCEFOnlyOwnerAndRegulator>('UCEFOnlyOwnerAndRegulator', [], {
        contractSeed: CONTRACT_SEED,
      })
      const receipt = await regulated.deploymentTransaction()!.wait()

      const state = sharedStateAfterSeed(await regulated.getAddress(), CONTRACT_SEED)
      expect(payloadsOf(regulated, receipt)).to.deep.equal([
        concat([coder.encode(['address', 'address'], [ethers.ZeroAddress, ownerAddress]), saltOf(ZeroHash, state)]),
      ])
    })

    it('derives different salts on two tokens from the same contract seed', async function () {
      const other = await deployToken<UCEFOnlyOwner>('UCEFOnlyOwner', [], { contractSeed: CONTRACT_SEED })
      await other.mint(senderAddress, 1000n)
      await other.mint(callerAddress, 1000n)

      const onToken = await transfer(sender)
      const onOther = payloadsOf(other, await (await other.connect(sender).transfer(recipientAddress, AMOUNT)).wait())

      expect(onToken).to.have.length(1)
      expect(onOther).to.have.length(1)
      expect(onOther[0]).to.not.equal(onToken[0])
    })
  })

  describe('setPrivateEventContractSeed', function () {
    const NEW_CONTRACT_SEED = ethers.id('new contract seed')

    it('only lets the admin mix in a new contract seed', async function () {
      await expect(token.connect(sender).setPrivateEventContractSeed(NEW_CONTRACT_SEED)).to.be.revertedWithCustomError(
        token,
        'AccessControlUnauthorizedAccount',
      )
    })

    it('rejects a zero contract seed', async function () {
      await expect(token.setPrivateEventContractSeed(ZeroHash)).to.be.revertedWithCustomError(
        token,
        'PrivateEventZeroSeed',
      )
    })

    it('mixes the new contract seed into the shared state and emits no event', async function () {
      const receipt = await (await token.setPrivateEventContractSeed(NEW_CONTRACT_SEED)).wait()
      expect(receipt!.logs).to.have.length(0)
      sharedState = sharedStateAfterSeed(tokenAddress, NEW_CONTRACT_SEED, sharedState)
      expect(await transfer(sender)).to.deep.equal([
        concat([transferPayload(senderAddress, recipientAddress, AMOUNT), saltOf(ZeroHash, sharedState)]),
      ])
    })
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
    it('salts the events of a sender without a seed from the ratcheted shared state', async function () {
      const first = await transfer(sender)
      const second = await transfer(sender)

      const payload = transferPayload(senderAddress, recipientAddress, AMOUNT)
      expect(first).to.deep.equal([concat([payload, saltOf(ZeroHash, sharedState)])])
      expect(second).to.deep.equal([concat([payload, saltOf(ZeroHash, nextState(sharedState))])])
    })

    it('mixes the ratcheted state of a sender with a seed into its salts', async function () {
      const seed = ethers.id('sender seed')
      await setSeed(sender, seed)

      const first = await transfer(sender)
      const second = await transfer(sender)

      const payload = transferPayload(senderAddress, recipientAddress, AMOUNT)
      const userState = userStateOf(senderAddress, seed)
      expect(first).to.deep.equal([concat([payload, saltOf(userState, sharedState)])])
      expect(second).to.deep.equal([concat([payload, saltOf(nextState(userState), nextState(sharedState))])])
    })

    it('ratchets one shared state across all senders', async function () {
      const seed = ethers.id('sender seed')
      await setSeed(sender, seed)
      await token.mint(ownerAddress, 1000n)
      sharedState = nextState(sharedState)

      const fromSender = await transfer(sender)
      const fromOwner = await transfer(owner)

      expect(fromSender).to.deep.equal([
        concat([
          transferPayload(senderAddress, recipientAddress, AMOUNT),
          saltOf(userStateOf(senderAddress, seed), sharedState),
        ]),
      ])
      expect(fromOwner).to.deep.equal([
        concat([transferPayload(ownerAddress, recipientAddress, AMOUNT), saltOf(ZeroHash, nextState(sharedState))]),
      ])
    })

    it('mixes a replacement seed into the current user state', async function () {
      const leaked = ethers.id('leaked seed')
      await setSeed(sender, leaked)
      await transfer(sender)

      const seed = ethers.id('new seed')
      await setSeed(sender, seed)
      const payloads = await transfer(sender)

      const userState = userStateAfterSeed(
        tokenAddress,
        senderAddress,
        seed,
        nextState(userStateOf(senderAddress, leaked)),
      )
      expect(payloads).to.deep.equal([
        concat([transferPayload(senderAddress, recipientAddress, AMOUNT), saltOf(userState, nextState(sharedState))]),
      ])
    })

    it('never restarts a user state when the same seed is set again', async function () {
      const seed = ethers.id('reused seed')
      await setSeed(sender, seed)
      await transfer(sender)
      await setSeed(sender, seed)
      const payloads = await transfer(sender)

      const userState = userStateAfterSeed(
        tokenAddress,
        senderAddress,
        seed,
        nextState(userStateOf(senderAddress, seed)),
      )
      expect(userState).to.not.equal(userStateOf(senderAddress, seed))
      expect(payloads).to.deep.equal([
        concat([transferPayload(senderAddress, recipientAddress, AMOUNT), saltOf(userState, nextState(sharedState))]),
      ])
    })

    it('salts a contract sender without a seed from the shared state only, not from tx.origin', async function () {
      await setSeed(sender, ethers.id('origin seed'))

      const payloads = privateEventPayloads(
        await (await caller.connect(sender).transferTwice(tokenAddress, recipientAddress, 1n, 2n)).wait(),
      )

      expect(payloads).to.deep.equal([
        concat([transferPayload(callerAddress, recipientAddress, 1n), saltOf(ZeroHash, sharedState)]),
        concat([transferPayload(callerAddress, recipientAddress, 2n), saltOf(ZeroHash, nextState(sharedState))]),
      ])
    })

    it('mixes in the seed of a contract sender that set its own', async function () {
      const callerSeed = ethers.id('caller seed')
      await caller.setPrivateEventSeed(tokenAddress, callerSeed)

      const payloads = privateEventPayloads(
        await (await caller.connect(sender).transferTwice(tokenAddress, recipientAddress, 1n, 2n)).wait(),
      )

      const userState = userStateOf(callerAddress, callerSeed)
      expect(payloads).to.deep.equal([
        concat([transferPayload(callerAddress, recipientAddress, 1n), saltOf(userState, sharedState)]),
        concat([
          transferPayload(callerAddress, recipientAddress, 2n),
          saltOf(nextState(userState), nextState(sharedState)),
        ]),
      ])
    })

    it('salts the transfer event of a mint from the minter', async function () {
      const seed = ethers.id('owner seed')
      await setSeed(owner, seed)

      await expect(token.mint(recipientAddress, AMOUNT))
        .to.emit(token, 'PrivateEvent')
        .withArgs(
          [recipientAddress],
          EVENT_TYPE_TRANSFER,
          concat([
            transferPayload(ethers.ZeroAddress, recipientAddress, AMOUNT),
            saltOf(userStateOf(ownerAddress, seed), sharedState),
          ]),
        )
    })
  })

  describe('oracle seed', function () {
    const ORACLE_SEED = ethers.id('oracle seed')

    it('sets the oracle from the constructor', async function () {
      expect(await token.privateEventOracle()).to.equal(oracleAddress)
      await expect(token.deploymentTransaction())
        .to.emit(token, 'PrivateEventOracleUpdated')
        .withArgs(ethers.ZeroAddress, oracleAddress)
    })

    it('only lets the oracle update the oracle seed', async function () {
      await expect(token.connect(owner).updatePrivateEventOracleSeed(ORACLE_SEED))
        .to.be.revertedWithCustomError(token, 'PrivateEventUnauthorizedOracle')
        .withArgs(ownerAddress)
    })

    it('rejects a zero oracle seed', async function () {
      await expect(token.connect(oracle).updatePrivateEventOracleSeed(ZeroHash)).to.be.revertedWithCustomError(
        token,
        'PrivateEventZeroSeed',
      )
    })

    it('mixes each oracle seed into the shared state and emits no event', async function () {
      const receipt = await (await token.connect(oracle).updatePrivateEventOracleSeed(ORACLE_SEED)).wait()
      expect(receipt!.logs).to.have.length(0)
      sharedState = sharedStateAfterSeed(tokenAddress, ORACLE_SEED, sharedState)
      expect(await transfer(sender)).to.deep.equal([
        concat([transferPayload(senderAddress, recipientAddress, AMOUNT), saltOf(ZeroHash, sharedState)]),
      ])

      const rotated = ethers.id('rotated oracle seed')
      await token.connect(oracle).updatePrivateEventOracleSeed(rotated)
      sharedState = sharedStateAfterSeed(tokenAddress, rotated, nextState(sharedState))
      expect(await transfer(sender)).to.deep.equal([
        concat([transferPayload(senderAddress, recipientAddress, AMOUNT), saltOf(ZeroHash, sharedState)]),
      ])
    })

    it('lets the admin change the oracle', async function () {
      await expect(token.connect(sender).setPrivateEventOracle(senderAddress)).to.be.revertedWithCustomError(
        token,
        'AccessControlUnauthorizedAccount',
      )

      await expect(token.setPrivateEventOracle(senderAddress))
        .to.emit(token, 'PrivateEventOracleUpdated')
        .withArgs(oracleAddress, senderAddress)
      expect(await token.privateEventOracle()).to.equal(senderAddress)

      await expect(token.connect(oracle).updatePrivateEventOracleSeed(ORACLE_SEED))
        .to.be.revertedWithCustomError(token, 'PrivateEventUnauthorizedOracle')
        .withArgs(oracleAddress)
      await token.connect(sender).updatePrivateEventOracleSeed(ORACLE_SEED)
    })
  })
})

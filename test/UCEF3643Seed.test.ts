import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Signer, TransactionReceipt, ZeroHash, concat } from 'ethers'
import { UCEF3643 } from '@appliedblockchain/ucef-3643'
import MockTokenImplementation from '@appliedblockchain/ucef-3643/artifacts/contracts/mocks/MockNewTokenImplementation.sol/MockNewTokenImplementation.json'
import {
  MockCompliance,
  MockIdentityRegistry,
  MockSmartAccount,
  MockTrexImplementationAuthority,
} from '../typechain-types'
import { deployToken3643 } from './fixtures/deploy-3643'
import {
  EVENT_TYPE_APPROVAL,
  EVENT_TYPE_TRANSFER,
  nextState,
  privateEventPayloads as payloadsOf,
  privateEventSeedState,
  saltOf,
  saltOfPayload,
} from './fixtures/private-event'

describe('UCEF3643 private event seed', function () {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const AMOUNT = ethers.parseEther('100')

  let token: UCEF3643
  let tokenAddress: string
  let trexIAuthority: MockTrexImplementationAuthority
  let mockIdentityRegistry: MockIdentityRegistry
  let mockCompliance: MockCompliance
  let agent: Signer
  let addr1: Signer
  let addr2: Signer
  let addr1Address: string
  let addr2Address: string

  const stateOf = (account: string, seed: string) => privateEventSeedState(tokenAddress, account, seed)

  function mintPayload(to: string, value: bigint) {
    return coder.encode(['address', 'address', 'uint256'], [ethers.ZeroAddress, to, value])
  }

  function privateEventPayloads(receipt: TransactionReceipt | null) {
    return payloadsOf(token, receipt, EVENT_TYPE_TRANSFER)
  }

  beforeEach(async function () {
    ;[, addr1, addr2, agent] = await ethers.getSigners()
    addr1Address = await addr1.getAddress()
    addr2Address = await addr2.getAddress()

    const deployed = await deployToken3643({
      agent,
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18,
      onchainID: ethers.ZeroAddress,
      setSeeds: false,
    })
    token = deployed.token
    tokenAddress = await token.getAddress()
    trexIAuthority = deployed.trexIAuthority
    mockIdentityRegistry = deployed.mockIdentityRegistry
    mockCompliance = deployed.mockCompliance

    await deployed.mockIdentityRegistry.registerIdentity(addr1Address, 1, true)
    await deployed.mockIdentityRegistry.setVerified(addr1Address, true)
  })

  it('rejects a zero seed', async function () {
    await expect(token.connect(agent).setPrivateEventSeed(ZeroHash)).to.be.revertedWithCustomError(
      token,
      'PrivateEventZeroSeed',
    )
  })

  it('reverts a private event when the sender has no seed', async function () {
    expect(await token.connect(agent).hasPrivateEventSeed()).to.equal(false)

    await expect(token.connect(agent).mint(addr1Address, AMOUNT))
      .to.be.revertedWithCustomError(token, 'PrivateEventSeedNotSet')
      .withArgs(await agent.getAddress())
  })

  it('salts private events through the proxy with the ratcheted seed of the sender', async function () {
    const seed = ethers.id('agent seed')
    await token.connect(agent).setPrivateEventSeed(seed)
    expect(await token.connect(agent).hasPrivateEventSeed()).to.equal(true)
    expect(await token.connect(addr1).hasPrivateEventSeed()).to.equal(false)

    const first = privateEventPayloads(await (await token.connect(agent).mint(addr1Address, AMOUNT)).wait())
    const second = privateEventPayloads(await (await token.connect(agent).mint(addr1Address, AMOUNT)).wait())

    const state = stateOf(await agent.getAddress(), seed)
    expect(first).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(state)])])
    expect(second).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(nextState(state))])])
  })

  it('keeps seeds across implementation upgrades', async function () {
    const seed = ethers.id('agent seed')
    await token.connect(agent).setPrivateEventSeed(seed)
    await token.connect(agent).mint(addr1Address, AMOUNT)

    const newTokenFactory = await ethers.getContractFactory(
      MockTokenImplementation.abi,
      MockTokenImplementation.bytecode,
    )
    const newImplementation = await newTokenFactory.deploy()
    await newImplementation.waitForDeployment()
    await trexIAuthority.updateTokenImplementation(await newImplementation.getAddress())

    const payloads = privateEventPayloads(await (await token.connect(agent).mint(addr1Address, AMOUNT)).wait())
    const state = stateOf(await agent.getAddress(), seed)
    expect(payloads).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(nextState(state))])])
  })

  it('never replays salts when the same seed is set again', async function () {
    const seed = ethers.id('agent seed')
    await token.connect(agent).setPrivateEventSeed(seed)
    const first = privateEventPayloads(await (await token.connect(agent).mint(addr1Address, AMOUNT)).wait())

    await token.connect(agent).setPrivateEventSeed(seed)
    const second = privateEventPayloads(await (await token.connect(agent).mint(addr1Address, AMOUNT)).wait())

    expect(second[0]).to.not.equal(first[0])
  })

  describe('contract agent', function () {
    let account: MockSmartAccount
    let accountAddress: string

    beforeEach(async function () {
      const Account = await ethers.getContractFactory('MockSmartAccount')
      account = (await Account.deploy()) as unknown as MockSmartAccount
      await account.waitForDeployment()
      accountAddress = await account.getAddress()
      await token.addAgent(accountAddress)
    })

    const mintThroughAccount = (sender: Signer) =>
      account.connect(sender).execute(tokenAddress, token.interface.encodeFunctionData('mint', [addr1Address, AMOUNT]))

    it('falls back to the seed of tx.origin', async function () {
      const seed = ethers.id('origin seed')
      await token.connect(addr2).setPrivateEventSeed(seed)

      const payloads = privateEventPayloads(await (await mintThroughAccount(addr2)).wait())

      expect(payloads).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(stateOf(addr2Address, seed))])])
    })

    it('uses its own seed when it has one', async function () {
      const seed = ethers.id('account seed')
      await account.execute(tokenAddress, token.interface.encodeFunctionData('setPrivateEventSeed', [seed]))

      const payloads = privateEventPayloads(await (await mintThroughAccount(addr2)).wait())

      expect(payloads).to.deep.equal([
        concat([mintPayload(addr1Address, AMOUNT), saltOf(stateOf(accountAddress, seed))]),
      ])
    })

    it('reverts when neither it nor tx.origin has a seed', async function () {
      await expect(mintThroughAccount(addr2))
        .to.be.revertedWithCustomError(token, 'PrivateEventSeedNotSet')
        .withArgs(accountAddress)
    })
  })

  it('salts the Approval and Transfer events of transferFrom with distinct salts of the spender', async function () {
    const agentSeed = ethers.id('agent seed')
    await token.connect(agent).setPrivateEventSeed(agentSeed)
    await token.connect(addr1).setPrivateEventSeed(ethers.id('holder seed'))
    const spenderSeed = ethers.id('spender seed')
    await token.connect(addr2).setPrivateEventSeed(spenderSeed)
    await mockCompliance.setCanTransfer(addr1Address, true)
    await mockIdentityRegistry.registerIdentity(addr2Address, 1, true)
    await mockIdentityRegistry.setVerified(addr2Address, true)
    await token.connect(agent).mint(addr1Address, AMOUNT)
    await token.connect(addr1).approve(addr2Address, AMOUNT)

    const receipt = await (await token.connect(addr2).transferFrom(addr1Address, addr2Address, AMOUNT)).wait()

    const state = stateOf(addr2Address, spenderSeed)
    const approvals = payloadsOf(token, receipt, EVENT_TYPE_APPROVAL)
    const transfers = payloadsOf(token, receipt, EVENT_TYPE_TRANSFER)
    expect(approvals).to.deep.equal([
      concat([coder.encode(['address', 'address', 'uint256'], [addr1Address, addr2Address, 0n]), saltOf(state)]),
    ])
    expect(transfers).to.deep.equal([
      concat([
        coder.encode(['address', 'address', 'uint256'], [addr1Address, addr2Address, AMOUNT]),
        saltOf(nextState(state)),
      ]),
    ])
    expect(saltOfPayload(approvals[0])).to.not.equal(ZeroHash)
  })
})

import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Signer, TransactionReceipt, ZeroHash, concat } from 'ethers'
import { UCEF3643 } from '@appliedblockchain/ucef-3643'
import MockTokenImplementation from '@appliedblockchain/ucef-3643/artifacts/contracts/mocks/MockNewTokenImplementation.sol/MockNewTokenImplementation.json'
import { MockCompliance, MockIdentityRegistry, MockTrexImplementationAuthority } from '../typechain-types'
import { deployToken3643 } from './fixtures/deploy-3643'
import {
  EVENT_TYPE_APPROVAL,
  EVENT_TYPE_TRANSFER,
  nextState,
  privateEventPayloads as payloadsOf,
  saltOf,
  sharedStateAfterSeed,
  userStateAfterSeed,
} from './fixtures/private-event'

describe('UCEF3643 private event seeds', function () {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const AMOUNT = ethers.parseEther('100')
  const CONTRACT_SEED = ethers.id('contract seed')

  let token: UCEF3643
  let tokenAddress: string
  let trexIAuthority: MockTrexImplementationAuthority
  let mockIdentityRegistry: MockIdentityRegistry
  let mockCompliance: MockCompliance
  let owner: Signer
  let agent: Signer
  let addr1: Signer
  let addr2: Signer
  let addr1Address: string
  let addr2Address: string
  let agentAddress: string
  // Shared state the next private event of `token` is salted from
  let sharedState: string

  function mintPayload(to: string, value: bigint) {
    return coder.encode(['address', 'address', 'uint256'], [ethers.ZeroAddress, to, value])
  }

  function privateEventPayloads(receipt: TransactionReceipt | null) {
    return payloadsOf(token, receipt, EVENT_TYPE_TRANSFER)
  }

  async function mint() {
    return privateEventPayloads(await (await token.connect(agent).mint(addr1Address, AMOUNT)).wait())
  }

  async function deploy(contractSeed: string | null) {
    const deployed = await deployToken3643({
      agent,
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18,
      onchainID: ethers.ZeroAddress,
      contractSeed,
    })
    token = deployed.token
    tokenAddress = await token.getAddress()
    trexIAuthority = deployed.trexIAuthority
    mockIdentityRegistry = deployed.mockIdentityRegistry
    mockCompliance = deployed.mockCompliance

    await mockIdentityRegistry.registerIdentity(addr1Address, 1, true)
    await mockIdentityRegistry.setVerified(addr1Address, true)
  }

  beforeEach(async function () {
    ;[owner, addr1, addr2, agent] = await ethers.getSigners()
    addr1Address = await addr1.getAddress()
    addr2Address = await addr2.getAddress()
    agentAddress = await agent.getAddress()

    await deploy(CONTRACT_SEED)
    sharedState = sharedStateAfterSeed(tokenAddress, CONTRACT_SEED)
  })

  describe('contract seed', function () {
    it('reverts private events until the owner sets the contract seed', async function () {
      await deploy(null)

      await expect(token.connect(agent).mint(addr1Address, AMOUNT)).to.be.revertedWithCustomError(
        token,
        'PrivateEventContractSeedNotSet',
      )

      await token.setPrivateEventContractSeed(CONTRACT_SEED)
      expect(await mint()).to.deep.equal([
        concat([
          mintPayload(addr1Address, AMOUNT),
          saltOf(ZeroHash, sharedStateAfterSeed(tokenAddress, CONTRACT_SEED)),
        ]),
      ])
    })

    it('only lets the owner set the contract seed, and rejects a zero seed', async function () {
      await expect(token.connect(agent).setPrivateEventContractSeed(CONTRACT_SEED)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
      await expect(token.setPrivateEventContractSeed(ZeroHash)).to.be.revertedWithCustomError(
        token,
        'PrivateEventZeroSeed',
      )
    })

    it('mixes a new contract seed into the shared state', async function () {
      await mint()
      const seed = ethers.id('new contract seed')
      await token.setPrivateEventContractSeed(seed)

      expect(await mint()).to.deep.equal([
        concat([
          mintPayload(addr1Address, AMOUNT),
          saltOf(ZeroHash, sharedStateAfterSeed(tokenAddress, seed, nextState(sharedState))),
        ]),
      ])
    })
  })

  describe('salting', function () {
    it('salts the events of a sender without a seed from the ratcheted shared state', async function () {
      expect(await token.connect(agent).hasPrivateEventSeed()).to.equal(false)

      const first = await mint()
      const second = await mint()

      expect(first).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(ZeroHash, sharedState)])])
      expect(second).to.deep.equal([
        concat([mintPayload(addr1Address, AMOUNT), saltOf(ZeroHash, nextState(sharedState))]),
      ])
    })

    it('mixes the ratcheted state of a sender with a seed into its salts', async function () {
      const seed = ethers.id('agent seed')
      await token.connect(agent).setPrivateEventSeed(seed)
      expect(await token.connect(agent).hasPrivateEventSeed()).to.equal(true)
      expect(await token.connect(addr1).hasPrivateEventSeed()).to.equal(false)

      const first = await mint()
      const second = await mint()

      const userState = userStateAfterSeed(tokenAddress, agentAddress, seed)
      expect(first).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(userState, sharedState)])])
      expect(second).to.deep.equal([
        concat([mintPayload(addr1Address, AMOUNT), saltOf(nextState(userState), nextState(sharedState))]),
      ])
    })

    it('rejects a zero user seed', async function () {
      await expect(token.connect(agent).setPrivateEventSeed(ZeroHash)).to.be.revertedWithCustomError(
        token,
        'PrivateEventZeroSeed',
      )
    })

    it('keeps the states across implementation upgrades', async function () {
      const seed = ethers.id('agent seed')
      await token.connect(agent).setPrivateEventSeed(seed)
      await mint()

      const newTokenFactory = await ethers.getContractFactory(
        MockTokenImplementation.abi,
        MockTokenImplementation.bytecode,
      )
      const newImplementation = await newTokenFactory.deploy()
      await newImplementation.waitForDeployment()
      await trexIAuthority.updateTokenImplementation(await newImplementation.getAddress())

      const userState = userStateAfterSeed(tokenAddress, agentAddress, seed)
      expect(await mint()).to.deep.equal([
        concat([mintPayload(addr1Address, AMOUNT), saltOf(nextState(userState), nextState(sharedState))]),
      ])
    })

    it('salts the Approval and Transfer events of transferFrom with distinct salts of the spender', async function () {
      await token.connect(addr1).setPrivateEventSeed(ethers.id('holder seed'))
      const spenderSeed = ethers.id('spender seed')
      await token.connect(addr2).setPrivateEventSeed(spenderSeed)
      await mockCompliance.setCanTransfer(addr1Address, true)
      await mockIdentityRegistry.registerIdentity(addr2Address, 1, true)
      await mockIdentityRegistry.setVerified(addr2Address, true)
      await mint()
      await token.connect(addr1).approve(addr2Address, AMOUNT)

      const receipt = await (await token.connect(addr2).transferFrom(addr1Address, addr2Address, AMOUNT)).wait()

      // The mint and the approval used the first two shared states
      const shared = nextState(nextState(sharedState))
      const userState = userStateAfterSeed(tokenAddress, addr2Address, spenderSeed)
      expect(payloadsOf(token, receipt, EVENT_TYPE_APPROVAL)).to.deep.equal([
        concat([
          coder.encode(['address', 'address', 'uint256'], [addr1Address, addr2Address, 0n]),
          saltOf(userState, shared),
        ]),
      ])
      expect(payloadsOf(token, receipt, EVENT_TYPE_TRANSFER)).to.deep.equal([
        concat([
          coder.encode(['address', 'address', 'uint256'], [addr1Address, addr2Address, AMOUNT]),
          saltOf(nextState(userState), nextState(shared)),
        ]),
      ])
    })
  })

  describe('oracle seed', function () {
    const ORACLE_SEED = ethers.id('oracle seed')

    it('only lets the owner set the oracle', async function () {
      await expect(token.connect(agent).setPrivateEventOracle(addr2Address)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      )
      await expect(token.setPrivateEventOracle(addr2Address))
        .to.emit(token, 'PrivateEventOracleUpdated')
        .withArgs(ethers.ZeroAddress, addr2Address)
      expect(await token.privateEventOracle()).to.equal(addr2Address)
    })

    it('only lets the oracle mix its seed into the shared state', async function () {
      await token.setPrivateEventOracle(addr2Address)

      await expect(token.connect(owner).updatePrivateEventOracleSeed(ORACLE_SEED))
        .to.be.revertedWithCustomError(token, 'PrivateEventUnauthorizedOracle')
        .withArgs(await owner.getAddress())
      await expect(token.connect(addr2).updatePrivateEventOracleSeed(ZeroHash)).to.be.revertedWithCustomError(
        token,
        'PrivateEventZeroSeed',
      )

      const receipt = await (await token.connect(addr2).updatePrivateEventOracleSeed(ORACLE_SEED)).wait()
      expect(receipt!.logs).to.have.length(0)
      expect(await mint()).to.deep.equal([
        concat([
          mintPayload(addr1Address, AMOUNT),
          saltOf(ZeroHash, sharedStateAfterSeed(tokenAddress, ORACLE_SEED, sharedState)),
        ]),
      ])
    })
  })
})

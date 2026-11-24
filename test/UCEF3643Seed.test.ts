import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Log, Signer, TransactionReceipt, ZeroHash, concat, keccak256, toUtf8Bytes } from 'ethers'
import { UCEF3643 } from '@appliedblockchain/ucef-3643'
import MockTokenImplementation from '@appliedblockchain/ucef-3643/artifacts/contracts/mocks/MockNewTokenImplementation.sol/MockNewTokenImplementation.json'
import { MockTrexImplementationAuthority } from '../typechain-types'
import { deployToken3643 } from './fixtures/deploy-3643'
import { EVENT_TYPE_TRANSFER } from './fixtures/private-event'

describe('UCEF3643 private event seed', function () {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const AMOUNT = ethers.parseEther('100')

  let token: UCEF3643
  let trexIAuthority: MockTrexImplementationAuthority
  let agent: Signer
  let addr1: Signer
  let addr1Address: string

  const saltOf = (seed: string) => keccak256(concat([seed, toUtf8Bytes('salt')]))
  const nextSeed = (seed: string) => keccak256(concat([seed, toUtf8Bytes('next')]))

  function mintPayload(to: string, value: bigint) {
    return coder.encode(['address', 'address', 'uint256'], [ethers.ZeroAddress, to, value])
  }

  function privateEventPayloads(receipt: TransactionReceipt | null) {
    return receipt!.logs
      .map((log: Log) => token.interface.parseLog(log))
      .filter((parsed) => parsed?.name === 'PrivateEvent' && parsed.args.eventType === EVENT_TYPE_TRANSFER)
      .map((parsed) => parsed!.args.payload as string)
  }

  beforeEach(async function () {
    ;[, addr1, , agent] = await ethers.getSigners()
    addr1Address = await addr1.getAddress()

    const deployed = await deployToken3643({
      agent,
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18,
      onchainID: ethers.ZeroAddress,
      setSeeds: false,
    })
    token = deployed.token
    trexIAuthority = deployed.trexIAuthority

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

    expect(first).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(seed)])])
    expect(second).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(nextSeed(seed))])])
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
    expect(payloads).to.deep.equal([concat([mintPayload(addr1Address, AMOUNT), saltOf(nextSeed(seed))])])
  })
})

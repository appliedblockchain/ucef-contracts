import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BaseContract, ContractTransactionResponse, Signer, TransactionReceipt, ZeroAddress, ZeroHash } from 'ethers'
import {
  MockERC1363,
  MockERC1363Receiver,
  MockFlashBorrower,
  MockUCEFFlashMint,
  MockUCEFVault,
  MockUCEFVotes,
  MockUCEFWrapper,
  UCEFOnlyOwner,
  XUCEF,
} from '../../typechain-types'
import {
  EVENT_TYPE_TRANSFER,
  nextState,
  privateEventPayloads,
  randomSeed,
  ratchet,
  saltOf,
  saltOfPayload,
  sharedStateAfterSeed,
  userStateAfterSeed,
} from '../fixtures/private-event'

/**
 * Checks that every private event the extensions emit is salted from the shared state of the token and
 * the user state of the event's msg.sender, including events triggered by contracts that move tokens for
 * other accounts (vaults, wrappers, bridges, flash borrowers)
 */
describe('Private event salts in extensions', function () {
  const AMOUNT = 100n

  let owner: Signer
  let user: Signer
  let other: Signer
  let ownerAddress: string
  let userAddress: string

  /**
   * Shared state of a token, advanced past the private events of every receipt it is shown
   */
  type Tracked = { token: BaseContract; address: string; state: string }

  // Deploys a UCEF token with a random contract seed and no oracle, and tracks its shared state
  async function deploy<T extends BaseContract>(name: string, args: unknown[] = []) {
    const contractSeed = randomSeed()
    const token = await deployContract<T>(name, [...args, contractSeed, ZeroAddress])
    const address = await token.getAddress()
    const tracked: Tracked = { token, address, state: sharedStateAfterSeed(address, contractSeed) }
    advance(tracked, await token.deploymentTransaction()!.wait())
    return { token, tracked }
  }

  async function deployContract<T extends BaseContract>(name: string, args: unknown[] = []) {
    const factory = await ethers.getContractFactory(name)
    const contract = await factory.deploy(...args)
    await contract.waitForDeployment()
    return contract as unknown as T
  }

  function advance(tracked: Tracked, receipt: TransactionReceipt | null) {
    tracked.state = ratchet(tracked.state, privateEventPayloads(tracked.token, receipt).length)
  }

  // Sends `tx` and advances the shared state of every tracked token past its events
  async function send(tx: Promise<ContractTransactionResponse>, ...tracked: Tracked[]) {
    const receipt = await (await tx).wait()
    tracked.forEach((t) => advance(t, receipt))
    return receipt
  }

  // Salts of the private events of `tracked` in `receipt`, in the order they were emitted
  function saltsOf(tracked: Tracked, receipt: TransactionReceipt | null, eventType?: string) {
    return privateEventPayloads(tracked.token, receipt, eventType).map(saltOfPayload)
  }

  // Salts of `count` consecutive events by one sender with `userState` (zero for none), from `sharedState`
  function chain(userState: string, sharedState: string, count: number) {
    const salts: string[] = []
    for (let i = 0; i < count; i++) {
      salts.push(saltOf(userState, sharedState))
      userState = userState === ZeroHash ? ZeroHash : nextState(userState)
      sharedState = nextState(sharedState)
    }
    return salts
  }

  async function setSeed(tracked: Tracked, signer: Signer, seed: string) {
    const token = tracked.token as unknown as UCEFOnlyOwner
    await send(token.connect(signer).setPrivateEventSeed(seed), tracked)
    return userStateAfterSeed(tracked.address, await signer.getAddress(), seed)
  }

  beforeEach(async function () {
    ;[owner, user, other] = await ethers.getSigners()
    ownerAddress = await owner.getAddress()
    userAddress = await user.getAddress()
  })

  describe('ERC4626 vault', function () {
    let asset: UCEFOnlyOwner
    let vault: MockUCEFVault
    let assetTracked: Tracked
    let vaultTracked: Tracked

    beforeEach(async function () {
      ;({ token: asset, tracked: assetTracked } = await deploy<UCEFOnlyOwner>('UCEFOnlyOwner'))
      ;({ token: vault, tracked: vaultTracked } = await deploy<MockUCEFVault>('MockUCEFVault', [assetTracked.address]))
      await send(asset.mint(userAddress, 1000n), assetTracked)
      await send(asset.connect(user).approve(vaultTracked.address, AMOUNT), assetTracked)
    })

    it('salts the asset transfers sent by the vault and the vault events of a user without seeds', async function () {
      const [assetState, vaultState] = [assetTracked.state, vaultTracked.state]
      const deposit = await send(vault.connect(user).deposit(AMOUNT, userAddress), assetTracked, vaultTracked)
      const redeem = await send(
        vault.connect(user).redeem(AMOUNT, userAddress, userAddress),
        assetTracked,
        vaultTracked,
      )

      // The vault has no seed on the asset: its transfers are salted from the asset's shared state only
      expect([...saltsOf(assetTracked, deposit), ...saltsOf(assetTracked, redeem)]).to.deep.equal(
        chain(ZeroHash, assetState, 2),
      )
      // Transfer (mint of shares) and Deposit, then Transfer (burn) and Withdraw
      expect([...saltsOf(vaultTracked, deposit), ...saltsOf(vaultTracked, redeem)]).to.deep.equal(
        chain(ZeroHash, vaultState, 4),
      )
    })

    it("mixes the user's seed on the vault into the vault events", async function () {
      const userState = await setSeed(vaultTracked, user, ethers.id('user seed'))
      const vaultState = vaultTracked.state

      const deposit = await send(vault.connect(user).deposit(AMOUNT, userAddress), assetTracked, vaultTracked)

      expect(saltsOf(vaultTracked, deposit)).to.deep.equal(chain(userState, vaultState, 2))
    })
  })

  describe('UCEFWrapper', function () {
    it('salts the underlying transfers sent by the wrapper and the wrapped mints and burns', async function () {
      const { token: underlying, tracked: underlyingTracked } = await deploy<UCEFOnlyOwner>('UCEFOnlyOwner')
      const { token: wrapper, tracked: wrapperTracked } = await deploy<MockUCEFWrapper>('MockUCEFWrapper', [
        underlyingTracked.address,
      ])
      await send(underlying.mint(userAddress, 1000n), underlyingTracked)
      await send(underlying.connect(user).approve(wrapperTracked.address, AMOUNT), underlyingTracked)
      const userState = await setSeed(wrapperTracked, user, ethers.id('user seed'))
      const [underlyingState, wrapperState] = [underlyingTracked.state, wrapperTracked.state]

      const deposit = await send(
        wrapper.connect(user).depositFor(userAddress, AMOUNT),
        underlyingTracked,
        wrapperTracked,
      )
      const withdraw = await send(
        wrapper.connect(user).withdrawTo(userAddress, AMOUNT),
        underlyingTracked,
        wrapperTracked,
      )

      // The underlying transferFrom is sent by the wrapper, which has no seed; the withdrawal transfer too
      expect([
        ...saltsOf(underlyingTracked, deposit, EVENT_TYPE_TRANSFER),
        ...saltsOf(underlyingTracked, withdraw, EVENT_TYPE_TRANSFER),
      ]).to.deep.equal(chain(ZeroHash, underlyingState, 2))
      expect([...saltsOf(wrapperTracked, deposit), ...saltsOf(wrapperTracked, withdraw)]).to.deep.equal(
        chain(userState, wrapperState, 2),
      )
    })
  })

  describe('UCEFVotes', function () {
    it('salts the Transfer and both DelegateVotesChanged events of a delegated transfer with distinct salts', async function () {
      const { token, tracked } = await deploy<MockUCEFVotes>('MockUCEFVotes')
      await send(token.mint(userAddress, 1000n), tracked)
      await send(token.connect(other).delegate(await other.getAddress()), tracked)
      let userState = await setSeed(tracked, user, ethers.id('user seed'))
      const delegation = await send(token.connect(user).delegate(userAddress), tracked)
      userState = ratchet(userState, privateEventPayloads(token, delegation).length)
      const sharedState = tracked.state

      const receipt = await send(token.connect(user).transfer(await other.getAddress(), AMOUNT), tracked)

      const salts = saltsOf(tracked, receipt)
      expect(salts).to.have.length(3)
      expect(salts).to.deep.equal(chain(userState, sharedState, 3))
    })
  })

  describe('UCEFFlashMint', function () {
    it('salts every event of a flash loan from the sender of each event', async function () {
      const { token, tracked } = await deploy<MockUCEFFlashMint>('MockUCEFFlashMint')
      const borrower = await deployContract<MockFlashBorrower>('MockFlashBorrower', [true])
      const userState = await setSeed(tracked, user, ethers.id('user seed'))
      const sharedState = tracked.state

      const receipt = await send(
        token.connect(user).flashLoan(await borrower.getAddress(), tracked.address, AMOUNT, '0x'),
        tracked,
      )

      // The mint and the burn are sent by the user; the repayment approval by the borrower, which has no seed
      expect(saltsOf(tracked, receipt)).to.deep.equal([
        saltOf(userState, sharedState),
        saltOf(ZeroHash, nextState(sharedState)),
        saltOf(nextState(userState), nextState(nextState(sharedState))),
      ])
    })

    it('still requires the borrower to approve the repayment', async function () {
      const { token, tracked } = await deploy<MockUCEFFlashMint>('MockUCEFFlashMint')
      const borrower = await deployContract<MockFlashBorrower>('MockFlashBorrower', [false])

      await expect(
        token.connect(user).flashLoan(await borrower.getAddress(), tracked.address, AMOUNT, '0x'),
      ).to.be.revertedWithCustomError(token, 'ERC20InsufficientAllowance')
    })
  })

  describe('ERC1363', function () {
    let token: MockERC1363
    let tracked: Tracked
    let receiverAddress: string

    beforeEach(async function () {
      ;({ token, tracked } = await deploy<MockERC1363>('MockERC1363'))
      const receiver = await deployContract<MockERC1363Receiver>('MockERC1363Receiver')
      receiverAddress = await receiver.getAddress()
      await send(token.mint(userAddress, 1000n), tracked)
    })

    it('salts transferAndCall and approveAndCall', async function () {
      const userState = await setSeed(tracked, user, ethers.id('user seed'))
      const sharedState = tracked.state

      const transfer = await send(
        token.connect(user)['transferAndCall(address,uint256)'](receiverAddress, AMOUNT),
        tracked,
      )
      const approve = await send(
        token.connect(user)['approveAndCall(address,uint256)'](receiverAddress, AMOUNT),
        tracked,
      )

      expect([...saltsOf(tracked, transfer), ...saltsOf(tracked, approve)]).to.deep.equal(
        chain(userState, sharedState, 2),
      )
    })

    it('salts transferFromAndCall from the spender', async function () {
      await send(token.connect(user).approve(ownerAddress, AMOUNT), tracked)
      const ownerState = await setSeed(tracked, owner, ethers.id('owner seed'))
      const sharedState = tracked.state

      const receipt = await send(
        token.connect(owner)['transferFromAndCall(address,address,uint256)'](userAddress, receiverAddress, AMOUNT),
        tracked,
      )

      // Spending an allowance emits no Approval
      expect(saltsOf(tracked, receipt)).to.deep.equal(chain(ownerState, sharedState, 1))
    })
  })

  describe('XUCEF', function () {
    let token: XUCEF
    let tracked: Tracked

    beforeEach(async function () {
      // The owner (factory) is `owner`; `other` is a bridge without a seed
      ;({ token, tracked } = await deploy<XUCEF>('XUCEF', ['XUCEF', 'xUCEF', 18, ownerAddress]))
      await send(token.setLimits(await other.getAddress(), 1000n, 1000n), tracked)
    })

    it('salts the mints of a bridge without a seed from the shared state', async function () {
      const sharedState = tracked.state

      const receipt = await send(token.connect(other).mint(userAddress, AMOUNT), tracked)

      expect(saltsOf(tracked, receipt)).to.deep.equal(chain(ZeroHash, sharedState, 1))
    })

    it('only lets the owner change the oracle', async function () {
      expect(await token.privateEventOracle()).to.equal(ZeroAddress)
      await expect(token.connect(user).setPrivateEventOracle(userAddress))
        .to.be.revertedWithCustomError(token, 'OwnableUnauthorizedAccount')
        .withArgs(userAddress)

      await expect(token.setPrivateEventOracle(userAddress))
        .to.emit(token, 'PrivateEventOracleUpdated')
        .withArgs(ZeroAddress, userAddress)
      await token.connect(user).updatePrivateEventOracleSeed(ethers.id('oracle seed'))
    })
  })
})

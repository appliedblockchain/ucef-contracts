import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BaseContract, Signer, TransactionReceipt, ZeroHash } from 'ethers'
import {
  MockERC1363,
  MockERC1363Receiver,
  MockFlashBorrower,
  MockSmartAccount,
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
  privateEventSeedState,
  saltOf,
  saltOfPayload,
} from '../fixtures/private-event'

/**
 * Checks that every private event the extensions emit is salted, including events emitted by contracts
 * that move tokens for other accounts (vaults, wrappers, bridges, flash borrowers)
 */
describe('Private event salts in extensions', function () {
  const AMOUNT = 100n

  let owner: Signer
  let user: Signer
  let bundler: Signer
  let ownerAddress: string
  let userAddress: string

  async function deploy<T>(name: string, args: unknown[] = []) {
    const factory = await ethers.getContractFactory(name)
    const contract = await factory.deploy(...args)
    await contract.waitForDeployment()
    return contract as unknown as T
  }

  async function addressOf(contract: BaseContract) {
    return contract.getAddress()
  }

  // Salts of the private events of `token` in a transaction, in the order they were emitted
  function saltsOf(token: BaseContract, receipt: TransactionReceipt | null, eventType?: string) {
    return privateEventPayloads(token, receipt, eventType).map(saltOfPayload)
  }

  // Salts of the next `count` events salted from `state`
  function chain(state: string, count: number) {
    const salts: string[] = []
    for (let i = 0; i < count; i++) {
      salts.push(saltOf(state))
      state = nextState(state)
    }
    return salts
  }

  async function setSeed(token: BaseContract, signer: Signer, seed: string) {
    const contract = token as unknown as UCEFOnlyOwner
    await (await contract.connect(signer).setPrivateEventSeed(seed)).wait()
    return privateEventSeedState(await addressOf(token), await signer.getAddress(), seed)
  }

  function encode(token: BaseContract, method: string, args: unknown[]) {
    return token.interface.encodeFunctionData(method, args)
  }

  beforeEach(async function () {
    // `bundler` never sets a seed: it stands for a relayer or ERC-4337 bundler sending the transaction
    ;[owner, user, bundler] = await ethers.getSigners()
    ownerAddress = await owner.getAddress()
    userAddress = await user.getAddress()
  })

  describe('ERC4626 vault deposits from a smart account', function () {
    const ASSET_SEED = ethers.id('vault asset seed')

    let asset: UCEFOnlyOwner
    let account: MockSmartAccount
    let accountAddress: string

    beforeEach(async function () {
      asset = await deploy<UCEFOnlyOwner>('UCEFOnlyOwner')
      await setSeed(asset, owner, ethers.id('owner seed'))
      account = await deploy<MockSmartAccount>('MockSmartAccount')
      accountAddress = await addressOf(account)
      await asset.mint(accountAddress, 1000n)
      // The account sets its own seed on the asset through a transaction sent by its owner
      await account
        .connect(user)
        .execute(await addressOf(asset), encode(asset, 'setPrivateEventSeed', [ethers.id('a')]))
    })

    async function deployVault(assetSeed: string) {
      const vault = await deploy<MockUCEFVault>('MockUCEFVault', [await addressOf(asset), assetSeed])
      await account
        .connect(user)
        .execute(await addressOf(vault), encode(vault, 'setPrivateEventSeed', [ethers.id('v')]))
      await account
        .connect(user)
        .execute(await addressOf(asset), encode(asset, 'approve', [await addressOf(vault), AMOUNT]))
      return vault
    }

    it('reverts when the vault has no seed on the asset and the bundler has none either', async function () {
      const vault = await deployVault(ZeroHash)

      await expect(
        account.connect(bundler).execute(await addressOf(vault), encode(vault, 'deposit', [AMOUNT, accountAddress])),
      )
        .to.be.revertedWithCustomError(asset, 'PrivateEventSeedNotSet')
        .withArgs(await addressOf(vault))
    })

    it('salts the asset transfers with the seed set in the vault constructor', async function () {
      const vault = await deployVault(ASSET_SEED)
      const vaultAddress = await addressOf(vault)
      const state = privateEventSeedState(await addressOf(asset), vaultAddress, ASSET_SEED)

      const deposit = await (
        await account.connect(bundler).execute(vaultAddress, encode(vault, 'deposit', [AMOUNT, accountAddress]))
      ).wait()
      const redeem = await (
        await account
          .connect(bundler)
          .execute(vaultAddress, encode(vault, 'redeem', [AMOUNT, accountAddress, accountAddress]))
      ).wait()

      const [first, second] = chain(state, 2)
      expect(saltsOf(asset, deposit, EVENT_TYPE_TRANSFER)).to.deep.equal([first])
      expect(saltsOf(asset, redeem, EVENT_TYPE_TRANSFER)).to.deep.equal([second])
    })

    it("salts the vault's own events with the account's seed on the vault", async function () {
      const vault = await deployVault(ASSET_SEED)
      const vaultAddress = await addressOf(vault)
      // setPrivateEventSeed(id('v')) was the account's first seed on the vault
      const state = privateEventSeedState(vaultAddress, accountAddress, ethers.id('v'))

      const receipt = await (
        await account.connect(bundler).execute(vaultAddress, encode(vault, 'deposit', [AMOUNT, accountAddress]))
      ).wait()

      // Transfer (mint of shares) and Deposit
      expect(saltsOf(vault, receipt)).to.deep.equal(chain(state, 2))
    })
  })

  describe('UCEFWrapper', function () {
    const UNDERLYING_SEED = ethers.id('wrapper underlying seed')

    let underlying: UCEFOnlyOwner
    let account: MockSmartAccount
    let accountAddress: string

    beforeEach(async function () {
      underlying = await deploy<UCEFOnlyOwner>('UCEFOnlyOwner')
      await setSeed(underlying, owner, ethers.id('owner seed'))
      account = await deploy<MockSmartAccount>('MockSmartAccount')
      accountAddress = await addressOf(account)
      await underlying.mint(accountAddress, 1000n)
      await account
        .connect(user)
        .execute(await addressOf(underlying), encode(underlying, 'setPrivateEventSeed', [ethers.id('a')]))
    })

    async function deployWrapper(underlyingSeed: string) {
      const wrapper = await deploy<MockUCEFWrapper>('MockUCEFWrapper', [await addressOf(underlying), underlyingSeed])
      await account
        .connect(user)
        .execute(await addressOf(wrapper), encode(wrapper, 'setPrivateEventSeed', [ethers.id('w')]))
      await account
        .connect(user)
        .execute(await addressOf(underlying), encode(underlying, 'approve', [await addressOf(wrapper), AMOUNT]))
      return wrapper
    }

    it('reverts when the wrapper has no seed on the underlying token and the bundler has none either', async function () {
      const wrapper = await deployWrapper(ZeroHash)

      await expect(
        account
          .connect(bundler)
          .execute(await addressOf(wrapper), encode(wrapper, 'depositFor', [accountAddress, AMOUNT])),
      )
        .to.be.revertedWithCustomError(underlying, 'PrivateEventSeedNotSet')
        .withArgs(await addressOf(wrapper))
    })

    it('salts the underlying transfers with the seed set in the wrapper constructor', async function () {
      const wrapper = await deployWrapper(UNDERLYING_SEED)
      const wrapperAddress = await addressOf(wrapper)
      const state = privateEventSeedState(await addressOf(underlying), wrapperAddress, UNDERLYING_SEED)

      const deposit = await (
        await account.connect(bundler).execute(wrapperAddress, encode(wrapper, 'depositFor', [accountAddress, AMOUNT]))
      ).wait()
      const withdraw = await (
        await account.connect(bundler).execute(wrapperAddress, encode(wrapper, 'withdrawTo', [accountAddress, AMOUNT]))
      ).wait()

      const [first, second] = chain(state, 2)
      expect(saltsOf(underlying, deposit, EVENT_TYPE_TRANSFER)).to.deep.equal([first])
      expect(saltsOf(underlying, withdraw, EVENT_TYPE_TRANSFER)).to.deep.equal([second])
      // Mint and burn of wrapped tokens, salted from the account's seed on the wrapper
      const wrapperState = privateEventSeedState(wrapperAddress, accountAddress, ethers.id('w'))
      expect([...saltsOf(wrapper, deposit), ...saltsOf(wrapper, withdraw)]).to.deep.equal(chain(wrapperState, 2))
    })
  })

  describe('UCEFVotes', function () {
    it('salts the Transfer and both DelegateVotesChanged events of a delegated transfer with distinct salts', async function () {
      const token = await deploy<MockUCEFVotes>('MockUCEFVotes')
      const [, , , recipient] = await ethers.getSigners()
      await setSeed(token, recipient, ethers.id('recipient seed'))
      await setSeed(token, owner, ethers.id('owner seed'))
      await token.mint(userAddress, 1000n)
      await token.connect(recipient).delegate(await recipient.getAddress())
      const state = await setSeed(token, user, ethers.id('user seed'))
      await token.connect(user).delegate(userAddress)

      const receipt = await (await token.connect(user).transfer(await recipient.getAddress(), AMOUNT)).wait()

      // delegate() emitted DelegateChanged and DelegateVotesChanged with the first two states;
      // Transfer and the two DelegateVotesChanged use the next three
      expect(saltsOf(token, receipt)).to.deep.equal(chain(nextState(nextState(state)), 3))
    })
  })

  describe('UCEFFlashMint', function () {
    it('salts every event of a flash loan, including those the borrower triggers', async function () {
      const token = await deploy<MockUCEFFlashMint>('MockUCEFFlashMint')
      const borrower = await deploy<MockFlashBorrower>('MockFlashBorrower', [true])
      const state = await setSeed(token, user, ethers.id('user seed'))

      const receipt = await (
        await token.connect(user).flashLoan(await addressOf(borrower), await addressOf(token), AMOUNT, '0x')
      ).wait()

      // The borrower has no seed, so the mint, its approval and the burn use the user's (tx.origin) seed
      expect(saltsOf(token, receipt)).to.deep.equal(chain(state, 3))
    })

    it('still requires the borrower to approve the repayment', async function () {
      const token = await deploy<MockUCEFFlashMint>('MockUCEFFlashMint')
      const borrower = await deploy<MockFlashBorrower>('MockFlashBorrower', [false])
      await setSeed(token, user, ethers.id('user seed'))

      await expect(
        token.connect(user).flashLoan(await addressOf(borrower), await addressOf(token), AMOUNT, '0x'),
      ).to.be.revertedWithCustomError(token, 'ERC20InsufficientAllowance')
    })
  })

  describe('ERC1363', function () {
    let token: MockERC1363
    let receiver: MockERC1363Receiver
    let receiverAddress: string
    let state: string

    beforeEach(async function () {
      token = await deploy<MockERC1363>('MockERC1363')
      receiver = await deploy<MockERC1363Receiver>('MockERC1363Receiver')
      receiverAddress = await addressOf(receiver)
      await setSeed(token, owner, ethers.id('owner seed'))
      await token.mint(userAddress, 1000n)
      state = await setSeed(token, user, ethers.id('user seed'))
    })

    it('salts transferAndCall and approveAndCall', async function () {
      const transfer = await (
        await token.connect(user)['transferAndCall(address,uint256)'](receiverAddress, AMOUNT)
      ).wait()
      const approve = await (
        await token.connect(user)['approveAndCall(address,uint256)'](receiverAddress, AMOUNT)
      ).wait()

      expect([...saltsOf(token, transfer), ...saltsOf(token, approve)]).to.deep.equal(chain(state, 2))
    })

    it('salts transferFromAndCall with the seed of the spender', async function () {
      await token.connect(user).approve(ownerAddress, AMOUNT)
      const ownerState = privateEventSeedState(await addressOf(token), ownerAddress, ethers.id('owner seed'))

      const receipt = await (
        await token.connect(owner)['transferFromAndCall(address,address,uint256)'](userAddress, receiverAddress, AMOUNT)
      ).wait()

      // The owner's mint in beforeEach used its first state. Spending an allowance emits no Approval
      expect(saltsOf(token, receipt)).to.deep.equal(chain(nextState(ownerState), 1))
    })
  })

  describe('XUCEF bridge seeds', function () {
    const BRIDGE_SEED = ethers.id('bridge seed')

    let token: XUCEF
    let tokenAddress: string
    let bridge: MockSmartAccount
    let bridgeAddress: string

    beforeEach(async function () {
      // The owner (factory) is `owner`; `bundler` relays the bridge's mints and has no seed
      token = await deploy<XUCEF>('XUCEF', ['XUCEF', 'xUCEF', 18, ownerAddress])
      tokenAddress = await addressOf(token)
      bridge = await deploy<MockSmartAccount>('MockSmartAccount')
      bridgeAddress = await addressOf(bridge)
      await token.setLimits(bridgeAddress, 1000n, 1000n)
    })

    const mintThroughBridge = () =>
      bridge.connect(bundler).execute(tokenAddress, encode(token, 'mint', [userAddress, AMOUNT]))

    it('reverts a relayed mint when the bridge has no seed', async function () {
      await expect(mintThroughBridge())
        .to.be.revertedWithCustomError(token, 'PrivateEventSeedNotSet')
        .withArgs(bridgeAddress)
    })

    it('salts relayed mints with the seed the owner registered for the bridge', async function () {
      await token.setBridgePrivateEventSeed(bridgeAddress, BRIDGE_SEED)

      const receipt = await (await mintThroughBridge()).wait()

      expect(saltsOf(token, receipt)).to.deep.equal([
        saltOf(privateEventSeedState(tokenAddress, bridgeAddress, BRIDGE_SEED)),
      ])
    })

    it('mixes the registered seed into a seed the bridge set itself', async function () {
      await bridge.execute(tokenAddress, encode(token, 'setPrivateEventSeed', [ethers.id('own seed')]))
      await token.setBridgePrivateEventSeed(bridgeAddress, BRIDGE_SEED)

      const receipt = await (await mintThroughBridge()).wait()

      const own = privateEventSeedState(tokenAddress, bridgeAddress, ethers.id('own seed'))
      expect(saltsOf(token, receipt)).to.deep.equal([
        saltOf(privateEventSeedState(tokenAddress, bridgeAddress, BRIDGE_SEED, own)),
      ])
    })

    it('lets the owner register a seed for the lockbox', async function () {
      await token.setLockbox(bridgeAddress)
      await token.setLimits(bridgeAddress, 0n, 0n)

      await expect(token.setBridgePrivateEventSeed(bridgeAddress, BRIDGE_SEED)).to.not.be.reverted
      await expect(mintThroughBridge()).to.not.be.reverted
    })

    it('only lets the owner register seeds, and only for bridges', async function () {
      await expect(token.connect(user).setBridgePrivateEventSeed(bridgeAddress, BRIDGE_SEED))
        .to.be.revertedWithCustomError(token, 'OwnableUnauthorizedAccount')
        .withArgs(userAddress)
      await expect(token.setBridgePrivateEventSeed(userAddress, BRIDGE_SEED))
        .to.be.revertedWithCustomError(token, 'XUCEF_NotBridge')
        .withArgs(userAddress)
      await expect(token.setBridgePrivateEventSeed(ethers.ZeroAddress, BRIDGE_SEED))
        .to.be.revertedWithCustomError(token, 'XUCEF_NotBridge')
        .withArgs(ethers.ZeroAddress)
      await expect(token.setBridgePrivateEventSeed(bridgeAddress, ZeroHash)).to.be.revertedWithCustomError(
        token,
        'PrivateEventZeroSeed',
      )
    })
  })
})

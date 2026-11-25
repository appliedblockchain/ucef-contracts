import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import { UCEFHiddenBalanceVaultMock, UCEFOnlyOwner, UCEFOwnedVaultMock } from '../../typechain-types'
import { deployToken } from '../fixtures/deploy-token'
import { randomSeed } from '../fixtures/private-event'

type Vault = UCEFOwnedVaultMock | UCEFHiddenBalanceVaultMock

const VAULTS: { name: string; contract: string; unauthorizedViewReverts: boolean }[] = [
  {
    name: 'vault whose balance reads revert for unauthorized callers',
    contract: 'UCEFOwnedVaultMock',
    unauthorizedViewReverts: true,
  },
  {
    name: 'vault whose balance reads return 0 for unauthorized callers',
    contract: 'UCEFHiddenBalanceVaultMock',
    unauthorizedViewReverts: false,
  },
]

describe('ERC4626', function () {
  const DEPOSIT = ethers.parseUnits('100', 18)
  const AMOUNT = ethers.parseUnits('40', 18)

  for (const { name, contract, unauthorizedViewReverts } of VAULTS) {
    describe(name, function () {
      let asset: UCEFOnlyOwner
      let vault: Vault
      let holder: Signer
      let spender: Signer
      let receiver: Signer
      let other: Signer
      let holderAddress: string
      let spenderAddress: string
      let receiverAddress: string
      let otherAddress: string

      beforeEach(async function () {
        ;[, holder, spender, receiver, other] = await ethers.getSigners()
        holderAddress = await holder.getAddress()
        spenderAddress = await spender.getAddress()
        receiverAddress = await receiver.getAddress()
        otherAddress = await other.getAddress()

        asset = await deployToken<UCEFOnlyOwner>('UCEFOnlyOwner')
        const VaultFactory = await ethers.getContractFactory(contract)
        vault = (await VaultFactory.deploy(
          await asset.getAddress(),
          randomSeed(),
          ethers.ZeroAddress,
        )) as unknown as Vault
        await vault.waitForDeployment()

        await asset.mint(holderAddress, DEPOSIT)
        await asset.connect(holder).approve(await vault.getAddress(), DEPOSIT)
        await vault.connect(holder).deposit(DEPOSIT, holderAddress)
      })

      describe('maxWithdraw and maxRedeem', function () {
        it('return the limits to the holder', async function () {
          expect(await vault.connect(holder).maxWithdraw(holderAddress)).to.equal(DEPOSIT)
          expect(await vault.connect(holder).maxRedeem(holderAddress)).to.equal(DEPOSIT)
        })

        it('do not return the limits to an approved spender', async function () {
          await vault.connect(holder).approve(spenderAddress, AMOUNT)

          if (unauthorizedViewReverts) {
            await expect(vault.connect(spender).maxWithdraw(holderAddress))
              .to.be.revertedWithCustomError(vault, 'UCEFUnauthorizedBalanceAccess')
              .withArgs(spenderAddress, holderAddress)
            await expect(vault.connect(spender).maxRedeem(holderAddress))
              .to.be.revertedWithCustomError(vault, 'UCEFUnauthorizedBalanceAccess')
              .withArgs(spenderAddress, holderAddress)
          } else {
            expect(await vault.connect(spender).maxWithdraw(holderAddress)).to.equal(0n)
            expect(await vault.connect(spender).maxRedeem(holderAddress)).to.equal(0n)
          }
        })
      })

      describe('withdraw and redeem by the holder', function () {
        it('withdraws assets', async function () {
          await vault.connect(holder).withdraw(AMOUNT, receiverAddress, holderAddress)

          expect(await vault.connect(holder).balanceOf(holderAddress)).to.equal(DEPOSIT - AMOUNT)
          expect(await asset.connect(receiver).balanceOf(receiverAddress)).to.equal(AMOUNT)
        })

        it('redeems shares', async function () {
          await vault.connect(holder).redeem(AMOUNT, receiverAddress, holderAddress)

          expect(await vault.connect(holder).balanceOf(holderAddress)).to.equal(DEPOSIT - AMOUNT)
          expect(await asset.connect(receiver).balanceOf(receiverAddress)).to.equal(AMOUNT)
        })

        it('reverts without the limit when withdrawing more than the holder has', async function () {
          await expect(vault.connect(holder).withdraw(DEPOSIT + 1n, receiverAddress, holderAddress))
            .to.be.revertedWithCustomError(vault, 'UCEFExceededMaxWithdraw')
            .withArgs(holderAddress, DEPOSIT + 1n)
        })

        it('reverts without the limit when redeeming more than the holder has', async function () {
          await expect(vault.connect(holder).redeem(DEPOSIT + 1n, receiverAddress, holderAddress))
            .to.be.revertedWithCustomError(vault, 'UCEFExceededMaxRedeem')
            .withArgs(holderAddress, DEPOSIT + 1n)
        })
      })

      describe('withdraw and redeem by an approved spender', function () {
        beforeEach(async function () {
          await vault.connect(holder).approve(spenderAddress, AMOUNT)
        })

        it('withdraws assets on behalf of the holder', async function () {
          await vault.connect(spender).withdraw(AMOUNT, receiverAddress, holderAddress)

          expect(await vault.connect(holder).balanceOf(holderAddress)).to.equal(DEPOSIT - AMOUNT)
          expect(await vault.connect(spender).allowance(holderAddress, spenderAddress)).to.equal(0n)
          expect(await asset.connect(receiver).balanceOf(receiverAddress)).to.equal(AMOUNT)
        })

        it('redeems shares on behalf of the holder', async function () {
          await vault.connect(spender).redeem(AMOUNT, receiverAddress, holderAddress)

          expect(await vault.connect(holder).balanceOf(holderAddress)).to.equal(DEPOSIT - AMOUNT)
          expect(await vault.connect(spender).allowance(holderAddress, spenderAddress)).to.equal(0n)
          expect(await asset.connect(receiver).balanceOf(receiverAddress)).to.equal(AMOUNT)
        })

        it('reverts on insufficient allowance before checking the holder balance', async function () {
          // Both amounts exceed the allowance; only the second exceeds the holder balance.
          for (const amount of [AMOUNT + 1n, DEPOSIT + 1n]) {
            await expect(vault.connect(spender).withdraw(amount, receiverAddress, holderAddress))
              .to.be.revertedWithCustomError(vault, 'ERC20InsufficientAllowance')
              .withArgs(ethers.ZeroAddress, 0n, 0n)
            await expect(vault.connect(spender).redeem(amount, receiverAddress, holderAddress))
              .to.be.revertedWithCustomError(vault, 'ERC20InsufficientAllowance')
              .withArgs(ethers.ZeroAddress, 0n, 0n)
          }
        })

        it('reverts without the limit when the allowance exceeds the holder balance', async function () {
          await vault.connect(holder).approve(spenderAddress, ethers.MaxUint256)

          await expect(vault.connect(spender).withdraw(DEPOSIT + 1n, receiverAddress, holderAddress))
            .to.be.revertedWithCustomError(vault, 'UCEFExceededMaxWithdraw')
            .withArgs(holderAddress, DEPOSIT + 1n)
          await expect(vault.connect(spender).redeem(DEPOSIT + 1n, receiverAddress, holderAddress))
            .to.be.revertedWithCustomError(vault, 'UCEFExceededMaxRedeem')
            .withArgs(holderAddress, DEPOSIT + 1n)
        })
      })

      describe('withdraw and redeem by a caller without allowance', function () {
        it('reverts the same way whatever the holder balance', async function () {
          for (const amount of [1n, DEPOSIT + 1n]) {
            await expect(vault.connect(other).withdraw(amount, otherAddress, holderAddress))
              .to.be.revertedWithCustomError(vault, 'ERC20InsufficientAllowance')
              .withArgs(ethers.ZeroAddress, 0n, 0n)
            await expect(vault.connect(other).redeem(amount, otherAddress, holderAddress))
              .to.be.revertedWithCustomError(vault, 'ERC20InsufficientAllowance')
              .withArgs(ethers.ZeroAddress, 0n, 0n)
          }
        })
      })
    })
  }
})

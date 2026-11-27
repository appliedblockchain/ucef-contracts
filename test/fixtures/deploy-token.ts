import { BaseContract, ContractTransactionResponse, Signer, ZeroAddress } from 'ethers'
import { ethers } from 'hardhat'
import { randomSeed } from './private-event'

type DeployTokenOptions = {
  initialSupply?: bigint
  // Private event contract seed, random by default
  contractSeed?: string
  // Private event oracle, none by default
  oracle?: string
}

type TokenContract = BaseContract & {
  connect: (signer: Signer) => TokenContract
  mint?: (to: string, amount: bigint) => Promise<ContractTransactionResponse>
  transfer: (to: string, amount: bigint) => Promise<ContractTransactionResponse>
}

export async function deployToken<T extends TokenContract>(
  contractName: string,
  args: unknown[] = [],
  options: DeployTokenOptions = {},
) {
  const [owner] = await ethers.getSigners()

  const TokenFactory = await ethers.getContractFactory(contractName)
  // Every UCEF token takes the private event contract seed and oracle as its last constructor arguments
  const token = (await TokenFactory.deploy(
    ...args,
    options.contractSeed ?? randomSeed(),
    options.oracle ?? ZeroAddress,
  )) as unknown as T
  await token.waitForDeployment()

  if (options.initialSupply) {
    await mintTo(token, owner, options.initialSupply)
  }

  return token
}

export async function mintTo(token: TokenContract, to: Signer | string, amount: bigint) {
  if (!token.mint) {
    throw new Error('Token does not support minting')
  }

  const toAddress = typeof to === 'string' ? to : await to.getAddress()
  return token.mint(toAddress, amount)
}

export async function transfer(token: TokenContract, to: Signer | string, amount: bigint) {
  const toAddress = typeof to === 'string' ? to : await to.getAddress()
  return token.transfer(toAddress, amount)
}

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

export default buildModule('XUCEFModule', (m) => {
  const name = m.getParameter('name', 'XUCEF')
  const symbol = m.getParameter('symbol', 'XUCEF')
  const decimals = m.getParameter('decimals', 18)
  // Secret random private event contract seed: set it in a parameters file, never commit it
  const contractSeed = m.getParameter<string>('contractSeed')
  const oracle = m.getParameter('oracle', '0x0000000000000000000000000000000000000000')
  const deployer = m.getAccount(0)

  const xucef = m.contract('XUCEF', [name, symbol, decimals, deployer, contractSeed, oracle], {
    id: 'XUCEF',
  })

  return { xucef }
})

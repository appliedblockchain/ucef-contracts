import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

export default buildModule('UCEFOnlyOwnerModule', (m) => {
  // Secret random private event contract seed: set it in a parameters file, never commit it
  const contractSeed = m.getParameter<string>('contractSeed')
  const oracle = m.getParameter('oracle', '0x0000000000000000000000000000000000000000')

  const ucefOnlyOwner = m.contract('UCEFOnlyOwner', [contractSeed, oracle], {
    id: 'UCEFOnlyOwner',
  })

  return { ucefOnlyOwner }
})

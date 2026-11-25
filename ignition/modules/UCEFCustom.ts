import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'

export default buildModule('UCEFCustomModule', (m) => {
  // Secret random private event contract seed: set it in a parameters file, never commit it
  const contractSeed = m.getParameter<string>('contractSeed')
  const oracle = m.getParameter('oracle', '0x0000000000000000000000000000000000000000')

  const ucefCustom = m.contract('UCEFCustom', [contractSeed, oracle], {
    id: 'UCEFCustom',
  })

  return { ucefCustom }
})

import { CONTRACT, METHODS } from '../kb-contracts/index.js'
import { hash } from './io.js'

// Change these epochs for incompatible storage or engine semantics, even if
// the method names stay unchanged. A patch version/build ID is not an epoch.
export const SERVICE_COMPATIBILITY = Object.freeze({
  family: 'kb-original-files', protocolMajor: CONTRACT.protocolMajor,
  storageEpoch: 1, engineEpoch: 1, contractHash: hash(METHODS),
})

// Pre-handshake-descriptor releases are accepted only by verified full runtime
// fingerprints, not by a version range or self-reported semantic version.
// Public 2.5.3 and 2.5.4 TGZs share this exact contract and storage generation.
const legacyContract = Object.freeze({
  family: 'kb-original-files', protocolMajor: 1, storageEpoch: 1, engineEpoch: 1,
  contractHash: '5ea90bb705c1b1f47e856a1a35c7335f0f53286421b97c24b295aa46db7e93c8',
})
const LEGACY = Object.freeze({
  '2478adb900c3589b': legacyContract, // 2.5.3
  '11e75558a7826483': legacyContract, // 2.5.4
})

export function canShareRuntime(health, buildId, required = [], expected = SERVICE_COMPATIBILITY) {
  if (!Array.isArray(health?.supported) || !required.every(m => health.supported.includes(m))) return false
  if (health.serviceBuildId === buildId) return true
  const actual = health.compatibility ?? LEGACY[health.serviceBuildId]
  return Boolean(actual && Object.keys(SERVICE_COMPATIBILITY).every(key => actual[key] === expected[key] || key === 'contractHash' && expected[key] === SERVICE_COMPATIBILITY.contractHash && actual[key] === legacyContract.contractHash))
}

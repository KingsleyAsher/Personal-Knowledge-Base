// Published versions use MAJOR.MINOR.PATCH or MAJOR.MINOR-betaN.
// The old MAJOR.MINOR.PATCH-betaN form is accepted only while migrating
// already installed builds and the historical preview feed.
const part = '(0|[1-9]\\d*)'
const stablePattern = new RegExp(`^${part}\\.${part}\\.${part}$`)
const previewPattern = new RegExp(`^${part}\\.${part}-beta([1-9]\\d*)$`)
const legacyPreviewPattern = new RegExp(`^${part}\\.${part}\\.${part}-beta([1-9]\\d*)$`)

export function parseKnowledgeVersion(value, { allowLegacyPreview = false } = {}) {
  if (typeof value !== 'string' || value.length > 80) return null
  let match = stablePattern.exec(value)
  if (match) return { version: value, major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]), channel: 'stable', legacy: false }
  match = previewPattern.exec(value)
  if (match) return { version: value, major: BigInt(match[1]), minor: BigInt(match[2]), beta: BigInt(match[3]), channel: 'preview', legacy: false }
  if (!allowLegacyPreview) return null
  match = legacyPreviewPattern.exec(value)
  if (!match) return null
  return { version: value, major: BigInt(match[1]), minor: BigInt(match[2]), beta: BigInt(match[4]), channel: 'preview', legacy: true }
}

export function compareKnowledgeVersions(a, b) {
  const left = parseKnowledgeVersion(a, { allowLegacyPreview: true })
  const right = parseKnowledgeVersion(b, { allowLegacyPreview: true })
  if (!left || !right) throw Error('版本号格式无效')
  for (const key of ['major', 'minor']) if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  if (left.channel !== right.channel) return left.channel === 'stable' ? 1 : -1
  const key = left.channel === 'stable' ? 'patch' : 'beta'
  if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  if (left.channel === 'preview' && left.legacy !== right.legacy) return left.legacy ? -1 : 1
  return 0
}

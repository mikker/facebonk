import {
  hashProfileDocument,
  profileSummaryFromProfileDocument,
  verifyAssetBytes,
  verifyConnectBundle,
  verifyConsumerGrant,
  verifyProfileDocument
} from '../core/index.js'

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value
}

function normalizeStoredSession(input) {
  const session = assertObject(input, 'Stored Facebonk session is required')
  const profileDocument = assertObject(
    session.profileDocument,
    'Stored Facebonk profile document is required'
  )

  return {
    grant: normalizeText(session.grant),
    profileKey: normalizeText(session.profileKey),
    profileDocument,
    profileDocumentHash: normalizeText(session.profileDocumentHash).toLowerCase(),
    avatarAssetHash: normalizeText(session.avatarAssetHash).toLowerCase() || null,
    avatarDataUrl: normalizeText(session.avatarDataUrl) || null
  }
}

function avatarAssetFromProfileDocument(profileDocument) {
  return profileDocument?.payload?.avatar ?? null
}

function bufferFromValue(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  throw new Error('Avatar bytes must be a Buffer, Uint8Array, or ArrayBuffer')
}

function bytesToDataUrl(data, mimeType) {
  return `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`
}

function parseDataUrl(dataUrl) {
  const value = normalizeText(dataUrl)
  if (!value.startsWith('data:')) {
    throw new Error('Avatar data URL must use the data: scheme')
  }

  const comma = value.indexOf(',')
  if (comma === -1) {
    throw new Error('Avatar data URL is malformed')
  }

  const header = value.slice(5, comma)
  const body = value.slice(comma + 1)
  if (!header.includes(';base64')) {
    throw new Error('Avatar data URL must be base64 encoded')
  }

  const mimeType = header.split(';', 1)[0] || 'application/octet-stream'
  return {
    mimeType,
    data: Buffer.from(body, 'base64')
  }
}

async function loadAvatarDataUrl({
  asset,
  avatarUrl,
  currentAvatarDataUrl = null,
  fetchAvatarBytes
}) {
  if (!asset) return null

  if (currentAvatarDataUrl) {
    const current = parseDataUrl(currentAvatarDataUrl)
    if (verifyAssetBytes(asset, current.data)) {
      return currentAvatarDataUrl
    }
  }

  if (!avatarUrl) {
    throw new Error('Avatar transport URL is required for profile assets')
  }

  if (typeof fetchAvatarBytes !== 'function') {
    throw new Error('fetchAvatarBytes is required for profile assets')
  }

  const bytes = bufferFromValue(await fetchAvatarBytes(avatarUrl, asset))
  if (!verifyAssetBytes(asset, bytes)) {
    throw new Error('Avatar bytes did not match the signed asset reference')
  }

  return bytesToDataUrl(bytes, asset.mimeType || 'application/octet-stream')
}

function buildStoredSession({
  grant,
  profileDocument,
  avatarDataUrl = null
}) {
  const avatar = avatarAssetFromProfileDocument(profileDocument)

  return {
    grant,
    profileKey: profileDocument.payload.profileKey,
    profileDocument,
    profileDocumentHash: hashProfileDocument(profileDocument),
    avatarAssetHash: avatar?.hash ?? null,
    avatarDataUrl
  }
}

export function createInMemoryFacebonkSessionStore(initialValue = null) {
  let current = initialValue

  return {
    async load() {
      return current
    },
    async save(value) {
      current = value
    },
    async clear() {
      current = null
    }
  }
}

export async function restoreFacebonkSession(input, options = {}) {
  const session = normalizeStoredSession(input)
  const clientId = normalizeText(options.clientId)
  if (!clientId) throw new Error('Facebonk clientId is required')

  const grant = await verifyConsumerGrant(session.grant, {
    audience: clientId,
    now: options.now
  })
  const profileDocument = await verifyProfileDocument(session.profileDocument)
  const profileDocumentHash = hashProfileDocument(profileDocument)

  if (session.profileKey && session.profileKey !== profileDocument.payload.profileKey) {
    throw new Error('Stored Facebonk profile key did not match the profile document')
  }

  if (grant.payload.profileKey !== profileDocument.payload.profileKey) {
    throw new Error('Stored Facebonk grant profile key did not match the profile document')
  }

  if (session.profileDocumentHash !== profileDocumentHash) {
    throw new Error('Stored Facebonk profile document hash did not match the profile document')
  }

  const avatar = avatarAssetFromProfileDocument(profileDocument)
  const avatarAssetHash = avatar?.hash ?? null

  if (session.avatarAssetHash !== avatarAssetHash) {
    throw new Error('Stored Facebonk avatar hash did not match the profile document')
  }

  if (!avatar && session.avatarDataUrl) {
    throw new Error('Stored Facebonk avatar bytes were present without a signed asset reference')
  }

  if (avatar && session.avatarDataUrl) {
    const current = parseDataUrl(session.avatarDataUrl)
    if (!verifyAssetBytes(avatar, current.data)) {
      throw new Error('Stored Facebonk avatar bytes did not match the signed asset reference')
    }
  }

  return buildStoredSession({
    grant: session.grant,
    profileDocument,
    avatarDataUrl: session.avatarDataUrl
  })
}

export function profileFromFacebonkSession(input) {
  const session = normalizeStoredSession(input)
  const summary = profileSummaryFromProfileDocument(session.profileDocument)

  return {
    profileKey: summary.identityKey,
    displayName: summary.profile.displayName,
    bio: summary.profile.bio,
    avatarUrl: session.avatarDataUrl,
    updatedAt: summary.profile.updatedAt
  }
}

export async function connectFacebonkSession(payload, options = {}) {
  const clientId = normalizeText(options.clientId)
  if (!clientId) throw new Error('Facebonk clientId is required')

  const profileDocument = assertObject(
    payload?.profileDocument,
    'Facebonk profile document is required'
  )

  const verified = await verifyConnectBundle(
    {
      proof: payload?.proof,
      profileDocument
    },
    {
      audience: clientId,
      nonce: options.nonce,
      now: options.now
    }
  )

  const grant = await verifyConsumerGrant(payload?.grant, {
    audience: clientId,
    now: options.now
  })

  if (grant.payload.profileKey !== verified.profileDocument.payload.profileKey) {
    throw new Error('Facebonk grant profile key did not match the profile document')
  }

  const avatarDataUrl = await loadAvatarDataUrl({
    asset: avatarAssetFromProfileDocument(verified.profileDocument),
    avatarUrl: normalizeText(payload?.avatarUrl) || null,
    fetchAvatarBytes: options.fetchAvatarBytes
  })

  return buildStoredSession({
    grant: normalizeText(payload?.grant),
    profileDocument: verified.profileDocument,
    avatarDataUrl
  })
}

export async function refreshFacebonkSession(currentSession, payload, options = {}) {
  const session = await restoreFacebonkSession(currentSession, options)

  if (payload?.changed !== true) {
    return {
      changed: false,
      session
    }
  }

  const clientId = normalizeText(options.clientId)
  if (!clientId) throw new Error('Facebonk clientId is required')

  const profileDocument = await verifyProfileDocument(payload?.profileDocument)
  const grant = await verifyConsumerGrant(session.grant, {
    audience: clientId,
    now: options.now
  })

  if (grant.payload.profileKey !== profileDocument.payload.profileKey) {
    throw new Error('Facebonk grant profile key did not match the refreshed profile document')
  }

  const avatar = avatarAssetFromProfileDocument(profileDocument)
  const avatarDataUrl = await loadAvatarDataUrl({
    asset: avatar,
    avatarUrl: normalizeText(payload?.avatarUrl) || null,
    currentAvatarDataUrl:
      avatar?.hash && session.avatarAssetHash === avatar.hash ? session.avatarDataUrl : null,
    fetchAvatarBytes: options.fetchAvatarBytes
  })

  return {
    changed: true,
    session: buildStoredSession({
      grant: session.grant,
      profileDocument,
      avatarDataUrl
    })
  }
}

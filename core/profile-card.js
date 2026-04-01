import { webcrypto } from 'crypto'

const { subtle } = webcrypto

export const PROFILE_CARD_PREFIX = 'facebonk-profile:'
export const PROFILE_CARD_VERSION = 1

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4
  const suffix = padding === 0 ? '' : '='.repeat(4 - padding)
  return Buffer.from(normalized + suffix, 'base64')
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeAvatarDataUrl(value) {
  const dataUrl = normalizeText(value)
  return dataUrl.startsWith('data:') ? dataUrl : null
}

function inferAvatarMimeType(dataUrl) {
  if (typeof dataUrl !== 'string') return null
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl)
  return match?.[1] ?? null
}

function assertHexKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('Profile key must be a 32-byte hex public key')
  }
}

function canonicalPayload(input = {}) {
  const profileKey = normalizeText(input.profileKey).toLowerCase()
  assertHexKey(profileKey)

  const displayName = normalizeText(input.displayName)
  const bio = normalizeText(input.bio)
  const avatarDataUrl = normalizeAvatarDataUrl(input.avatarDataUrl)
  const avatarMimeType =
    normalizeText(input.avatarMimeType) || inferAvatarMimeType(avatarDataUrl)
  const updatedAt =
    typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
      ? Math.max(0, Math.floor(input.updatedAt))
      : Date.now()

  return {
    version: PROFILE_CARD_VERSION,
    profileKey,
    displayName: displayName || null,
    bio: bio || null,
    avatarDataUrl,
    avatarMimeType: avatarDataUrl ? avatarMimeType || null : null,
    updatedAt
  }
}

function payloadBytes(payload) {
  return Buffer.from(JSON.stringify(canonicalPayload(payload)))
}

async function importPublicKey(profileKey) {
  return await subtle.importKey(
    'raw',
    Buffer.from(profileKey, 'hex'),
    { name: 'Ed25519' },
    false,
    ['verify']
  )
}

async function importPrivateKey(pkcs8) {
  return await subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    true,
    ['sign']
  )
}

export async function createProfileCard(profile, signer) {
  const profileKey = normalizeText(signer?.profileKey).toLowerCase()
  const payload = canonicalPayload({
    ...profile,
    profileKey
  })
  const signature = await subtle.sign(
    { name: 'Ed25519' },
    signer.privateKey,
    payloadBytes(payload)
  )

  return {
    payload,
    signature: toBase64Url(signature)
  }
}

export function encodeProfileCard(card) {
  const payload = canonicalPayload(card?.payload)
  const signature = normalizeText(card?.signature)
  if (!signature) {
    throw new Error('Signed profile card is missing a signature')
  }

  return `${PROFILE_CARD_PREFIX}${toBase64Url(
    Buffer.from(JSON.stringify({ payload, signature }))
  )}`
}

export function decodeProfileCardToken(token) {
  const value = normalizeText(token)
  if (!value) {
    throw new Error('Signed profile token is required')
  }
  if (!value.startsWith(PROFILE_CARD_PREFIX)) {
    throw new Error('Not a Facebonk profile token')
  }

  let parsed
  try {
    parsed = JSON.parse(
      fromBase64Url(value.slice(PROFILE_CARD_PREFIX.length)).toString('utf8')
    )
  } catch {
    throw new Error('Invalid Facebonk profile token')
  }

  return {
    payload: canonicalPayload(parsed?.payload),
    signature: normalizeText(parsed?.signature)
  }
}

export async function verifyProfileCard(input) {
  const card =
    typeof input === 'string' ? decodeProfileCardToken(input) : input ?? {}
  const payload = canonicalPayload(card.payload)
  const signature = normalizeText(card.signature)

  if (!signature) {
    throw new Error('Signed profile card is missing a signature')
  }

  let signatureBytes
  try {
    signatureBytes = fromBase64Url(signature)
  } catch {
    throw new Error('Invalid Facebonk profile signature')
  }

  const publicKey = await importPublicKey(payload.profileKey)
  const verified = await subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    signatureBytes,
    payloadBytes(payload)
  )

  if (!verified) {
    throw new Error('Facebonk profile signature could not be verified')
  }

  return {
    payload,
    signature
  }
}

export async function createProfileSignerRecord() {
  const keyPair = await subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  )
  const rawPublicKey = await subtle.exportKey('raw', keyPair.publicKey)
  const pkcs8 = await subtle.exportKey('pkcs8', keyPair.privateKey)

  const record = {
    profileKey: Buffer.from(rawPublicKey).toString('hex'),
    privateKeyPkcs8: toBase64Url(pkcs8),
    createdAt: Date.now()
  }

  return {
    record,
    signer: {
      profileKey: record.profileKey,
      privateKey: keyPair.privateKey
    }
  }
}

export async function restoreProfileSigner(record = {}) {
  const profileKey = normalizeText(record.profileKey).toLowerCase()
  assertHexKey(profileKey)

  const privateKeyPkcs8 = normalizeText(record.privateKeyPkcs8)
  if (!privateKeyPkcs8) {
    throw new Error('Profile signer record is missing a private key')
  }

  return {
    profileKey,
    privateKey: await importPrivateKey(fromBase64Url(privateKeyPkcs8))
  }
}

export async function createSharedProfileToken(profile, signer) {
  return encodeProfileCard(await createProfileCard(profile, signer))
}

export function profileSummaryFromCard(card) {
  const payload = canonicalPayload(card?.payload)

  return {
    identityKey: payload.profileKey,
    writerKey: payload.profileKey,
    profile: {
      displayName: payload.displayName,
      bio: payload.bio,
      avatarMimeType: payload.avatarMimeType,
      avatarDataUrl: payload.avatarDataUrl,
      updatedAt: payload.updatedAt
    }
  }
}

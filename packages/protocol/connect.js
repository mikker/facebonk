import { createHash, webcrypto } from 'crypto'

const { subtle } = webcrypto

export const CONNECT_PROOF_PREFIX = 'facebonk-connect:'
export const CONSUMER_GRANT_PREFIX = 'facebonk-grant:'
export const CONNECT_VERSION = 1

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

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

function assertHexKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('Profile key must be a 32-byte hex public key')
  }
}

function normalizeUpdatedAt(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : Date.now()
}

function normalizeAudience(value) {
  const audience = normalizeText(value)
  if (!audience) throw new Error('Connect proof audience is required')
  if (audience.length > 256) throw new Error('Connect proof audience is too long')
  return audience
}

function normalizeNonce(value) {
  const nonce = normalizeText(value)
  if (!nonce) throw new Error('Connect proof nonce is required')
  if (nonce.length > 256) throw new Error('Connect proof nonce is too long')
  return nonce
}

function normalizeExpiry(value, issuedAt) {
  const expiresAt = typeof value === 'number' && Number.isFinite(value)
    ? Math.max(issuedAt, Math.floor(value))
    : issuedAt + 5 * 60 * 1000
  return expiresAt
}

function normalizeOptionalMimeType(value) {
  const mimeType = normalizeText(value)
  return mimeType || null
}

export function canonicalAssetRef(input) {
  if (!input) return null

  const algorithm = normalizeText(input.algorithm || 'sha256').toLowerCase()
  if (algorithm !== 'sha256') {
    throw new Error('Only sha256 asset refs are supported')
  }

  const hash = normalizeText(input.hash).toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error('Asset hash must be a sha256 hex string')
  }

  const byteLength =
    typeof input.byteLength === 'number' && Number.isFinite(input.byteLength)
      ? Math.max(0, Math.floor(input.byteLength))
      : null

  return {
    algorithm,
    hash,
    mimeType: normalizeOptionalMimeType(input.mimeType),
    byteLength,
  }
}

export function createAssetRef(data, options = {}) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  return canonicalAssetRef({
    algorithm: 'sha256',
    hash: createHash('sha256').update(buffer).digest('hex'),
    mimeType: options.mimeType || null,
    byteLength: buffer.length,
  })
}

export function verifyAssetBytes(assetRef, data) {
  const ref = canonicalAssetRef(assetRef)
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const hash = createHash('sha256').update(buffer).digest('hex')
  return hash === ref.hash
}

function profileDocumentPayloadBytes(payload) {
  return Buffer.from(JSON.stringify(canonicalProfileDocumentPayload(payload)))
}

function connectProofPayloadBytes(payload) {
  return Buffer.from(JSON.stringify(canonicalConnectProofPayload(payload)))
}

function consumerGrantPayloadBytes(payload) {
  return Buffer.from(JSON.stringify(canonicalConsumerGrantPayload(payload)))
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

async function signPayload(payloadBytes, signer) {
  return toBase64Url(
    await subtle.sign({ name: 'Ed25519' }, signer.privateKey, payloadBytes)
  )
}

async function verifyPayload(payloadBytes, signature, profileKey) {
  const publicKey = await importPublicKey(profileKey)
  return await subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    fromBase64Url(signature),
    payloadBytes
  )
}

export function canonicalProfileDocumentPayload(input = {}) {
  const profileKey = normalizeText(input.profileKey).toLowerCase()
  assertHexKey(profileKey)

  const displayName = normalizeText(input.displayName)
  const bio = normalizeText(input.bio)

  return {
    type: 'facebonk-profile-document',
    version: CONNECT_VERSION,
    profileKey,
    displayName: displayName || null,
    bio: bio || null,
    avatar: canonicalAssetRef(input.avatar),
    updatedAt: normalizeUpdatedAt(input.updatedAt),
  }
}

export function hashProfileDocument(input) {
  const payload = canonicalProfileDocumentPayload(input?.payload ?? input)
  return createHash('sha256').update(profileDocumentPayloadBytes(payload)).digest('hex')
}

export async function createProfileDocument(profile, signer) {
  const payload = canonicalProfileDocumentPayload({
    ...profile,
    profileKey: signer.profileKey,
  })

  return {
    payload,
    signature: await signPayload(profileDocumentPayloadBytes(payload), signer),
  }
}

export async function verifyProfileDocument(input) {
  const document = input ?? {}
  const payload = canonicalProfileDocumentPayload(document.payload)
  const signature = normalizeText(document.signature)
  if (!signature) {
    throw new Error('Signed profile document is missing a signature')
  }

  const ok = await verifyPayload(profileDocumentPayloadBytes(payload), signature, payload.profileKey)
  if (!ok) {
    throw new Error('Profile document signature could not be verified')
  }

  return { payload, signature }
}

export function canonicalConnectProofPayload(input = {}) {
  const profileKey = normalizeText(input.profileKey).toLowerCase()
  assertHexKey(profileKey)

  const issuedAt = normalizeUpdatedAt(input.issuedAt)
  const profileDocumentHash = normalizeText(input.profileDocumentHash).toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(profileDocumentHash)) {
    throw new Error('Connect proof profileDocumentHash must be a sha256 hex string')
  }

  return {
    type: 'facebonk-connect-proof',
    version: CONNECT_VERSION,
    profileKey,
    audience: normalizeAudience(input.audience),
    nonce: normalizeNonce(input.nonce),
    issuedAt,
    expiresAt: normalizeExpiry(input.expiresAt, issuedAt),
    profileDocumentHash,
  }
}

export function canonicalConsumerGrantPayload(input = {}) {
  const profileKey = normalizeText(input.profileKey).toLowerCase()
  assertHexKey(profileKey)

  const issuedAt = normalizeUpdatedAt(input.issuedAt)

  return {
    type: 'facebonk-consumer-grant',
    version: CONNECT_VERSION,
    profileKey,
    audience: normalizeAudience(input.audience),
    issuedAt,
    expiresAt: normalizeExpiry(input.expiresAt, issuedAt),
  }
}

export async function createConnectProof(options, signer) {
  const payload = canonicalConnectProofPayload({
    ...options,
    profileKey: signer.profileKey,
  })

  return {
    payload,
    signature: await signPayload(connectProofPayloadBytes(payload), signer),
  }
}

export async function createConsumerGrant(options, signer) {
  const payload = canonicalConsumerGrantPayload({
    ...options,
    profileKey: signer.profileKey,
  })

  return {
    payload,
    signature: await signPayload(consumerGrantPayloadBytes(payload), signer),
  }
}

export function encodeConnectProof(proof) {
  const payload = canonicalConnectProofPayload(proof?.payload)
  const signature = normalizeText(proof?.signature)
  if (!signature) {
    throw new Error('Connect proof is missing a signature')
  }

  return `${CONNECT_PROOF_PREFIX}${toBase64Url(
    Buffer.from(JSON.stringify({ payload, signature }))
  )}`
}

export function encodeConsumerGrant(grant) {
  const payload = canonicalConsumerGrantPayload(grant?.payload)
  const signature = normalizeText(grant?.signature)
  if (!signature) {
    throw new Error('Consumer grant is missing a signature')
  }

  return `${CONSUMER_GRANT_PREFIX}${toBase64Url(
    Buffer.from(JSON.stringify({ payload, signature }))
  )}`
}

export function decodeConnectProof(token) {
  const value = normalizeText(token)
  if (!value) throw new Error('Connect proof token is required')
  if (!value.startsWith(CONNECT_PROOF_PREFIX)) {
    throw new Error('Not a Facebonk connect proof token')
  }

  let parsed = null
  try {
    parsed = JSON.parse(fromBase64Url(value.slice(CONNECT_PROOF_PREFIX.length)).toString('utf8'))
  } catch {
    throw new Error('Invalid Facebonk connect proof token')
  }

  return {
    payload: canonicalConnectProofPayload(parsed?.payload),
    signature: normalizeText(parsed?.signature),
  }
}

export function decodeConsumerGrant(token) {
  const value = normalizeText(token)
  if (!value) throw new Error('Consumer grant token is required')
  if (!value.startsWith(CONSUMER_GRANT_PREFIX)) {
    throw new Error('Not a Facebonk consumer grant token')
  }

  let parsed = null
  try {
    parsed = JSON.parse(
      fromBase64Url(value.slice(CONSUMER_GRANT_PREFIX.length)).toString('utf8')
    )
  } catch {
    throw new Error('Invalid Facebonk consumer grant token')
  }

  return {
    payload: canonicalConsumerGrantPayload(parsed?.payload),
    signature: normalizeText(parsed?.signature),
  }
}

export async function verifyConnectProof(input, options = {}) {
  const proof = typeof input === 'string' ? decodeConnectProof(input) : input ?? {}
  const payload = canonicalConnectProofPayload(proof.payload)
  const signature = normalizeText(proof.signature)
  if (!signature) {
    throw new Error('Connect proof is missing a signature')
  }

  const ok = await verifyPayload(connectProofPayloadBytes(payload), signature, payload.profileKey)
  if (!ok) {
    throw new Error('Connect proof signature could not be verified')
  }

  if (options.audience && payload.audience !== options.audience) {
    throw new Error('Connect proof audience did not match')
  }

  if (options.nonce && payload.nonce !== options.nonce) {
    throw new Error('Connect proof nonce did not match')
  }

  const now =
    typeof options.now === 'number' && Number.isFinite(options.now)
      ? Math.floor(options.now)
      : Date.now()

  if (payload.expiresAt < now) {
    throw new Error('Connect proof has expired')
  }

  return { payload, signature }
}

export async function verifyConsumerGrant(input, options = {}) {
  const grant = typeof input === 'string' ? decodeConsumerGrant(input) : input ?? {}
  const payload = canonicalConsumerGrantPayload(grant.payload)
  const signature = normalizeText(grant.signature)
  if (!signature) {
    throw new Error('Consumer grant is missing a signature')
  }

  const ok = await verifyPayload(
    consumerGrantPayloadBytes(payload),
    signature,
    payload.profileKey
  )
  if (!ok) {
    throw new Error('Consumer grant signature could not be verified')
  }

  if (options.audience && payload.audience !== options.audience) {
    throw new Error('Consumer grant audience did not match')
  }

  const now =
    typeof options.now === 'number' && Number.isFinite(options.now)
      ? Math.floor(options.now)
      : Date.now()

  if (payload.expiresAt < now) {
    throw new Error('Consumer grant has expired')
  }

  return { payload, signature }
}

export async function createConnectBundle(options, signer) {
  const profileDocument = await createProfileDocument(options.profile, signer)
  const proof = await createConnectProof(
    {
      audience: options.audience,
      nonce: options.nonce,
      issuedAt: options.issuedAt,
      expiresAt: options.expiresAt,
      profileDocumentHash: hashProfileDocument(profileDocument),
    },
    signer
  )

  return {
    proof: encodeConnectProof(proof),
    profileDocument,
  }
}

export async function verifyConnectBundle(bundle, options = {}) {
  const proof = await verifyConnectProof(bundle?.proof, {
    audience: options.audience,
    nonce: options.nonce,
    now: options.now,
  })
  const profileDocument = await verifyProfileDocument(bundle?.profileDocument)
  const profileDocumentHash = hashProfileDocument(profileDocument)

  if (proof.payload.profileDocumentHash !== profileDocumentHash) {
    throw new Error('Connect proof profile document hash did not match')
  }

  if (proof.payload.profileKey !== profileDocument.payload.profileKey) {
    throw new Error('Connect proof profile key did not match profile document')
  }

  return {
    proof,
    profileDocument,
  }
}

export async function createProfileSignerRecord() {
  const keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const rawPublicKey = await subtle.exportKey('raw', keyPair.publicKey)
  const pkcs8 = await subtle.exportKey('pkcs8', keyPair.privateKey)

  const record = {
    profileKey: Buffer.from(rawPublicKey).toString('hex'),
    privateKeyPkcs8: toBase64Url(pkcs8),
    createdAt: Date.now(),
  }

  return {
    record,
    signer: {
      profileKey: record.profileKey,
      privateKey: keyPair.privateKey,
    },
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
    privateKey: await importPrivateKey(fromBase64Url(privateKeyPkcs8)),
  }
}

export function profileSummaryFromProfileDocument(input) {
  const payload = canonicalProfileDocumentPayload(input?.payload ?? input)

  return {
    identityKey: payload.profileKey,
    writerKey: payload.profileKey,
    profile: {
      displayName: payload.displayName,
      bio: payload.bio,
      avatar: payload.avatar,
      updatedAt: payload.updatedAt,
    },
  }
}

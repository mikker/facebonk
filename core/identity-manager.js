import { Manager } from 'autobonk'
import { IdentityContext } from './identity-context.js'
import {
  createAssetRef,
  createConnectBundle,
  createConsumerGrant as createSignedConsumerGrant,
  encodeConsumerGrant,
  hashProfileDocument,
  createProfileDocument,
  createProfileSignerRecord,
  verifyConsumerGrant,
  restoreProfileSigner
} from './connect.js'
import { facebonkSchema } from './generated-schema.js'

const ACTIVE_IDENTITY_KEY = 'app/active-identity'
const PROFILE_SIGNER_KEY = 'app/profile-signer'

function unwrapRecord(node) {
  return node?.value ?? node ?? null
}

export class IdentityManager extends Manager {
  constructor(baseDir, options = {}) {
    super(baseDir, {
      ContextClass: IdentityContext,
      schema: options.schema ?? facebonkSchema,
      bootstrap: options.bootstrap,
      autobase: options.autobase,
      blindPeering: options.blindPeering
    })
  }

  async initIdentity(profile = {}) {
    await this.ready()

    const existing = await this.getActiveIdentity()
    if (existing) {
      const currentProfile = await existing.getProfile()
      if (!currentProfile) {
        await existing.bootstrapIdentity(profile)
      }
      return existing
    }

    return await this.createIdentity(profile)
  }

  async createIdentity(profile = {}) {
    const context = await this.createContext({
      name: 'Facebonk Identity'
    })
    await context.waitForLocalPermission('user:invite')
    await context.bootstrapIdentity(profile)
    await this.setActiveIdentity(context.key.toString('hex'))
    return context
  }

  async joinIdentity(invite) {
    const context = await this.joinContext(invite, {
      name: 'Linked Facebonk Identity'
    })
    await context.waitForLocalRole('owner')
    await context.waitForLocalPermission('user:invite')
    await this.setActiveIdentity(context.key.toString('hex'))
    return context
  }

  async getActiveIdentity() {
    await this.ready()

    const active = unwrapRecord(await this.localDb.get(ACTIVE_IDENTITY_KEY))
    if (active?.key) {
      return await this.getContext(active.key)
    }

    const records = await this.listContexts()
    if (records.length === 0) return null

    const [first] = records
    await this.setActiveIdentity(first.key)
    return await this.getContext(first.key)
  }

  async setActiveIdentity(keyHex) {
    await this.ready()

    const record = unwrapRecord(await this.localDb.get(`contexts/${keyHex}`))
    if (!record) {
      throw new Error(`Unknown identity: ${keyHex}`)
    }

    await this.localDb.put(ACTIVE_IDENTITY_KEY, {
      key: keyHex,
      updatedAt: Date.now()
    })
  }

  async getOwnWriterKey() {
    const identity = await this.getActiveIdentity()
    return identity ? identity.writerKey.toString('hex') : null
  }

  async getSummary() {
    const identity = await this.getActiveIdentity()
    if (!identity) return null

    return {
      identityKey: identity.key.toString('hex'),
      writerKey: identity.writerKey.toString('hex'),
      profile: await identity.getProfile(),
      devices: await identity.listDevices()
    }
  }

  async getProfileSigner() {
    await this.ready()

    const existing = unwrapRecord(await this.localDb.get(PROFILE_SIGNER_KEY))
    if (existing) {
      return await restoreProfileSigner(existing)
    }

    const created = await createProfileSignerRecord()
    await this.localDb.put(PROFILE_SIGNER_KEY, created.record)
    return created.signer
  }

  async createProfileDocument() {
    const signer = await this.getProfileSigner()
    const snapshot = await this.getProfileSnapshot()

    return await createProfileDocument(
      {
        displayName: snapshot.profile.displayName,
        bio: snapshot.profile.bio,
        avatar: snapshot.profile.avatar,
        updatedAt: snapshot.profile.updatedAt
      },
      signer
    )
  }

  async createConnectBundle(options = {}) {
    const signer = await this.getProfileSigner()
    const snapshot = await this.getProfileSnapshot()
    const grant = await this.createConsumerGrant(options)

    return await createConnectBundle(
      {
        audience: options.audience,
        nonce: options.nonce,
        issuedAt: options.issuedAt,
        expiresAt: options.expiresAt,
        profile: snapshot.profile
      },
      signer
    ).then((bundle) => ({
      ...bundle,
      grant,
    }))
  }

  async createConsumerGrant(options = {}) {
    const signer = await this.getProfileSigner()

    const grant = await createSignedConsumerGrant(
      {
        audience: options.audience,
        issuedAt: options.issuedAt,
        expiresAt:
          typeof options.expiresAt === 'number' && Number.isFinite(options.expiresAt)
            ? options.expiresAt
            : Date.now() + 7 * 24 * 60 * 60 * 1000
      },
      signer
    )

    return encodeConsumerGrant(grant)
  }

  async refreshConsumerProfile(options = {}) {
    const grant = await verifyConsumerGrant(options.grant, {
      audience: options.audience
    })
    const profileDocument = await this.createProfileDocument()
    const profileDocumentHash = hashProfileDocument(profileDocument)

    if (
      typeof options.knownProfileDocumentHash === 'string' &&
      options.knownProfileDocumentHash.trim().toLowerCase() === profileDocumentHash
    ) {
      return {
        changed: false,
        profileKey: grant.payload.profileKey,
        profileDocumentHash,
        expiresAt: grant.payload.expiresAt
      }
    }

    return {
      changed: true,
      profileKey: grant.payload.profileKey,
      profileDocumentHash,
      expiresAt: grant.payload.expiresAt,
      profileDocument,
      avatarAsset: await this.getAvatarAsset()
    }
  }

  async getAvatarAsset() {
    const identity = await this.getActiveIdentity()
    if (!identity) return null

    const avatar = await identity.getAvatar()
    if (!avatar?.data || avatar.data.length === 0) return null

    return {
      data: avatar.data,
      mimeType: avatar.mimeType || 'application/octet-stream',
      asset: createAssetRef(avatar.data, {
        mimeType: avatar.mimeType || 'application/octet-stream'
      })
    }
  }

  async getProfileSnapshot() {
    const identity = await this.initIdentity()
    const profile = (await identity.getProfile()) ?? {}
    const avatar = await identity.getAvatar()

    return {
      profile: {
        displayName: profile.displayName ?? '',
        bio: profile.bio ?? '',
        avatar:
          avatar?.data && avatar.data.length > 0
            ? createAssetRef(avatar.data, {
                mimeType: avatar.mimeType || 'application/octet-stream'
              })
            : null,
        updatedAt: profile.updatedAt ?? Date.now()
      },
      avatar
    }
  }
}

import { Manager } from 'autobonk'
import { IdentityContext } from './identity-context.js'
import {
  createAssetRef,
  createConnectBundle,
  createProfileDocument,
  createProfileSignerRecord,
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
    const identity = await this.initIdentity()
    const signer = await this.getProfileSigner()
    const profile = (await identity.getProfile()) ?? {}
    const avatar = await identity.getAvatar()

    return await createProfileDocument(
      {
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
      signer
    )
  }

  async createConnectBundle(options = {}) {
    const identity = await this.initIdentity()
    const signer = await this.getProfileSigner()
    const profile = (await identity.getProfile()) ?? {}
    const avatar = await identity.getAvatar()

    return await createConnectBundle(
      {
        audience: options.audience,
        nonce: options.nonce,
        issuedAt: options.issuedAt,
        expiresAt: options.expiresAt,
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
        }
      },
      signer
    )
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
}

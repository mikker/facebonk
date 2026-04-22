import { Context } from 'autobonk'
import Hyperblobs from 'hyperblobs'

const PROFILE_ID = 'profile'
const OWNER_ROLE = 'owner'
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

function normalizeOptionalText(value, maxLength) {
  if (value === undefined) return undefined
  if (value === null) return null

  const text = String(value).trim()
  if (text.length === 0) return null
  return text.slice(0, maxLength)
}

function bufferToHex(buffer) {
  return Buffer.from(buffer).toString('hex')
}

function unwrapRecord(node) {
  return node?.value ?? node ?? null
}

function normalizeOptionalMimeType(value) {
  const mimeType = normalizeOptionalText(value, 120)
  if (mimeType === undefined || mimeType === null) return mimeType
  return mimeType.toLowerCase()
}

function normalizeBlobRef(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!value || typeof value !== 'object') {
    throw new TypeError('Avatar blob ref must be an object')
  }

  const key = normalizeFixed32Buffer(value.key)
  const blockOffset = normalizeUint(value.blockOffset, 'blockOffset')
  const blockLength = normalizeUint(value.blockLength, 'blockLength')
  const byteOffset = normalizeUint(value.byteOffset, 'byteOffset')
  const byteLength = normalizeUint(value.byteLength, 'byteLength')

  return { key, blockOffset, blockLength, byteOffset, byteLength }
}

function normalizeFixed32Buffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : null
  if (!buffer || buffer.length !== 32) {
    throw new TypeError('Blob key must be a 32-byte buffer')
  }
  return buffer
}

function normalizeUint(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`)
  }
  return value
}

async function readStreamFully(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function copyProfileFields(profile, patch) {
  if (!Object.prototype.hasOwnProperty.call(patch, 'displayName') && profile?.displayName) {
    patch.displayName = profile.displayName
  }

  if (!Object.prototype.hasOwnProperty.call(patch, 'bio') && profile?.bio) {
    patch.bio = profile.bio
  }

  if (!Object.prototype.hasOwnProperty.call(patch, 'avatar') && profile?.avatar) {
    patch.avatar = profile.avatar
  }

  if (!Object.prototype.hasOwnProperty.call(patch, 'avatarMimeType') && profile?.avatarMimeType) {
    patch.avatarMimeType = profile.avatarMimeType
  }

  return patch
}

export class IdentityContext extends Context {
  constructor(store, opts = {}) {
    super(store, opts)
    this.blobs = null
    this.blobsCore = null
  }

  setupRoutes() {
    this.router.add('@facebonk/profile-set', async (data = {}, context) => {
      await this.requireIdentityOwner(context.writerKey)

      const existing = unwrapRecord(await context.view.get('@facebonk/profiles', {
        id: PROFILE_ID
      }))

      const record = {
        id: PROFILE_ID,
        updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now()
      }

      const nextDisplayName =
        data.clearDisplayName === true
          ? null
          : data.displayName === undefined
            ? existing?.displayName ?? null
            : normalizeOptionalText(data.displayName, 120)

      const nextBio =
        data.clearBio === true
          ? null
          : data.bio === undefined
            ? existing?.bio ?? null
            : normalizeOptionalText(data.bio, 600)

      const nextAvatar =
        data.clearAvatar === true
          ? null
          : data.avatar === undefined
            ? existing?.avatar ?? null
            : normalizeBlobRef(data.avatar)

      const nextAvatarMimeType =
        data.clearAvatar === true
          ? null
          : data.avatar !== undefined
            ? normalizeOptionalMimeType(data.avatarMimeType)
            : data.avatarMimeType === undefined
              ? existing?.avatarMimeType ?? null
              : normalizeOptionalMimeType(data.avatarMimeType)

      if (nextDisplayName) {
        record.displayName = nextDisplayName
      }

      if (nextBio) {
        record.bio = nextBio
      }

      if (nextAvatar) {
        record.avatar = nextAvatar
      }

      if (nextAvatarMimeType) {
        record.avatarMimeType = nextAvatarMimeType
      }

      await context.view.insert('@facebonk/profiles', record)
    })
  }

  async setupResources() {
    await this.setupBlobStore()
  }

  async teardownResources() {
    if (!this.blobsCore) return

    try {
      await this.blobs.close()
    } catch {}

    try {
      await this.blobsCore.close()
    } catch {}

    this.blobs = null
    this.blobsCore = null
  }

  async setupBlobStore() {
    if (this.blobs) return

    this.blobsCore = this.store.get({
      name: 'blobs',
      encryptionKey: this.encryptionKey
    })
    await this.blobsCore.ready()
    this.blobs = new Hyperblobs(this.blobsCore)
    await this.blobs.ready()
  }

  async hasIdentityOwner(subjectKey) {
    const roles = await this.getRoles(subjectKey)
    return roles.includes(OWNER_ROLE)
  }

  async requireIdentityOwner(subjectKey) {
    const contextInit = await this.base.view.findOne('@autobonk/context-init', {})
    if (!contextInit) return

    const allowed = await this.hasIdentityOwner(subjectKey)
    if (allowed) return

    const error = new Error('Missing permission: identity:owner')
    error.name = 'PermissionError'
    error.requiredPermission = 'identity:owner'
    error.subjectKey = subjectKey
    throw error
  }

  async bootstrapIdentity(profile = {}) {
    await this.waitForLocalOwner()

    const existing = await this.getProfile()
    if (existing) return existing

    if (!this.writable) {
      throw new Error('Cannot bootstrap identity from a read-only context')
    }

    await this.setProfile(profile)
    return await this.getProfile()
  }

  async getProfile() {
    return await this.base.view.get('@facebonk/profiles', {
      id: PROFILE_ID
    })
  }

  async setProfile(patch = {}) {
    await this.requireIdentityOwner(this.writerKey)

    patch = copyProfileFields(await this.getProfile(), { ...patch })

    const payload = {
      updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now()
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
      const value = normalizeOptionalText(patch.displayName, 120)
      if (value === null) payload.clearDisplayName = true
      else payload.displayName = value
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'bio')) {
      const value = normalizeOptionalText(patch.bio, 600)
      if (value === null) payload.clearBio = true
      else payload.bio = value
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'avatar')) {
      const value = normalizeBlobRef(patch.avatar)
      if (value === null) payload.clearAvatar = true
      else payload.avatar = value
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'avatarMimeType')) {
      const value = normalizeOptionalMimeType(patch.avatarMimeType)
      if (value !== null && value !== undefined) {
        payload.avatarMimeType = value
      }
    }

    await this.base.append(this.schema.dispatch.encode('@facebonk/profile-set', payload))
    return await this.getProfile()
  }

  async setAvatar(data, options = {}) {
    await this.requireIdentityOwner(this.writerKey)

    const buffer = Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : null
    if (!buffer || buffer.length === 0) {
      throw new Error('Avatar bytes are required')
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
      throw new Error(`Avatar must be ${MAX_AVATAR_BYTES} bytes or smaller`)
    }

    await this.setupBlobStore()

    const pointer = await this.blobs.put(buffer)
    const current = await this.getProfile()

    return await this.setProfile(copyProfileFields(current, {
      updatedAt: typeof options.updatedAt === 'number' ? options.updatedAt : Date.now(),
      avatar: {
        key: Buffer.from(this.blobs.key),
        blockOffset: pointer.blockOffset,
        blockLength: pointer.blockLength,
        byteOffset: pointer.byteOffset,
        byteLength: pointer.byteLength
      },
      avatarMimeType: normalizeOptionalMimeType(options.mimeType)
    }))
  }

  async clearAvatar(options = {}) {
    const current = await this.getProfile()

    return await this.setProfile(copyProfileFields(current, {
      updatedAt: typeof options.updatedAt === 'number' ? options.updatedAt : Date.now(),
      avatar: null
    }))
  }

  async getAvatar() {
    const profile = await this.getProfile()
    if (!profile?.avatar) return null

    const { blobs, release } = await this.resolveBlobStore(profile.avatar)

    try {
      const stream = blobs.createReadStream(profile.avatar, { wait: true })
      const data = await readStreamFully(stream)

      return {
        data,
        mimeType: profile.avatarMimeType ?? null,
        byteLength: data.length,
        avatar: profile.avatar
      }
    } finally {
      await release()
    }
  }

  async resolveBlobStore(pointer) {
    await this.setupBlobStore()

    const targetKey = Buffer.from(pointer.key)
    if (Buffer.from(this.blobs.key).equals(targetKey)) {
      return {
        blobs: this.blobs,
        release: async () => {}
      }
    }

    const core = this.store.get({
      key: targetKey,
      encryptionKey: this.encryptionKey
    })
    await core.ready()

    const blobs = new Hyperblobs(core)
    await blobs.ready()

    return {
      blobs,
      release: async () => {
        try {
          await blobs.close()
        } catch {}

        try {
          await core.close()
        } catch {}
      }
    }
  }

  async listDevices() {
    const rows = await this.base.view.find('@autobonk/acl-entry').toArray()

    return rows
      .filter((row) => Array.isArray(row.roles) && row.roles.includes(OWNER_ROLE))
      .map((row) => ({
        writerKey: bufferToHex(row.subjectKey),
        roles: row.roles,
        rev: row.rev,
        timestamp: row.timestamp
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  async createLinkInvite(options = {}) {
    await this.waitForLocalPermission('user:invite')
    await this.requireIdentityOwner(this.writerKey)

    const expiresInMs = options.expiresInMs
    const inviteOptions = { roles: [OWNER_ROLE] }

    if (typeof expiresInMs === 'number' && expiresInMs > 0) {
      inviteOptions.expires = Date.now() + expiresInMs
    }

    return await this.createInvite(inviteOptions)
  }

  async revokeDevice(writerKey) {
    await this.waitForLocalPermission('user:invite')
    await this.requireIdentityOwner(this.writerKey)

    const subjectKey = Buffer.isBuffer(writerKey) ? writerKey : Buffer.from(writerKey, 'hex')

    if (Buffer.from(this.writerKey).equals(subjectKey)) {
      throw new Error('Cannot revoke the current device from this process')
    }

    const roles = await this.getRoles(subjectKey)
    if (!roles.includes(OWNER_ROLE)) {
      return false
    }

    await this.revokeRoles(subjectKey)
    return true
  }

  async waitForLocalOwner(timeout = 5000, interval = 25) {
    return await this.waitForLocalRole(OWNER_ROLE, timeout, interval)
  }

  async waitForLocalRole(roleName, timeout = 5000, interval = 25) {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeout) {
      const roles = await this.getRoles(this.writerKey)
      if (roles.includes(roleName)) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    throw new Error(`Timed out waiting for local role: ${roleName}`)
  }

  async waitForLocalPermission(permission, timeout = 5000, interval = 25) {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeout) {
      const hasPermission = await this.hasPermission(this.writerKey, permission)
      if (hasPermission) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    throw new Error(`Timed out waiting for local permission: ${permission}`)
  }
}

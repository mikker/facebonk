import { Context } from 'autobonk'

const PROFILE_ID = 'profile'
const OWNER_ROLE = 'owner'

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

export class IdentityContext extends Context {
  setupRoutes() {
    this.router.add('@facebonk/profile-set', async (data = {}, context) => {
      await this.requireIdentityOwner(context.writerKey)

      const existing = await context.view.get('@facebonk/profiles', {
        id: PROFILE_ID
      })

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

      if (nextDisplayName) {
        record.displayName = nextDisplayName
      }

      if (nextBio) {
        record.bio = nextBio
      }

      await context.view.insert('@facebonk/profiles', record)
    })
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

    await this.base.append(this.schema.dispatch.encode('@facebonk/profile-set', payload))
    return await this.getProfile()
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
    await this.removeWriter(subjectKey)
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

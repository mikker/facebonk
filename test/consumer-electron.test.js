import { rm } from 'fs/promises'
import test from 'brittle'

import {
  parseFacebonkAuthUrl,
  parseFacebonkRefreshUrl,
  IdentityManager
} from '../core/index.js'
import {
  createFacebonkClient
} from '../packages/consumer-electron/index.js'
import {
  createInMemoryFacebonkSessionStore
} from '../packages/consumer-core/index.js'
import { createTempDir } from './helpers/temp-dir.js'

async function createManager(t, prefix) {
  const dir = await createTempDir(prefix)
  const manager = new IdentityManager(dir)
  await manager.ready()

  t.teardown(async () => {
    await manager.close()
    await rm(dir, { recursive: true, force: true })
  })

  return manager
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }
}

test('consumer-electron authenticates, restores, refreshes, and disconnects', async (t) => {
  const manager = await createManager(t, 'facebonk-consumer-electron-')

  await manager.initIdentity({
    displayName: 'Consumer Test',
    bio: 'first pass'
  })
  await manager.getActiveIdentity().then((identity) =>
    identity.setAvatar(Buffer.from('sdk-avatar-one'), { mimeType: 'image/png' })
  )

  const store = createInMemoryFacebonkSessionStore()

  const client = createFacebonkClient({
    clientId: 'consumer-app',
    appName: 'Consumer App',
    storage: store,
    fetchAvatarBytes: async () => Buffer.from('sdk-avatar-one'),
    async openUrl(url) {
      const request = parseFacebonkAuthUrl(url)
      const bundle = await manager.createConnectBundle({
        audience: request.client,
        nonce: request.state
      })

      await postJson(request.callbackUrl, {
        state: request.state,
        proof: bundle.proof,
        grant: bundle.grant,
        profileDocument: bundle.profileDocument,
        avatarUrl: 'http://127.0.0.1/sdk-avatar-one'
      })
    }
  })

  const session = await client.authenticate()
  t.is(session.profileKey.length, 64)
  t.is((await session.getProfile()).displayName, 'Consumer Test')

  const restored = await client.restore()
  t.ok(restored)
  t.is((await restored.getProfile()).displayName, 'Consumer Test')

  await manager.getActiveIdentity().then((identity) =>
    identity.setProfile({
      displayName: 'Consumer Test Updated',
      bio: 'second pass'
    })
  )

  const refreshingClient = createFacebonkClient({
    clientId: 'consumer-app',
    appName: 'Consumer App',
    storage: store,
    fetchAvatarBytes: async () => Buffer.from('sdk-avatar-one'),
    async openUrl(url) {
      const request = parseFacebonkRefreshUrl(url)
      const payload = await manager.refreshConsumerProfile({
        audience: request.client,
        grant: request.grant,
        knownProfileDocumentHash: request.knownProfileDocumentHash
      })

      await postJson(request.callbackUrl, {
        state: request.state,
        changed: payload.changed,
        profileDocument: payload.profileDocument ?? null,
        avatarUrl: payload.changed ? 'http://127.0.0.1/sdk-avatar-one' : null
      })
    }
  })

  const refreshedSession = await refreshingClient.restore()
  const refreshResult = await refreshedSession.refresh()
  t.is(refreshResult.changed, true)
  t.is(refreshResult.profile.displayName, 'Consumer Test Updated')

  await refreshedSession.disconnect()
  t.is(await refreshingClient.restore(), null)
})

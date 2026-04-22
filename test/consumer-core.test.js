import { rm } from 'fs/promises'
import test from 'brittle'

import { IdentityManager } from '../core/index.js'
import {
  connectFacebonkSession,
  profileFromFacebonkSession,
  refreshFacebonkSession,
  restoreFacebonkSession
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

test('consumer-core connects, restores, and refreshes Facebonk sessions', async (t) => {
  const manager = await createManager(t, 'facebonk-consumer-core-')

  await manager.initIdentity({
    displayName: 'Mikker',
    bio: 'hi im mikker'
  })
  await manager.getActiveIdentity().then((identity) =>
    identity.setAvatar(Buffer.from('avatar-one'), { mimeType: 'image/png' })
  )

  const bundle = await manager.createConnectBundle({
    audience: 'consumer-app',
    nonce: 'connect-nonce'
  })

  const session = await connectFacebonkSession(
    {
      proof: bundle.proof,
      grant: bundle.grant,
      profileDocument: bundle.profileDocument,
      avatarUrl: 'http://127.0.0.1/avatar-one'
    },
    {
      clientId: 'consumer-app',
      nonce: 'connect-nonce',
      fetchAvatarBytes: async () => Buffer.from('avatar-one')
    }
  )

  t.is(session.profileKey, bundle.profileDocument.payload.profileKey)
  t.ok(session.avatarDataUrl?.startsWith('data:image/png;base64,'))

  const profile = profileFromFacebonkSession(session)
  t.is(profile.displayName, 'Mikker')
  t.is(profile.bio, 'hi im mikker')
  t.ok(profile.avatarUrl)

  const restored = await restoreFacebonkSession(session, {
    clientId: 'consumer-app'
  })
  t.is(restored.profileDocumentHash, session.profileDocumentHash)

  const unchangedPayload = await manager.refreshConsumerProfile({
    audience: 'consumer-app',
    grant: bundle.grant,
    knownProfileDocumentHash: session.profileDocumentHash
  })

  const unchanged = await refreshFacebonkSession(restored, unchangedPayload, {
    clientId: 'consumer-app',
    fetchAvatarBytes: async () => {
      throw new Error('unchanged refresh should not fetch an avatar')
    }
  })

  t.is(unchanged.changed, false)
  t.is(unchanged.session.profileDocumentHash, session.profileDocumentHash)

  await manager.getActiveIdentity().then((identity) =>
    identity.setProfile({
      displayName: 'Mikker Updated',
      bio: 'still mikker'
    })
  )

  const changedPayload = await manager.refreshConsumerProfile({
    audience: 'consumer-app',
    grant: bundle.grant,
    knownProfileDocumentHash: session.profileDocumentHash
  })

  const changed = await refreshFacebonkSession(restored, {
    ...changedPayload,
    avatarUrl: 'http://127.0.0.1/avatar-one'
  }, {
    clientId: 'consumer-app',
    fetchAvatarBytes: async () => {
      throw new Error('text-only refresh should reuse the cached avatar')
    }
  })

  t.is(changed.changed, true)
  t.is(
    profileFromFacebonkSession(changed.session).displayName,
    'Mikker Updated'
  )
  t.is(changed.session.avatarDataUrl, restored.avatarDataUrl)
})

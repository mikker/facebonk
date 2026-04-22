import { rm } from 'fs/promises'
import test from 'brittle'
import {
  IdentityManager,
  hashProfileDocument,
  profileSummaryFromProfileDocument,
  verifyConnectBundle,
  verifyConsumerGrant,
  verifyAssetBytes,
} from '../core/index.js'
import { createTempDir } from './helpers/temp-dir.js'

async function createManager(t, prefix) {
  const dir = await createTempDir(prefix)
  const manager = new IdentityManager(dir)
  await manager.ready()

  t.teardown(async () => {
    await manager.close()
    await rm(dir, { recursive: true, force: true })
  })

  return { dir, manager }
}

async function waitFor(fn, predicate, timeout = 5000, interval = 50) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeout) {
    const value = await fn()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  const value = await fn()
  if (!predicate(value)) {
    throw new Error('Timed out waiting for condition')
  }

  return value
}

test('initIdentity bootstraps one active identity with a shared profile', async (t) => {
  const { manager } = await createManager(t, 'facebonk-identity-')

  const identity = await manager.initIdentity({
    displayName: 'Alice Bonk',
    bio: 'P2P all the way down'
  })

  const summary = await manager.getSummary()

  t.ok(identity, 'returns an identity context')
  t.ok(summary, 'summary is available')
  t.is(summary?.identityKey, identity.key.toString('hex'))
  t.is(summary?.profile?.displayName, 'Alice Bonk')
  t.is(summary?.profile?.bio, 'P2P all the way down')
  t.is(summary?.devices.length, 1, 'one owner device present')
  t.is(summary?.devices[0].writerKey, identity.writerKey.toString('hex'))
})

test('shared profile persists across manager reopen', async (t) => {
  const dir = await createTempDir('facebonk-reopen-')
  const manager = new IdentityManager(dir)
  await manager.ready()

  t.teardown(async () => {
    await manager.close()
    await rm(dir, { recursive: true, force: true })
  })

  const identity = await manager.initIdentity({
    displayName: 'Before Reopen'
  })
  await identity.setProfile({
    displayName: 'After Reopen',
    bio: 'Profile persisted'
  })
  const keyHex = identity.key.toString('hex')

  await manager.close()

  const reopened = new IdentityManager(dir)
  await reopened.ready()

  t.teardown(async () => {
    await reopened.close()
  })

  const active = await reopened.getActiveIdentity()
  const profile = await active?.getProfile()

  t.is(active?.key.toString('hex'), keyHex)
  t.is(profile?.displayName, 'After Reopen')
  t.is(profile?.bio, 'Profile persisted')
})

test('avatar bytes persist in the shared profile and can be read back', async (t) => {
  const { manager } = await createManager(t, 'facebonk-avatar-')

  const identity = await manager.initIdentity({
    displayName: 'Avatar Bonk'
  })

  const avatarBytes = Buffer.from('fake-png-avatar')
  const profile = await identity.setAvatar(avatarBytes, {
    mimeType: 'image/png'
  })

  t.is(profile?.avatarMimeType, 'image/png')
  t.ok(profile?.avatar, 'avatar pointer stored on profile')
  t.is(profile?.avatar?.byteLength, avatarBytes.length)

  const avatar = await identity.getAvatar()
  t.ok(avatar, 'avatar can be loaded')
  t.is(avatar?.mimeType, 'image/png')
  t.alike(avatar?.data, avatarBytes)
})

test('setProfile preserves avatar when only text fields change', async (t) => {
  const { manager } = await createManager(t, 'facebonk-avatar-preserve-')

  const identity = await manager.initIdentity({
    displayName: 'Avatar Bonk'
  })

  const avatarBytes = Buffer.from('fake-png-avatar')
  await identity.setAvatar(avatarBytes, {
    mimeType: 'image/png'
  })

  const profile = await identity.setProfile({
    displayName: 'Avatar Bonk Updated',
    bio: 'Still has avatar'
  })

  t.ok(profile?.avatar, 'avatar pointer is preserved')
  t.is(profile?.avatarMimeType, 'image/png')

  const avatar = await identity.getAvatar()
  t.ok(avatar, 'avatar still loads after text update')
  t.is(avatar?.mimeType, 'image/png')
  t.alike(avatar?.data, avatarBytes)
})

test('link invite joins a second device onto the same identity', async (t) => {
  const first = await createManager(t, 'facebonk-link-a-')
  const second = await createManager(t, 'facebonk-link-b-')

  const primaryIdentity = await first.manager.initIdentity({
    displayName: 'Linked Human',
    bio: 'Original profile'
  })
  await primaryIdentity.setAvatar(Buffer.from('linked-avatar-a'), {
    mimeType: 'image/webp'
  })
  const invite = await primaryIdentity.createLinkInvite()

  const linkedIdentity = await second.manager.joinIdentity(invite)

  t.is(
    linkedIdentity.key.toString('hex'),
    primaryIdentity.key.toString('hex'),
    'linked device joins the same identity context'
  )

  const devices = await waitFor(
    () => primaryIdentity.listDevices(),
    (rows) => rows.length === 2
  )

  t.is(devices.length, 2, 'both devices are present')

  const linkedProfile = await waitFor(
    () => linkedIdentity.getProfile(),
    (profile) =>
      profile?.displayName === 'Linked Human' &&
      profile?.bio === 'Original profile' &&
      profile?.avatarMimeType === 'image/webp'
  )

  t.is(linkedProfile?.bio, 'Original profile')
  t.is(linkedProfile?.avatarMimeType, 'image/webp')

  const linkedAvatar = await waitFor(
    () => linkedIdentity.getAvatar(),
    (avatar) => avatar?.mimeType === 'image/webp'
  )
  t.alike(linkedAvatar?.data, Buffer.from('linked-avatar-a'))

  await linkedIdentity.setProfile({
    displayName: 'Linked Human Updated',
    bio: 'Updated from second device'
  })
  await linkedIdentity.setAvatar(Buffer.from('linked-avatar-b'), {
    mimeType: 'image/png'
  })

  const replicated = await waitFor(
    () => primaryIdentity.getProfile(),
    (profile) =>
      profile?.displayName === 'Linked Human Updated' &&
      profile?.bio === 'Updated from second device' &&
      profile?.avatarMimeType === 'image/png'
  )

  t.is(replicated?.bio, 'Updated from second device')
  t.is(replicated?.avatarMimeType, 'image/png')

  const replicatedAvatar = await waitFor(
    () => primaryIdentity.getAvatar(),
    (avatar) => avatar?.mimeType === 'image/png'
  )
  t.alike(replicatedAvatar?.data, Buffer.from('linked-avatar-b'))
})

test('connect bundles include a reusable consumer grant', async (t) => {
  const { manager } = await createManager(t, 'facebonk-consumer-grant-')

  await manager.initIdentity({
    displayName: 'Grant Bonk',
    bio: 'Reusable auth grant'
  })

  const bundle = await manager.createConnectBundle({
    audience: 'bonk-docs-test',
    nonce: 'grant-test'
  })

  const verifiedGrant = await verifyConsumerGrant(bundle.grant, {
    audience: 'bonk-docs-test'
  })

  t.ok(bundle.grant.startsWith('facebonk-grant:'), 'grant token returned')
  t.is(verifiedGrant.payload.profileKey.length, 64)
  t.is(verifiedGrant.payload.audience, 'bonk-docs-test')
})

test('refreshConsumerProfile returns unchanged when hashes match and profile when they do not', async (t) => {
  const { manager } = await createManager(t, 'facebonk-refresh-profile-')

  await manager.initIdentity({
    displayName: 'Refresh Bonk',
    bio: 'Before refresh'
  })

  const bundle = await manager.createConnectBundle({
    audience: 'bonk-docs-test',
    nonce: 'refresh-test'
  })

  const unchanged = await manager.refreshConsumerProfile({
    audience: 'bonk-docs-test',
    grant: bundle.grant,
    knownProfileDocumentHash: '0'.repeat(64)
  })

  t.is(unchanged.changed, true, 'incorrect hash forces a refresh payload')

  const changed = await manager.refreshConsumerProfile({
    audience: 'bonk-docs-test',
    grant: bundle.grant
  })

  t.is(changed.changed, true, 'refresh returns a profile payload')
  t.is(changed.profileDocument?.payload?.displayName, 'Refresh Bonk')

  const stable = await manager.refreshConsumerProfile({
    audience: 'bonk-docs-test',
    grant: bundle.grant,
    knownProfileDocumentHash: hashProfileDocument(changed.profileDocument)
  })

  t.is(stable.changed, false, 'matching hash reports unchanged')
})

test('revoking a linked device removes its write access', async (t) => {
  const first = await createManager(t, 'facebonk-revoke-a-')
  const second = await createManager(t, 'facebonk-revoke-b-')

  const primaryIdentity = await first.manager.initIdentity({
    displayName: 'Revoker'
  })
  const invite = await primaryIdentity.createLinkInvite()
  const linkedIdentity = await second.manager.joinIdentity(invite)

  await waitFor(
    () => primaryIdentity.listDevices(),
    (rows) => rows.length === 2
  )

  await waitFor(
    () => linkedIdentity.getRoles(linkedIdentity.writerKey),
    (roles) => roles.includes('owner'),
    10000
  )

  const revoked = await primaryIdentity.revokeDevice(linkedIdentity.writerKey)
  t.ok(revoked, 'revocation succeeds')

  const devices = await waitFor(
    () => primaryIdentity.listDevices(),
    (rows) => rows.length === 1
  )
  t.is(devices.length, 1, 'only one owner remains')

  const linkedRoles = await waitFor(
    () => linkedIdentity.getRoles(linkedIdentity.writerKey),
    (roles) => !roles.includes('owner'),
    10000
  )
  t.ok(!linkedRoles.includes('owner'), 'linked device loses owner role locally')

  const profile = await primaryIdentity.getProfile()
  t.is(profile?.displayName, 'Revoker', 'linked device can no longer overwrite profile')
})

test('createConnectBundle returns a small proof, signed profile document, and separate avatar asset', async (t) => {
  const { manager } = await createManager(t, 'facebonk-connect-')

  const identity = await manager.initIdentity({
    displayName: 'Sharer',
    bio: 'Signed profile export'
  })
  const avatarBytes = Buffer.from('share-avatar')
  await identity.setAvatar(avatarBytes, { mimeType: 'image/png' })

  const bundle = await manager.createConnectBundle({
    audience: 'consumer-app',
    nonce: 'nonce-123'
  })
  const verified = await verifyConnectBundle(bundle, {
    audience: 'consumer-app',
    nonce: 'nonce-123'
  })
  const summary = profileSummaryFromProfileDocument(verified.profileDocument)
  const avatarAsset = await manager.getAvatarAsset()

  t.ok(bundle.proof.startsWith('facebonk-connect:'), 'proof uses connect prefix')
  t.is(summary.profile.displayName, 'Sharer')
  t.is(summary.profile.bio, 'Signed profile export')
  t.is(summary.profile.avatar?.mimeType, 'image/png')
  t.ok(verifyAssetBytes(summary.profile.avatar, avatarAsset.data), 'avatar bytes match signed ref')
})

import { rm } from 'fs/promises'
import test from 'brittle'
import { IdentityContext, IdentityManager } from '../src/index.js'
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

test('link invite joins a second device onto the same identity', async (t) => {
  const first = await createManager(t, 'facebonk-link-a-')
  const second = await createManager(t, 'facebonk-link-b-')

  const primaryIdentity = await first.manager.initIdentity({
    displayName: 'Linked Human',
    bio: 'Original profile'
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
    (profile) => profile?.displayName === 'Linked Human'
  )

  t.is(linkedProfile?.bio, 'Original profile')

  await linkedIdentity.setProfile({
    displayName: 'Linked Human Updated',
    bio: 'Updated from second device'
  })

  const replicated = await waitFor(
    () => primaryIdentity.getProfile(),
    (profile) => profile?.displayName === 'Linked Human Updated'
  )

  t.is(replicated?.bio, 'Updated from second device')
})

test('revoking a linked device removes its write access', async (t) => {
  const first = await createManager(t, 'facebonk-revoke-a-')
  const second = await createManager(t, 'facebonk-revoke-b-')

  const primaryIdentity = await first.manager.initIdentity({
    displayName: 'Revoker'
  })

  const linkedIdentity = new IdentityContext(second.manager.corestore.namespace('linked-device'), {
    schema: second.manager.schema,
    key: primaryIdentity.key,
    encryptionKey: primaryIdentity.encryptionKey,
    bootstrap: second.manager.bootstrap,
    autobase: second.manager.autobase,
    blindPeering: second.manager.blindPeering
  })
  await linkedIdentity.ready()

  t.teardown(async () => {
    await linkedIdentity.close()
  })

  await primaryIdentity.addWriter(linkedIdentity.writerKey)
  await primaryIdentity.grantRoles(linkedIdentity.writerKey, ['owner'])

  await waitFor(
    () => primaryIdentity.listDevices(),
    (rows) => rows.length === 2
  )

  await waitFor(
    () => linkedIdentity.getRoles(linkedIdentity.writerKey),
    (roles) => roles.includes('owner')
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
    (roles) => !roles.includes('owner')
  )
  t.ok(!linkedRoles.includes('owner'), 'linked device loses owner role locally')

  try {
    await linkedIdentity.setProfile({ displayName: 'Should Fail' })
    t.fail('revoked device should not update profile')
  } catch (error) {
    t.is(error?.name, 'PermissionError')
  }

  const profile = await primaryIdentity.getProfile()
  t.is(profile?.displayName, 'Revoker', 'linked device can no longer overwrite profile')
})

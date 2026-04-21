require('bare-process/global')

const fs = require('fs')
const path = require('path')
const Pipe = require('bare-pipe')
const PearRuntimeHost = require('./pear-runtime-host.cjs')
const { command, flag } = require('paparam', { with: { imports: './package.json' } })
const { isLinux, isMac, isWindows } = require('which-runtime', {
  with: { imports: './package.json' },
})
const { Buffer } = require('bare-buffer')

const appMeta = require('../pear.app.json')

function log(message, details = null) {
  if (details === null || details === undefined) {
    console.error(`[facebonk-backend] ${message}`)
    return
  }

  console.error(`[facebonk-backend] ${message}`, details)
}

function logError(message, error) {
  console.error(`[facebonk-backend] ${message}`, error?.stack || error)
}

const cmd = command(
  appMeta.productName,
  flag('--storage <path>', 'path to runtime storage'),
  flag('--socket <path>', 'local IPC socket path for the Pear bridge'),
  flag('--app-path <path>', 'packaged app path for pear-runtime applyUpdate'),
  flag('--updates', 'enable OTA updates'),
  flag('--no-updates', 'disable OTA updates')
)

cmd.parse(process.argv.slice(2))

if (!cmd.flags.storage) throw new Error('missing required --storage argument')
if (!cmd.flags.socket) throw new Error('missing required --socket argument')

const socketPath = cmd.flags.socket

const pear = new PearRuntimeHost({
  dir: cmd.flags.storage,
  app: cmd.flags.appPath || null,
  updates: cmd.flags.updates,
  version: appMeta.version,
  upgrade: appMeta.upgrade,
  name: appMeta.productName + extension(),
})

pear.on('error', (error) => {
  console.error('[pear-runtime-host]', error)
})

const runtimeState = {
  launchCount: 0,
  requestCount: 0,
  lastRequestMethod: null,
  lastRequestAtUnixMs: null,
  updating: false,
  updated: false,
  updatesEnabled: cmd.flags.updates,
}

const facebonkDir = path.join(pear.storage, 'facebonk')
const managerPromise = openManager(facebonkDir)

log('starting backend', {
  storage: cmd.flags.storage,
  socketPath,
  facebonkDir,
  updatesEnabled: cmd.flags.updates
})

pear.updater.on('updating', () => {
  runtimeState.updating = true
})

pear.updater.on('updated', () => {
  runtimeState.updating = false
  runtimeState.updated = true
})

fs.rmSync(socketPath, { force: true })

const server = Pipe.createServer((pipe) => {
  handlePipe(pipe).catch((error) => {
    logError('request failed', error)
    pipe.end(JSON.stringify({ ok: false, error: error.message }))
  })
})

server.once('error', (error) => {
  logError('failed to listen', error)
  process.exit(1)
})

server.listen(socketPath, () => {
  log(`listening on unix socket ${socketPath}`)
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', (error) => {
  logError('uncaught exception', error)
})
process.on('unhandledRejection', (error) => {
  logError('unhandled rejection', error)
})

async function handlePipe(pipe) {
  const body = await readPipeBody(pipe)
  let payload = null

  try {
    payload = JSON.parse(body || '{}')
  } catch (error) {
    pipe.end(JSON.stringify({ ok: false, error: `invalid JSON: ${error.message}` }))
    return
  }

  if (typeof payload.method !== 'string' || payload.method.length === 0) {
    pipe.end(JSON.stringify({ ok: false, error: 'missing method' }))
    return
  }

  try {
    log(`request ${payload.method}`, summarizeParams(payload.method, payload.params || {}))
    const result = await handleRequest(payload.method, payload.params || {})
    log(`request ${payload.method} complete`, summarizeResult(payload.method, result))
    pipe.end(JSON.stringify({ ok: true, result }))
  } catch (error) {
    logError(`request ${payload.method} failed`, error)
    pipe.end(JSON.stringify({ ok: false, error: error.message }))
  }
}

async function handleRequest(method, params) {
  if (method === 'get_runtime_state') {
    return {
      pearDir: pear.dir,
      appStorage: pear.storage,
      facebonkDir,
      updatesEnabled: runtimeState.updatesEnabled,
      updating: runtimeState.updating,
      updated: runtimeState.updated,
      appPath: cmd.flags.appPath || null,
      bridgeSocket: socketPath,
    }
  }

  if (method === 'apply_update') {
    await pear.updater.applyUpdate()
    return { applied: true }
  }

  return await handleFacebonkRequest(method, params || {})
}

function readPipeBody(pipe) {
  return new Promise((resolve, reject) => {
    const chunks = []
    pipe.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk))
    })
    pipe.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    pipe.on('error', reject)
  })
}

async function shutdown() {
  log('shutting down')
  server.close()
  fs.rmSync(socketPath, { force: true })
  const manager = await managerPromise.catch(() => null)
  if (manager) await manager.close().catch(() => {})
  await pear.close().catch(() => {})
  process.exit(0)
}

function extension() {
  if (isLinux) return '.AppImage'
  if (isMac) return '.app'
  if (isWindows) return '.msix'
  return ''
}

async function openManager(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true })
  const modulePath = path.join(__dirname, '..', 'core', 'index.js')
  const { IdentityManager } = await import(modulePath)
  const manager = new IdentityManager(baseDir)
  await manager.ready()
  runtimeState.launchCount += 1
  log('manager ready', { launchCount: runtimeState.launchCount, baseDir })
  return manager
}

async function handleFacebonkRequest(method, params) {
  runtimeState.requestCount += 1
  runtimeState.lastRequestMethod = method
  runtimeState.lastRequestAtUnixMs = Date.now()

  const manager = await managerPromise

  if (method === 'ping') {
    return {
      message: 'Hello from the Facebonk backend',
      pearStorage: pear.storage,
      facebonkDir,
      launchCount: runtimeState.launchCount,
      requestCount: runtimeState.requestCount,
      echo: params,
    }
  }

  if (method === 'get_state') {
    return await getAppState(manager)
  }

  if (method === 'create_identity') {
    await manager.initIdentity({
      displayName: params.displayName,
      bio: params.bio,
    })
    return await getAppState(manager)
  }

  if (method === 'link_identity') {
    const invite = String(params.invite || '').trim()
    if (!invite) throw new Error('Invite is required')
    await manager.joinIdentity(invite)
    return await getAppState(manager)
  }

  if (method === 'update_profile') {
    const identity = await requireIdentity(manager)
    await identity.setProfile({
      displayName: params.displayName,
      bio: params.bio,
    })
    return await getAppState(manager)
  }

  if (method === 'set_avatar') {
    const identity = await requireIdentity(manager)
    const base64 = String(params.base64 || '').trim()
    if (!base64) throw new Error('Avatar base64 is required')
    const mimeType = typeof params.mimeType === 'string' ? params.mimeType : null
    await identity.setAvatar(Buffer.from(base64, 'base64'), { mimeType })
    return await getAppState(manager)
  }

  if (method === 'clear_avatar') {
    const identity = await requireIdentity(manager)
    await identity.clearAvatar()
    return await getAppState(manager)
  }

  if (method === 'create_link_invite') {
    const identity = await requireIdentity(manager)
    const invite = await identity.createLinkInvite()
    return { invite }
  }

  if (method === 'create_connect_bundle') {
    return {
      ...(await manager.createConnectBundle({
        audience: params.audience,
        nonce: params.nonce,
        expiresAt: params.expiresAt,
      })),
      avatarAsset: await manager.getAvatarAsset(),
    }
  }

  if (method === 'revoke_device') {
    const identity = await requireIdentity(manager)
    const writerKey = String(params.writerKey || '').trim()
    if (!writerKey) throw new Error('Writer key is required')
    const revoked = await identity.revokeDevice(writerKey)
    return {
      revoked,
      state: await getAppState(manager),
    }
  }

  throw new Error(`unknown method: ${method}`)
}

async function requireIdentity(manager) {
  const identity = await manager.getActiveIdentity()
  if (!identity) throw new Error('No identity initialized')
  return identity
}

function summarizeParams(method, params) {
  if (method === 'link_identity') {
    return { inviteLength: typeof params.invite === 'string' ? params.invite.length : 0 }
  }

  if (method === 'create_identity' || method === 'update_profile') {
    return {
      displayName: params.displayName ?? null,
      bioLength: typeof params.bio === 'string' ? params.bio.length : 0
    }
  }

  if (method === 'set_avatar') {
    return {
      mimeType: params.mimeType ?? null,
      base64Length: typeof params.base64 === 'string' ? params.base64.length : 0
    }
  }

  if (method === 'revoke_device') {
    return { writerKey: params.writerKey ?? null }
  }

  if (method === 'create_connect_bundle') {
    return {
      audience: params.audience ?? null,
      nonceLength: typeof params.nonce === 'string' ? params.nonce.length : 0,
    }
  }

  return null
}

function summarizeResult(method, result) {
  if (method === 'link_identity' || method === 'create_identity' || method === 'update_profile') {
    return {
      initialized: result?.initialized ?? null,
      identityKey: result?.summary?.identityKey ?? null,
      deviceCount: result?.summary?.devices?.length ?? 0
    }
  }

  if (method === 'create_link_invite') {
    return { inviteLength: typeof result?.invite === 'string' ? result.invite.length : 0 }
  }

  if (method === 'create_connect_bundle') {
    return {
      proofLength: typeof result?.proof === 'string' ? result.proof.length : 0,
      hasAvatarAsset: Boolean(result?.avatarAsset?.asset),
    }
  }

  if (method === 'set_avatar' || method === 'clear_avatar') {
    return {
      identityKey: result?.summary?.identityKey ?? null,
      hasAvatar: Boolean(result?.summary?.profile?.avatarDataUrl)
    }
  }

  if (method === 'revoke_device') {
    return {
      revoked: Boolean(result?.revoked),
      deviceCount: result?.state?.summary?.devices?.length ?? 0
    }
  }

  return null
}

async function getAppState(manager) {
  const summary = await manager.getSummary()
  const identity = await manager.getActiveIdentity()
  const avatar = identity ? await identity.getAvatar() : null

  return {
    pearStorage: pear.storage,
    facebonkDir,
    launchCount: runtimeState.launchCount,
    requestCount: runtimeState.requestCount,
    lastRequestMethod: runtimeState.lastRequestMethod,
    lastRequestAtUnixMs: runtimeState.lastRequestAtUnixMs,
    initialized: !!summary,
    summary: summary
      ? {
          ...summary,
          profile: {
            ...summary.profile,
            avatarDataUrl:
              avatar?.data && avatar.data.length > 0
                ? `data:${avatar.mimeType || 'application/octet-stream'};base64,${avatar.data.toString('base64')}`
                : null,
          },
        }
      : null,
  }
}

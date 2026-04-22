import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

import {
  createFacebonkAuthUrl,
  createFacebonkRefreshUrl
} from '../core/index.js'
import {
  connectFacebonkSession,
  profileFromFacebonkSession,
  refreshFacebonkSession,
  restoreFacebonkSession
} from '../consumer-core/index.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PATH = '/facebonk-auth'
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
const MAX_BODY_BYTES = 16 * 1024 * 1024

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function randomState() {
  return randomBytes(16).toString('hex')
}

function sendJsonError(res, statusCode, message) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: message }))
}

function sendPlainText(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(body)
}

async function readRequestBody(req) {
  let size = 0
  const chunks = []

  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      throw new Error('Auth payload is too large')
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function normalizeConnectPayload(payload, expectedState) {
  const state = normalizeText(payload?.state)
  if (!state) throw new Error('Auth state is required')
  if (state !== expectedState) throw new Error('Auth state did not match')

  const proof = normalizeText(payload?.proof)
  if (!proof) throw new Error('Facebonk connect proof is required')

  const grant = normalizeText(payload?.grant)
  if (!grant) throw new Error('Facebonk consumer grant is required')

  const profileDocument =
    payload?.profileDocument &&
    typeof payload.profileDocument === 'object' &&
    !Array.isArray(payload.profileDocument)
      ? payload.profileDocument
      : null
  if (!profileDocument) {
    throw new Error('Facebonk profile document is required')
  }

  return {
    state,
    proof,
    grant,
    profileDocument,
    avatarUrl: normalizeText(payload?.avatarUrl) || null
  }
}

function normalizeRefreshPayload(payload, expectedState) {
  const state = normalizeText(payload?.state)
  if (!state) throw new Error('Auth state is required')
  if (state !== expectedState) throw new Error('Auth state did not match')

  if (payload?.changed !== true) {
    return { state, changed: false }
  }

  const profileDocument =
    payload?.profileDocument &&
    typeof payload.profileDocument === 'object' &&
    !Array.isArray(payload.profileDocument)
      ? payload.profileDocument
      : null
  if (!profileDocument) {
    throw new Error('Facebonk profile document is required')
  }

  return {
    state,
    changed: true,
    profileDocument,
    avatarUrl: normalizeText(payload?.avatarUrl) || null
  }
}

function parsePayload(raw, expectedState, mode) {
  let payload = null
  try {
    payload = JSON.parse(raw || '{}')
  } catch {
    throw new Error('Auth payload must be valid JSON')
  }

  return mode === 'refresh'
    ? normalizeRefreshPayload(payload, expectedState)
    : normalizeConnectPayload(payload, expectedState)
}

function defaultReturnToUrl() {
  return null
}

async function defaultFetchAvatarBytes(avatarUrl) {
  const target = new URL(avatarUrl)
  const transport =
    target.protocol === 'https:' ? await import('node:https') : await import('node:http')

  return await new Promise((resolve, reject) => {
    const req = transport.request(target, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body)
          return
        }
        reject(new Error(body.toString('utf8') || `Request failed: ${res.statusCode}`))
      })
    })

    req.on('error', reject)
    req.end()
  })
}

function createSessionHandle(session, options) {
  let current = session

  return {
    profileKey: current.profileKey,
    async getProfile() {
      return profileFromFacebonkSession(current)
    },
    async refresh() {
      if (!current) throw new Error('No Facebonk session is loaded')

      const authSession = await createFacebonkAuthSession({
        mode: 'refresh',
        clientId: options.clientId,
        state: options.randomState?.() ?? randomState(),
        host: options.host,
        callbackPath: options.callbackPath,
        timeoutMs: options.timeoutMs,
        getReturnToUrl: options.getReturnToUrl,
        grant: current.grant,
        knownProfileDocumentHash: current.profileDocumentHash
      })

      try {
        await options.openUrl(authSession.launchUrl)
        const payload = await authSession.waitForPayload()
        const refreshed = await refreshFacebonkSession(current, payload, {
          clientId: options.clientId,
          fetchAvatarBytes: options.fetchAvatarBytes
        })
        current = refreshed.session
        if (refreshed.changed) {
          await options.storage.save(current)
        }
        return {
          changed: refreshed.changed,
          profile: profileFromFacebonkSession(current)
        }
      } finally {
        await authSession.close().catch(() => {})
      }
    },
    async disconnect() {
      current = null
      await options.storage.clear()
    }
  }
}

export async function createFacebonkAuthSession(options = {}) {
  const mode = options.mode === 'refresh' ? 'refresh' : 'connect'
  const state = normalizeText(options.state) || randomState()
  const clientId = normalizeText(options.clientId)
  if (!clientId) throw new Error('Facebonk clientId is required')

  const host = normalizeText(options.host) || DEFAULT_HOST
  const callbackPath = normalizeText(options.callbackPath) || DEFAULT_PATH
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? Math.max(1, Math.floor(options.timeoutMs))
      : DEFAULT_TIMEOUT_MS
  const getReturnToUrl =
    typeof options.getReturnToUrl === 'function'
      ? options.getReturnToUrl
      : defaultReturnToUrl

  let settled = false
  let resolvePayload = null
  let rejectPayload = null
  let timeoutId = null
  let server = null

  const payloadPromise = new Promise((resolve, reject) => {
    resolvePayload = resolve
    rejectPayload = reject
  })

  async function close() {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = null
    if (!server) return
    const current = server
    server = null
    await new Promise((resolve) => current.close(resolve))
  }

  function finish(error, value) {
    if (settled) return
    settled = true
    if (error) rejectPayload(error)
    else resolvePayload(value)
  }

  server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
      if (requestUrl.pathname !== callbackPath) {
        sendJsonError(res, 404, 'Not found')
        return
      }

      if (req.method !== 'POST') {
        sendJsonError(res, 405, 'Method not allowed')
        return
      }

      const raw = await readRequestBody(req)
      const payload = parsePayload(raw, state, mode)
      sendPlainText(
        res,
        200,
        mode === 'refresh'
          ? 'Facebonk profile refreshed. You can return to the app.'
          : 'Facebonk linked. You can return to the app.'
      )
      finish(null, payload)
      await close()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Facebonk auth failed'
      sendJsonError(res, 400, message)
      finish(new Error(message))
      await close()
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => {
      server.off('error', reject)
      resolve(true)
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await close()
    throw new Error('Facebonk auth session did not bind a loopback port')
  }

  timeoutId = setTimeout(() => {
    finish(new Error('Timed out waiting for Facebonk approval'))
    void close()
  }, timeoutMs)

  const callbackUrl = new URL(callbackPath, `http://${host}:${address.port}`)
  const returnTo = getReturnToUrl({ mode, state })
  const launchUrl =
    mode === 'refresh'
      ? createFacebonkRefreshUrl({
          callbackUrl: callbackUrl.toString(),
          state,
          client: clientId,
          grant: options.grant,
          knownProfileDocumentHash: options.knownProfileDocumentHash,
          returnTo
        })
      : createFacebonkAuthUrl({
          callbackUrl: callbackUrl.toString(),
          state,
          client: clientId,
          returnTo
        })

  return {
    mode,
    state,
    callbackUrl: callbackUrl.toString(),
    launchUrl,
    waitForPayload() {
      return payloadPromise
    },
    close
  }
}

export function createFacebonkClient(options = {}) {
  const clientId = normalizeText(options.clientId)
  if (!clientId) throw new Error('Facebonk clientId is required')

  const appName = normalizeText(options.appName)
  if (!appName) throw new Error('Facebonk appName is required')

  if (!options.storage || typeof options.storage.load !== 'function') {
    throw new Error('Facebonk storage.load is required')
  }
  if (typeof options.storage.save !== 'function') {
    throw new Error('Facebonk storage.save is required')
  }
  if (typeof options.storage.clear !== 'function') {
    throw new Error('Facebonk storage.clear is required')
  }
  if (typeof options.openUrl !== 'function') {
    throw new Error('Facebonk openUrl is required')
  }

  const clientOptions = {
    clientId,
    appName,
    storage: options.storage,
    openUrl: options.openUrl,
    host: normalizeText(options.host) || DEFAULT_HOST,
    callbackPath: normalizeText(options.callbackPath) || DEFAULT_PATH,
    timeoutMs:
      typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
        ? Math.max(1, Math.floor(options.timeoutMs))
        : DEFAULT_TIMEOUT_MS,
    fetchAvatarBytes:
      typeof options.fetchAvatarBytes === 'function'
        ? options.fetchAvatarBytes
        : defaultFetchAvatarBytes,
    getReturnToUrl:
      typeof options.getReturnToUrl === 'function'
        ? options.getReturnToUrl
        : defaultReturnToUrl,
    randomState:
      typeof options.randomState === 'function' ? options.randomState : randomState
  }

  return {
    async authenticate() {
      const authSession = await createFacebonkAuthSession({
        mode: 'connect',
        clientId: clientOptions.clientId,
        state: clientOptions.randomState(),
        host: clientOptions.host,
        callbackPath: clientOptions.callbackPath,
        timeoutMs: clientOptions.timeoutMs,
        getReturnToUrl: clientOptions.getReturnToUrl
      })

      try {
        await clientOptions.openUrl(authSession.launchUrl)
        const payload = await authSession.waitForPayload()
        const session = await connectFacebonkSession(payload, {
          clientId: clientOptions.clientId,
          nonce: authSession.state,
          fetchAvatarBytes: clientOptions.fetchAvatarBytes
        })
        await clientOptions.storage.save(session)
        return createSessionHandle(session, clientOptions)
      } finally {
        await authSession.close().catch(() => {})
      }
    },

    async restore() {
      const stored = await clientOptions.storage.load()
      if (!stored) return null

      try {
        const session = await restoreFacebonkSession(stored, {
          clientId: clientOptions.clientId
        })
        return createSessionHandle(session, clientOptions)
      } catch {
        await clientOptions.storage.clear()
        return null
      }
    }
  }
}

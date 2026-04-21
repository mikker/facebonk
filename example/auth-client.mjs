import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import {
  createFacebonkAuthUrl,
  verifyAssetBytes,
  verifyConnectBundle,
} from '../core/index.js'

const DEFAULT_CLIENT = 'facebonk-example'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PATH = '/facebonk-auth'
const DEFAULT_TIMEOUT_MS = 15_000

function randomState() {
  return randomBytes(16).toString('hex')
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function fetchBuffer(url) {
  const target = new URL(url)
  const transport = target.protocol === 'https:' ? await import('node:https') : await import('node:http')

  return await new Promise((resolve, reject) => {
    const req = transport.request(target, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(Buffer.concat(chunks))
          return
        }
        reject(new Error(Buffer.concat(chunks).toString('utf8') || `Request failed: ${res.statusCode}`))
      })
    })

    req.on('error', reject)
    req.end()
  })
}

export async function createExampleAuthSession(options = {}) {
  const state = typeof options.state === 'string' && options.state.trim()
    ? options.state.trim()
    : randomState()
  const client = typeof options.client === 'string' && options.client.trim()
    ? options.client.trim()
    : DEFAULT_CLIENT
  const host = typeof options.host === 'string' && options.host.trim()
    ? options.host.trim()
    : DEFAULT_HOST
  const callbackPath = typeof options.callbackPath === 'string' && options.callbackPath.trim()
    ? options.callbackPath.trim()
    : DEFAULT_PATH
  const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.floor(options.timeoutMs))
    : DEFAULT_TIMEOUT_MS

  let server = null
  let timeout = null
  let settled = false
  let resolveValue = null
  let rejectValue = null

  const result = new Promise((resolve, reject) => {
    resolveValue = resolve
    rejectValue = reject
  })

  function finish(error, value) {
    if (settled) return
    settled = true
    if (timeout) clearTimeout(timeout)
    if (error) rejectValue(error)
    else resolveValue(value)
  }

  async function close() {
    if (timeout) clearTimeout(timeout)
    timeout = null
    if (!server) return
    const current = server
    server = null
    await new Promise((resolve) => current.close(resolve))
  }

  server = createServer(async (req, res) => {
    try {
      const target = new URL(req.url || '/', 'http://127.0.0.1')
      if (target.pathname !== callbackPath) {
        sendJson(res, 404, { ok: false, error: 'Not found' })
        return
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed' })
        return
      }

      const payload = JSON.parse(await readBody(req) || '{}')
      if (payload?.state !== state) {
        throw new Error('Auth state did not match')
      }

      const verified = await verifyConnectBundle(
        {
          proof: payload?.proof,
          profileDocument: payload?.profileDocument,
        },
        {
          audience: client,
          nonce: state,
        }
      )

      let avatar = null
      if (verified.profileDocument.payload.avatar) {
        if (typeof payload?.avatarUrl !== 'string' || payload.avatarUrl.length === 0) {
          throw new Error('Avatar transport URL is required for profile assets')
        }

        const data = await fetchBuffer(payload.avatarUrl)
        if (!verifyAssetBytes(verified.profileDocument.payload.avatar, data)) {
          throw new Error('Avatar bytes did not match signed asset reference')
        }

        avatar = {
          data,
          mimeType: verified.profileDocument.payload.avatar.mimeType,
          byteLength: data.length,
        }
      }

      sendJson(res, 200, { ok: true })
      finish(null, {
        state,
        proof: payload.proof,
        profileDocument: verified.profileDocument,
        avatar,
      })
      await close()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auth callback failed'
      sendJson(res, 400, { ok: false, error: message })
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
    throw new Error('Example auth session did not bind a loopback port')
  }

  timeout = setTimeout(async () => {
    finish(new Error('Timed out waiting for Facebonk callback'))
    await close()
  }, timeoutMs)

  const callbackUrl = new URL(callbackPath, `http://${host}:${address.port}`)
  const launchUrl = createFacebonkAuthUrl({
    client,
    callbackUrl: callbackUrl.toString(),
    state,
    returnTo: null,
  })

  return {
    state,
    client,
    callbackUrl: callbackUrl.toString(),
    launchUrl,
    waitForConnect() {
      return result
    },
    close,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const session = await createExampleAuthSession()
  console.log(session.launchUrl)
  const value = await session.waitForConnect()
  console.log(JSON.stringify({
    state: value.state,
    profileDocument: value.profileDocument,
    avatar: value.avatar ? {
      mimeType: value.avatar.mimeType,
      byteLength: value.avatar.byteLength,
    } : null,
  }, null, 2))
}

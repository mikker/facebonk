import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, join, dirname } from 'path'
import { fileURLToPath } from 'url'

import {
  createExampleAuthClient
} from '../auth-client.mjs'
import {
  createInMemoryFacebonkSessionStore
} from '../../packages/consumer-core/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sessions = new Map()

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function serveStatic(res, name) {
  const file = join(__dirname, name)
  const body = await readFile(file)
  const type = extname(file) === '.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
  res.writeHead(200, { 'content-type': type })
  res.end(body)
}

async function startSession() {
  const storage = createInMemoryFacebonkSessionStore()
  let resolveLaunch = null
  const launchReady = new Promise((resolve) => {
    resolveLaunch = resolve
  })

  const record = {
    state: null,
    launchUrl: null,
    status: 'pending',
    profile: null,
    error: null,
    close: async () => {},
  }

  const client = await createExampleAuthClient({
    clientId: 'facebonk-consumer-example',
    appName: 'Facebonk Consumer Example',
    timeoutMs: 120000,
    storage,
    openUrl(url) {
      record.launchUrl = url
      record.state = new URL(url).searchParams.get('state')
      if (record.state) sessions.set(record.state, record)
      resolveLaunch?.()
    }
  })

  client.authenticate()
    .then(async (session) => {
      record.profile = await session.getProfile()
      record.status = 'done'
    })
    .catch((error) => {
      record.error = error instanceof Error ? error.message : String(error)
      record.status = 'error'
    })

  await launchReady
  return record
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    if (req.method === 'GET' && url.pathname === '/') {
      await serveStatic(res, 'index.html')
      return
    }

    if (req.method === 'GET' && url.pathname === '/app.js') {
      await serveStatic(res, 'app.js')
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      await readBody(req)
      const session = await startSession()
      sendJson(res, 200, {
        ok: true,
        state: session.state,
        launchUrl: session.launchUrl,
      })
      return
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/session/')) {
      const state = decodeURIComponent(url.pathname.slice('/api/session/'.length))
      const session = sessions.get(state)
      if (!session) {
        sendJson(res, 404, { ok: false, error: 'Session not found' })
        return
      }

      sendJson(res, 200, {
        ok: true,
        state: session.state,
        status: session.status,
        error: session.error,
        launchUrl: session.launchUrl,
        profile: session.profile,
        avatar: session.profile?.avatarUrl
          ? {
              mimeType: 'image/*',
              byteLength: null,
              dataUrl: session.profile.avatarUrl,
            }
          : null,
      })
      return
    }

    sendJson(res, 404, { ok: false, error: 'Not found' })
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  console.log(`Facebonk consumer example: http://127.0.0.1:${port}`)
})

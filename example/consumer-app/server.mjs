import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createExampleAuthSession } from '../auth-client.mjs'

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
  const session = await createExampleAuthSession({
    client: 'facebonk-consumer-example',
    timeoutMs: 120000,
  })

  const record = {
    state: session.state,
    launchUrl: session.launchUrl,
    status: 'pending',
    token: null,
    profile: null,
    error: null,
    close: session.close,
  }

  sessions.set(session.state, record)

  session.waitForConnect()
    .then(async ({ proof, profileDocument, avatar }) => {
      record.proof = proof
      record.profileDocument = profileDocument
      record.avatar = avatar
      record.status = 'done'
    })
    .catch((error) => {
      record.error = error instanceof Error ? error.message : String(error)
      record.status = 'error'
    })
    .finally(async () => {
      await session.close().catch(() => {})
    })

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
        profile: session.profileDocument?.payload ?? null,
        avatar: session.avatar
          ? {
              mimeType: session.avatar.mimeType,
              byteLength: session.avatar.byteLength,
              dataUrl: `data:${session.avatar.mimeType || 'application/octet-stream'};base64,${session.avatar.data.toString('base64')}`,
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

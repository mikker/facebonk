import test from 'brittle'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { verifyConnectBundle } from '../core/index.js'
import { createExampleAuthSession } from '../example/auth-client.mjs'
import { createTempDir } from './helpers/temp-dir.js'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const repoRoot = resolve(process.cwd())

function waitForOutput(child, pattern, timeoutMs = 15000) {
  const matcher =
    pattern instanceof RegExp ? (text) => pattern.test(text) : (text) => text.includes(pattern)

  return new Promise((resolve, reject) => {
    let combined = ''
    let settled = false

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for output: ${pattern}\n${combined}`))
    }, timeoutMs)

    const onData = (chunk) => {
      combined += chunk.toString('utf8')
      if (!matcher(combined)) return
      cleanup()
      resolve(combined)
    }

    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`Process exited before expected output (code=${code} signal=${signal})\n${combined}`))
    }

    const cleanup = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.stdout?.removeListener('data', onData)
      child.stderr?.removeListener('data', onData)
      child.removeListener('exit', onExit)
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', onExit)
  })
}

async function terminateProcess(child) {
  if (!child || child.killed) return

  child.kill('SIGTERM')
  const timeout = setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL')
  }, 2000)

  try {
    await once(child, 'exit')
  } catch {}

  clearTimeout(timeout)
}

test('example auth client completes the desktop auth flow end-to-end', async (t) => {
  const storageDir = await createTempDir('facebonk-e2e-storage-')
  const env = {
    ...process.env,
    FACEBONK_TEST_HEADLESS: '1',
    FACEBONK_TEST_AUTO_APPROVE_AUTH: '1',
    FACEBONK_TEST_DISABLE_SINGLE_INSTANCE: '1',
    FACEBONK_TEST_BOOTSTRAP_PROFILE_JSON: JSON.stringify({
      displayName: 'E2E Bonk',
      bio: 'Approved by the desktop app',
    }),
  }

  const session = await createExampleAuthSession({ timeoutMs: 15000 })
  t.teardown(async () => {
    await session.close()
  })

  const app = spawn(
    electronBinary,
    ['.', session.launchUrl, '--storage', storageDir, '--no-updates'],
    {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  t.teardown(async () => {
    await terminateProcess(app)
  })

  await waitForOutput(app, 'manager ready')

  const result = await session.waitForConnect()
  const verified = await verifyConnectBundle(
    {
      proof: result.proof,
      profileDocument: result.profileDocument,
    },
    {
      audience: session.client,
      nonce: session.state,
    }
  )

  t.ok(result.proof.startsWith('facebonk-connect:'), 'proof returned from desktop app')
  t.is(verified.profileDocument.payload.displayName, 'E2E Bonk')
  t.is(verified.profileDocument.payload.bio, 'Approved by the desktop app')
})

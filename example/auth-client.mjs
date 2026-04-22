import { pathToFileURL } from 'node:url'

import {
  createFacebonkClient
} from '../consumer-electron/index.js'
import { createInMemoryFacebonkSessionStore } from '../consumer-core/index.js'

const DEFAULT_CLIENT = 'facebonk-example'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PATH = '/facebonk-auth'
const DEFAULT_TIMEOUT_MS = 15_000

export async function createExampleAuthClient(options = {}) {
  const clientId =
    typeof options.clientId === 'string' && options.clientId.trim()
      ? options.clientId.trim()
      : DEFAULT_CLIENT
  const appName =
    typeof options.appName === 'string' && options.appName.trim()
      ? options.appName.trim()
      : 'Facebonk Example'
  const host =
    typeof options.host === 'string' && options.host.trim()
      ? options.host.trim()
      : DEFAULT_HOST
  const callbackPath =
    typeof options.callbackPath === 'string' && options.callbackPath.trim()
      ? options.callbackPath.trim()
      : DEFAULT_PATH
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? Math.max(1, Math.floor(options.timeoutMs))
      : DEFAULT_TIMEOUT_MS
  const storage = options.storage ?? createInMemoryFacebonkSessionStore()

  let latestLaunchUrl = null

  const client = createFacebonkClient({
    clientId,
    appName,
    storage,
    host,
    callbackPath,
    timeoutMs,
    openUrl: async (url) => {
      latestLaunchUrl = url
      if (typeof options.openUrl === 'function') {
        await options.openUrl(url)
      }
    }
  })

  return {
    clientId,
    appName,
    storage,
    getLaunchUrl() {
      return latestLaunchUrl
    },
    authenticate() {
      return client.authenticate()
    },
    restore() {
      return client.restore()
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const example = await createExampleAuthClient({
    openUrl(url) {
      console.log(url)
    }
  })

  const session = await example.authenticate()
  console.log(
    JSON.stringify(
      {
        launchUrl: example.getLaunchUrl(),
        profile: await session.getProfile(),
        storedSession: await example.storage.load()
      },
      null,
      2
    )
  )
}

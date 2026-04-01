import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'

const APP_NAME = 'facebonk'

function getPearStorage() {
  const pear = globalThis.Pear
  if (!pear || typeof pear !== 'object') return null

  if (typeof pear.storage === 'string' && pear.storage.length > 0) {
    return pear.storage
  }

  if (pear.config && typeof pear.config.storage === 'string' && pear.config.storage.length > 0) {
    return pear.config.storage
  }

  return null
}

function defaultProductionDir(appName = APP_NAME, platform = process.platform) {
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName)
  }

  if (platform === 'linux') {
    return join(homedir(), '.config', appName)
  }

  return join(homedir(), 'AppData', 'Local', appName)
}

export function defaultStorageDir(options = {}) {
  const {
    appName = APP_NAME,
    env = process.env,
    platform = process.platform,
    pearStorage = getPearStorage()
  } = options

  if (typeof pearStorage === 'string' && pearStorage.length > 0) {
    return pearStorage
  }

  if (typeof env.FACEBONK_DIR === 'string' && env.FACEBONK_DIR.length > 0) {
    return resolve(env.FACEBONK_DIR)
  }

  const nodeEnv = env.NODE_ENV
  const isProduction = nodeEnv === 'production'

  if (!isProduction) {
    return join(tmpdir(), 'pear', appName)
  }

  return defaultProductionDir(appName, platform)
}

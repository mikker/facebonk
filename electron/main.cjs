const { app, BrowserWindow, ipcMain, shell } = require('electron')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const pkg = require('../package.json')

const appName = pkg.productName || pkg.name
const protocol = pkg.name
const projectRoot = path.join(__dirname, '..')
const testFlags = {
  headless: process.env.FACEBONK_TEST_HEADLESS === '1',
  autoApproveAuth: process.env.FACEBONK_TEST_AUTO_APPROVE_AUTH === '1',
  disableSingleInstance: process.env.FACEBONK_TEST_DISABLE_SINGLE_INSTANCE === '1',
  bootstrapProfile: parseJsonEnv('FACEBONK_TEST_BOOTSTRAP_PROFILE_JSON'),
}

const state = {
  storageOverride: parseStorageOverride(),
  updatesEnabled: parseUpdatesEnabled(),
  backendSocketPath: backendSocketPath(),
  backend: null,
  pendingAuthUrls: collectAuthUrlsFromArgs(process.argv),
  quitting: false,
}

if (state.storageOverride) {
  app.setPath('userData', state.storageOverride)
}

ipcMain.handle('app:info', async () => appInfo())
ipcMain.handle('backend:request', async (event, method, params = {}) => backendRequest(method, params))
ipcMain.handle('auth:consumePendingUrl', async () => consumePendingAuthUrl())
ipcMain.handle('auth:approveConnectRequest', async (event, request) => approveConnectRequest(request))
ipcMain.handle('app:openExternalUrl', async (event, url) => openExternalUrl(url))

function parseJsonEnv(name) {
  const value = process.env[name]
  if (!value) return null

  try {
    return JSON.parse(value)
  } catch (error) {
    console.error(`[facebonk-electron] failed to parse ${name}:`, error)
    return null
  }
}

function parseStorageOverride() {
  const args = process.argv.slice(1)

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--storage') return args[i + 1] || null
    if (typeof arg === 'string' && arg.startsWith('--storage=')) return arg.slice('--storage='.length)
  }

  return process.env.FACEBONK_STORAGE || null
}

function parseUpdatesEnabled() {
  const args = process.argv.slice(1)
  if (args.includes('--updates')) return true
  if (args.includes('--no-updates')) return false
  return !app.isPackaged
}

function collectAuthUrlsFromArgs(args) {
  return args.filter((arg) => typeof arg === 'string' && arg.startsWith(protocol + '://'))
}

function backendSocketPath() {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\facebonk-${process.pid}`
  }

  return path.join(os.tmpdir(), `facebonk-${process.pid}.sock`)
}

function appInfo() {
  return {
    storageDir: app.getPath('userData'),
    storageOverride: state.storageOverride,
    updatesEnabled: state.updatesEnabled,
    bridge: 'Electron preload -> IPC main -> Bare runtime host',
    backendTransport:
      process.platform === 'win32'
        ? 'Electron main forwards JSON RPC to the Facebonk Bare host over a local named pipe'
        : 'Electron main forwards JSON RPC to the Facebonk Bare host over a local Unix socket',
  }
}

function safeWriteStream(stream, chunk) {
  if (!stream || stream.destroyed || stream.writableEnded) return

  try {
    stream.write(chunk)
  } catch (error) {
    if (error?.code !== 'EPIPE') throw error
  }
}

async function ensureBackend() {
  if (state.backend && !state.backend.killed) return state.backend

  const backend = spawn(resolveBareBinary(), backendArgs(), {
    cwd: resolveAppRoot(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  backend.stdout.on('data', (chunk) => safeWriteStream(process.stdout, chunk))
  backend.stderr.on('data', (chunk) => safeWriteStream(process.stderr, chunk))

  backend.once('exit', (code, signal) => {
    state.backend = null
    if (!state.quitting) {
      console.error(`[facebonk-electron] backend exited code=${code} signal=${signal}`)
    }
  })

  state.backend = backend
  await waitForBackendReady()
  return backend
}

function backendArgs() {
  const args = [
    resolveBackendScript(),
    '--storage',
    app.getPath('userData'),
    '--socket',
    state.backendSocketPath,
  ]

  const packagedAppPath = getPackagedAppPath()
  if (packagedAppPath) {
    args.push('--app-path', packagedAppPath)
  }

  args.push(state.updatesEnabled ? '--updates' : '--no-updates')
  return args
}

function resolveBareBinary() {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const runtimePackage = currentBareRuntimePackageName()
  if (!runtimePackage) throw new Error('Unsupported platform for Bare runtime')
  return path.join(resolveAppRoot(), 'bare', 'node_modules', runtimePackage, 'bin', `bare${extension}`)
}

function resolveBackendScript() {
  return path.join(resolveAppRoot(), 'bare', 'pear-host.cjs')
}

function resolveAppRoot() {
  return app.isPackaged ? app.getAppPath() : projectRoot
}

function getPackagedAppPath() {
  if (!app.isPackaged) return null
  if (process.platform === 'linux' && process.env.APPIMAGE) return process.env.APPIMAGE
  if (process.platform === 'win32') return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

function currentBareRuntimePackageName() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'bare-runtime-darwin-arm64'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'bare-runtime-darwin-x64'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'bare-runtime-linux-arm64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'bare-runtime-linux-x64'
  if (process.platform === 'win32' && process.arch === 'arm64') return 'bare-runtime-win32-arm64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'bare-runtime-win32-x64'
  return null
}

function waitForBackendReady(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection(state.backendSocketPath)

      socket.once('connect', () => {
        socket.end()
        resolve()
      })

      socket.once('error', (error) => {
        socket.destroy()
        if (Date.now() >= deadline) {
          reject(new Error(`Backend did not start: ${error.message}`))
          return
        }
        setTimeout(attempt, 100)
      })
    }

    attempt()
  })
}

async function backendRequest(method, params) {
  await ensureBackend()

  const payload = JSON.stringify({
    method,
    params: params || {},
  })

  const response = await new Promise((resolve, reject) => {
    const socket = net.createConnection(state.backendSocketPath)
    const chunks = []

    socket.once('connect', () => {
      socket.write(payload)
      socket.end()
    })

    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    socket.once('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    socket.once('error', reject)
  })

  if (response.ok) return response.result ?? null
  throw new Error(response.error || 'backend returned an unknown error')
}

function consumePendingAuthUrl() {
  return state.pendingAuthUrls.shift() || null
}

function queueAuthUrl(url) {
  if (testFlags.autoApproveAuth) {
    void autoApproveAuthUrl(url)
    return
  }

  state.pendingAuthUrls.push(url)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('facebonk:auth-url', { url })
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }
}

async function ensureTestIdentity() {
  if (!testFlags.bootstrapProfile) return

  const appState = await backendRequest('get_state')
  if (appState?.initialized) return

  await backendRequest('create_identity', testFlags.bootstrapProfile)
}

async function autoApproveAuthUrl(url) {
  try {
    await approveConnectRequest({ rawUrl: url })
  } catch (error) {
    console.error('[facebonk-electron] failed to auto-approve auth URL', error)
  }
}

async function approveConnectRequest(request) {
  await ensureTestIdentity()

  const {
    parseFacebonkAuthUrl,
    parseFacebonkRefreshUrl,
  } = await import(path.join(projectRoot, 'core', 'auth-link.js'))
  const rawUrl = request?.rawUrl || request?.url || ''

  if (rawUrl.startsWith('facebonk://refresh')) {
    const refresh = parseFacebonkRefreshUrl(rawUrl)
    const result = await backendRequest('refresh_consumer_profile', {
      audience: refresh.client || 'unknown-consumer',
      grant: refresh.grant,
      knownProfileDocumentHash: refresh.knownProfileDocumentHash,
    })

    const assetTransport = await createAssetTransport(result?.avatarAsset)

    try {
      await postJson(refresh.callbackUrl, {
        state: refresh.state,
        changed: Boolean(result?.changed),
        profileDocument: result?.profileDocument ?? null,
        avatarUrl: assetTransport?.avatarUrl ?? null,
      })
    } finally {
      if (assetTransport) {
        setTimeout(() => {
          void assetTransport.close()
        }, 5000)
      }
    }

    if (refresh.returnTo) {
      await openExternalUrl(refresh.returnTo)
    }

    return { approved: true, changed: Boolean(result?.changed) }
  }

  const auth = parseFacebonkAuthUrl(rawUrl)
  const bundle = await backendRequest('create_connect_bundle', {
    audience: auth.client || 'unknown-consumer',
    nonce: auth.state,
  })

  const assetTransport = await createAssetTransport(bundle?.avatarAsset)

  try {
    await postJson(auth.callbackUrl, {
      state: auth.state,
      proof: bundle?.proof ?? '',
      grant: bundle?.grant ?? '',
      profileDocument: bundle?.profileDocument ?? null,
      avatarUrl: assetTransport?.avatarUrl ?? null,
    })
  } finally {
    if (!assetTransport) return
    setTimeout(() => {
      void assetTransport.close()
    }, 5000)
  }

  if (auth.returnTo) {
    await openExternalUrl(auth.returnTo)
  }

  return { approved: true }
}

async function createAssetTransport(avatarAsset) {
  if (!avatarAsset?.asset || !avatarAsset?.data) return null

  const http = require('http')
  const body = Buffer.from(avatarAsset.data)
  let served = false
  let server = null

  server = http.createServer((req, res) => {
    if (served) {
      res.writeHead(410)
      res.end('expired')
      return
    }

    served = true
    res.writeHead(200, {
      'content-type': avatarAsset.mimeType || 'application/octet-stream',
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
    })
    res.end(body)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve))
    throw new Error('Failed to bind local avatar transport')
  }

  return {
    avatarUrl: `http://127.0.0.1:${address.port}/avatar/${avatarAsset.asset.hash}`,
    close() {
      return new Promise((resolve) => server.close(resolve))
    },
  }
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const body = Buffer.from(JSON.stringify(payload))
    const transport = target.protocol === 'https:' ? require('https') : require('http')
    const request = transport.request(
      target,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.byteLength),
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString('utf8'))
            return
          }
          reject(
            new Error(
              Buffer.concat(chunks).toString('utf8') ||
                `Auth callback failed with status ${response.statusCode}`
            )
          )
        })
      }
    )

    request.on('error', reject)
    request.end(body)
  })
}

function openExternalUrl(url) {
  return shell.openExternal(url)
}

async function shutdownBackend() {
  state.quitting = true
  if (!state.backend || state.backend.killed) return

  const backend = state.backend
  state.backend = null

  await new Promise((resolve) => {
    backend.once('exit', () => resolve())
    backend.kill('SIGTERM')
    setTimeout(() => {
      if (!backend.killed) backend.kill('SIGKILL')
      resolve()
    }, 1000)
  })
}

async function createWindow() {
  await ensureBackend()
  await ensureTestIdentity()

  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: appName,
    show: !testFlags.headless,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  await win.loadFile(path.join(resolveAppRoot(), 'renderer', 'index.html'))
}

function handleDeepLink(url) {
  queueAuthUrl(url)
}

app.setAsDefaultProtocolClient(protocol)
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})
app.on('before-quit', () => {
  void shutdownBackend()
})

const lock = testFlags.disableSingleInstance ? true : app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  if (!testFlags.disableSingleInstance) {
    app.on('second-instance', (event, argv) => {
      const url = argv.find((arg) => typeof arg === 'string' && arg.startsWith(protocol + '://'))
      if (url) handleDeepLink(url)

      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
  }

  app.whenReady().then(() => {
    createWindow()
      .then(async () => {
        if (!testFlags.autoApproveAuth || state.pendingAuthUrls.length === 0) return
        const pending = state.pendingAuthUrls.splice(0, state.pendingAuthUrls.length)
        for (const url of pending) {
          await autoApproveAuthUrl(url)
        }
      })
      .catch((error) => {
        console.error('Failed to create window:', error)
        app.quit()
      })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((error) => {
          console.error('Failed to create window:', error)
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

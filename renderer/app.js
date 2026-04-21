import { parseFacebonkAuthUrl } from './auth-link.js'

const bridge = window.bridge

const hostInfo = {
  storageDir: document.querySelector('#storage-dir'),
  storageOverride: document.querySelector('#storage-override'),
  bridge: document.querySelector('#bridge'),
  backendTransport: document.querySelector('#backend-transport'),
}

const authSection = document.querySelector('#auth-section')
const authDescription = document.querySelector('#auth-description')
const authClient = document.querySelector('#auth-client')
const authCallbackUrl = document.querySelector('#auth-callback-url')
const authApproveButton = document.querySelector('#auth-approve-button')
const authRejectButton = document.querySelector('#auth-reject-button')
const setupSection = document.querySelector('#setup-section')
const consoleSection = document.querySelector('#console-section')
const statusMessage = document.querySelector('#status-message')
const createForm = document.querySelector('#create-form')
const linkForm = document.querySelector('#link-form')
const profileForm = document.querySelector('#profile-form')
const avatarForm = document.querySelector('#avatar-form')
const avatarFile = document.querySelector('#avatar-file')
const clearAvatarButton = document.querySelector('#clear-avatar-button')
const refreshButton = document.querySelector('#refresh-button')
const inviteButton = document.querySelector('#invite-button')
const inviteOutput = document.querySelector('#invite-output')
const inviteOutputWrap = document.querySelector('#invite-output-wrap')
const runtimeOutput = document.querySelector('#runtime-output')
const backendOutput = document.querySelector('#backend-output')
const identityKey = document.querySelector('#identity-key')
const writerKey = document.querySelector('#writer-key')
const devicesList = document.querySelector('#devices-list')
const avatarPreview = document.querySelector('#avatar-preview')
const avatarPlaceholder = document.querySelector('#avatar-placeholder')

const profileFields = {
  name: document.querySelector('#profile-name'),
  bio: document.querySelector('#profile-bio'),
  updatedAt: document.querySelector('#profile-updated-at'),
}

let currentBackendState = null
let pendingAuthRequest = null

async function requestBackend(method, params = {}) {
  return await bridge.backendRequest(method, params)
}

async function requestBackendWithRetry(method, params = {}, retries = 30) {
  let lastError = null

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await requestBackend(method, params)
    } catch (error) {
      lastError = error
      if (isRetryableBackendError(error) === false) {
        break
      }
      await delay(150)
    }
  }

  throw lastError ?? new Error('backend request failed')
}

function isRetryableBackendError(error) {
  const message = String(error?.message || error || '')
  if (message.includes('File descriptor could not be locked')) return false
  if (message.includes('No identity initialized')) return false
  if (message.includes('Invite is required')) return false
  return true
}

async function loadAppInfo() {
  const info = await bridge.appInfo()
  hostInfo.storageDir.textContent = info.storageDir
  hostInfo.storageOverride.textContent = info.storageOverride ?? 'default app data directory'
  hostInfo.bridge.textContent = info.bridge
  hostInfo.backendTransport.textContent = info.backendTransport
}

async function refresh() {
  const [runtimeState, backendState] = await Promise.all([
    requestBackendWithRetry('get_runtime_state'),
    requestBackendWithRetry('get_state'),
  ])

  renderRuntime(runtimeState)
  renderBackendState(backendState)
}

function renderRuntime(runtimeState) {
  runtimeOutput.textContent = JSON.stringify(runtimeState, null, 2)
}

function renderBackendState(state) {
  currentBackendState = state
  backendOutput.textContent = JSON.stringify(state, null, 2)
  renderAuthRequest()

  if (!state.initialized || !state.summary) {
    setupSection.hidden = false
    consoleSection.hidden = true
    return
  }

  setupSection.hidden = true
  consoleSection.hidden = false

  const summary = state.summary
  identityKey.textContent = summary.identityKey
  writerKey.textContent = summary.writerKey
  profileFields.name.value = summary.profile?.displayName ?? ''
  profileFields.bio.value = summary.profile?.bio ?? ''

  const ts = formatTimestamp(summary.profile?.updatedAt)
  profileFields.updatedAt.textContent = ts ? 'Updated ' + ts : ''

  if (summary.profile?.avatarDataUrl) {
    avatarPreview.src = summary.profile.avatarDataUrl
    avatarPreview.hidden = false
    avatarPlaceholder.hidden = true
    clearAvatarButton.hidden = false
  } else {
    avatarPreview.hidden = true
    avatarPreview.removeAttribute('src')
    avatarPlaceholder.hidden = false
    avatarPlaceholder.textContent = initialFor(summary.profile?.displayName)
    clearAvatarButton.hidden = true
  }

  devicesList.replaceChildren()
  for (const device of summary.devices || []) {
    const isCurrent = device.writerKey === summary.writerKey

    const li = document.createElement('li')

    const info = document.createElement('div')
    info.className = 'device-info'

    const keyEl = document.createElement('span')
    keyEl.className = 'device-key'
    keyEl.textContent = device.writerKey

    const roleEl = document.createElement('span')
    roleEl.className = 'device-role'
    roleEl.textContent = device.roles.join(', ')

    info.append(keyEl, roleEl)
    li.append(info)

    if (isCurrent) {
      const badge = document.createElement('span')
      badge.className = 'device-current'
      badge.textContent = 'This device'
      li.append(badge)
    } else {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'btn btn-danger'
      button.textContent = 'Revoke'
      button.addEventListener('click', () => revokeDevice(device.writerKey))
      li.append(button)
    }

    devicesList.append(li)
  }
}

function renderAuthRequest() {
  if (!pendingAuthRequest) {
    authSection.hidden = true
    return
  }

  const initialized = Boolean(currentBackendState?.initialized)
  authSection.hidden = false
  authClient.textContent = pendingAuthRequest.client || 'consumer-app'
  authCallbackUrl.textContent = pendingAuthRequest.callbackUrl
  authDescription.textContent = initialized
    ? 'This app is requesting a signed connect proof and profile document. Large assets stay separate.'
    : 'Create or link an identity first, then approve this connect request.'
  authApproveButton.disabled = !initialized
}

function clearPendingAuthRequest() {
  pendingAuthRequest = null
  renderAuthRequest()
}

function setPendingAuthRequest(rawUrl) {
  const value = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  if (!value) return

  pendingAuthRequest = {
    ...parseFacebonkAuthUrl(value),
    rawUrl: value,
  }
  renderAuthRequest()
  setStatus('A consumer app is waiting for your approval.')
}

function initialFor(name) {
  if (!name) return '?'
  const first = name.trim()[0]
  return first ? first.toUpperCase() : '?'
}

async function revokeDevice(writerKeyToRevoke) {
  try {
    setStatus('Revoking device…')
    const result = await requestBackend('revoke_device', { writerKey: writerKeyToRevoke })
    if (!result.revoked) {
      setStatus('Device not found.')
      return
    }
    setStatus('Device revoked.')
    renderBackendState(result.state)
  } catch (error) {
    setStatus(String(error), true)
  }
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message
  statusMessage.dataset.error = isError ? 'true' : 'false'
}

function formatTimestamp(unixMs) {
  if (!unixMs) return ''

  try {
    return new Date(unixMs).toLocaleString()
  } catch {
    return String(unixMs)
  }
}

async function fileToBase64(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })

  const comma = dataUrl.indexOf(',')
  if (comma === -1) {
    throw new Error('Could not encode avatar file')
  }

  return dataUrl.slice(comma + 1)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Copy buttons
for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.copy)
    if (target?.value) {
      navigator.clipboard.writeText(target.value).then(() => {
        const original = btn.textContent
        btn.textContent = 'Copied!'
        setTimeout(() => { btn.textContent = original }, 1500)
      })
    }
  })
}

window.addEventListener('error', (event) => {
  console.error('[facebonk-renderer] uncaught error', event.error || event.message)
  setStatus(String(event.error?.message || event.message || 'Unexpected renderer error'), true)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[facebonk-renderer] unhandled rejection', event.reason)
  const message =
    event.reason?.message ||
    (typeof event.reason === 'string' ? event.reason : 'Unexpected async renderer error')
  setStatus(String(message), true)
})

createForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const form = new FormData(createForm)

  try {
    setStatus('Creating identity…')
    await requestBackend('create_identity', {
      displayName: form.get('displayName'),
      bio: form.get('bio'),
    })
    inviteOutput.value = ''
    inviteOutputWrap.hidden = true
    setStatus('Identity created.')
    await refresh()
  } catch (error) {
    setStatus(String(error), true)
  }
})

linkForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const form = new FormData(linkForm)

  try {
    setStatus('Linking identity…')
    await requestBackend('link_identity', {
      invite: form.get('invite'),
    })
    inviteOutput.value = ''
    inviteOutputWrap.hidden = true
    setStatus('Identity linked.')
    await refresh()
  } catch (error) {
    setStatus(String(error), true)
  }
})

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const form = new FormData(profileForm)

  try {
    setStatus('Saving profile…')
    await requestBackend('update_profile', {
      displayName: form.get('displayName'),
      bio: form.get('bio'),
    })
    setStatus('Profile updated.')
    await refresh()
  } catch (error) {
    setStatus(String(error), true)
  }
})

// Avatar: auto-upload on file selection
avatarFile.addEventListener('change', async () => {
  const file = avatarFile.files?.[0]
  if (!file) return

  try {
    setStatus('Uploading avatar…')
    await requestBackend('set_avatar', {
      base64: await fileToBase64(file),
      mimeType: file.type || null,
    })
    avatarForm.reset()
    setStatus('Avatar updated.')
    await refresh()
  } catch (error) {
    setStatus(String(error), true)
  }
})

// Keep form submit as fallback
avatarForm.addEventListener('submit', (event) => {
  event.preventDefault()
})

clearAvatarButton.addEventListener('click', async () => {
  try {
    setStatus('Clearing avatar…')
    await requestBackend('clear_avatar')
    setStatus('Avatar cleared.')
    await refresh()
  } catch (error) {
    setStatus(String(error), true)
  }
})

inviteButton.addEventListener('click', async () => {
  try {
    setStatus('Creating invite…')
    const result = await requestBackend('create_link_invite')
    inviteOutput.value = result.invite ?? ''
    inviteOutputWrap.hidden = false
    setStatus('Invite created — copy and share it.')
  } catch (error) {
    setStatus(String(error), true)
  }
})

authApproveButton.addEventListener('click', async () => {
  if (!pendingAuthRequest) return

  try {
    setStatus('Approving connect request…')
    await bridge.approveConnectRequest({ rawUrl: pendingAuthRequest.rawUrl })
    clearPendingAuthRequest()
    setStatus('Connect request approved.')
  } catch (error) {
    setStatus(String(error), true)
  }
})

authRejectButton.addEventListener('click', () => {
  clearPendingAuthRequest()
  setStatus('Canceled connect request.')
})

refreshButton.addEventListener('click', async () => {
  try {
    setStatus('Refreshing…')
    await refresh()
    setStatus('Ready.')
  } catch (error) {
    setStatus(String(error), true)
  }
})

window.addEventListener('DOMContentLoaded', async () => {
  try {
    bridge.onFacebonkAuthUrl((payload) => {
      const url = payload?.url ?? payload
      try {
        setPendingAuthRequest(url)
      } catch (error) {
        setStatus(String(error), true)
      }
    })

    await loadAppInfo()
    await refresh()
    const pendingUrl = await bridge.consumePendingAuthUrl()
    if (pendingUrl) {
      setPendingAuthRequest(pendingUrl)
    }
    setStatus('Ready.')
  } catch (error) {
    setStatus(String(error), true)
  }
})

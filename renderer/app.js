const invoke = window.__TAURI__.core.invoke

const hostInfo = {
  storageDir: document.querySelector('#storage-dir'),
  storageOverride: document.querySelector('#storage-override'),
  bridge: document.querySelector('#bridge'),
  backendTransport: document.querySelector('#backend-transport'),
}

const setupSection = document.querySelector('#setup-section')
const consoleSection = document.querySelector('#console-section')
const statusMessage = document.querySelector('#status-message')
const createForm = document.querySelector('#create-form')
const linkForm = document.querySelector('#link-form')
const profileForm = document.querySelector('#profile-form')
const avatarForm = document.querySelector('#avatar-form')
const clearAvatarButton = document.querySelector('#clear-avatar-button')
const refreshButton = document.querySelector('#refresh-button')
const inviteButton = document.querySelector('#invite-button')
const shareButton = document.querySelector('#share-button')
const inviteOutput = document.querySelector('#invite-output')
const shareOutput = document.querySelector('#share-output')
const runtimeOutput = document.querySelector('#runtime-output')
const backendOutput = document.querySelector('#backend-output')
const identityKey = document.querySelector('#identity-key')
const writerKey = document.querySelector('#writer-key')
const devicesList = document.querySelector('#devices-list')
const avatarPreview = document.querySelector('#avatar-preview')
const avatarEmpty = document.querySelector('#avatar-empty')

const profileFields = {
  name: document.querySelector('#profile-name'),
  bio: document.querySelector('#profile-bio'),
  updatedAt: document.querySelector('#profile-updated-at'),
}

async function requestBackend(method, params = {}) {
  return await invoke('backend_request', { method, params })
}

async function requestBackendWithRetry(method, params = {}, retries = 30) {
  let lastError = null

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await requestBackend(method, params)
    } catch (error) {
      lastError = error
      await delay(150)
    }
  }

  throw lastError ?? new Error('backend request failed')
}

async function loadAppInfo() {
  const info = await invoke('app_info')
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
  backendOutput.textContent = JSON.stringify(state, null, 2)

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
  profileFields.updatedAt.textContent = formatTimestamp(summary.profile?.updatedAt)

  if (summary.profile?.avatarDataUrl) {
    avatarPreview.src = summary.profile.avatarDataUrl
    avatarPreview.hidden = false
    avatarEmpty.hidden = true
  } else {
    avatarPreview.hidden = true
    avatarPreview.removeAttribute('src')
    avatarEmpty.hidden = false
  }

  devicesList.replaceChildren()
  for (const device of summary.devices || []) {
    const item = document.createElement('li')
    const key = document.createElement('code')
    key.textContent = device.writerKey
    item.append(key, document.createTextNode(` (${device.roles.join(', ')})`))

    if (device.writerKey !== summary.writerKey) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Revoke'
      button.addEventListener('click', () => revokeDevice(device.writerKey))
      item.append(document.createTextNode(' '), button)
    }

    devicesList.append(item)
  }
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
    shareOutput.value = ''
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
    shareOutput.value = ''
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

avatarForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const file = document.querySelector('#avatar-file').files?.[0]
  if (!file) {
    setStatus('Choose an image file first.', true)
    return
  }

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
    setStatus('Invite created.')
  } catch (error) {
    setStatus(String(error), true)
  }
})

shareButton.addEventListener('click', async () => {
  try {
    setStatus('Exporting share token…')
    const result = await requestBackend('share_profile')
    shareOutput.value = result.token ?? ''
    setStatus('Share token created.')
  } catch (error) {
    setStatus(String(error), true)
  }
})

refreshButton.addEventListener('click', async () => {
  try {
    setStatus('Refreshing…')
    await refresh()
    setStatus('Refreshed.')
  } catch (error) {
    setStatus(String(error), true)
  }
})

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadAppInfo()
    await refresh()
    setStatus('Ready.')
  } catch (error) {
    setStatus(String(error), true)
  }
})

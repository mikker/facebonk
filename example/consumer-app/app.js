const startButton = document.querySelector('#start')
const openLink = document.querySelector('#open-link')
const statusEl = document.querySelector('#status')
const profileEl = document.querySelector('#profile')
const avatarEl = document.querySelector('#avatar')
const displayNameEl = document.querySelector('#display-name')
const bioEl = document.querySelector('#bio')
const payloadEl = document.querySelector('#payload')

function setStatus(message) {
  statusEl.textContent = message
}

function renderProfile(profile, avatar) {
  profileEl.hidden = false
  displayNameEl.textContent = profile.displayName || 'Unnamed'
  bioEl.textContent = profile.bio || ''
  payloadEl.textContent = JSON.stringify({ profile, avatar }, null, 2)

  if (avatar?.dataUrl) {
    avatarEl.src = avatar.dataUrl
    avatarEl.hidden = false
  } else {
    avatarEl.hidden = true
    avatarEl.removeAttribute('src')
  }
}

async function poll(state) {
  for (;;) {
    const response = await fetch(`/api/session/${encodeURIComponent(state)}`)
    const body = await response.json()

    if (body.status === 'pending') {
      setStatus('Waiting for Facebonk approval…')
      await new Promise((resolve) => setTimeout(resolve, 500))
      continue
    }

    if (body.status === 'error') {
      throw new Error(body.error || 'Facebonk auth failed')
    }

    return {
      profile: body.profile,
      avatar: body.avatar,
    }
  }
}

startButton.addEventListener('click', async () => {
  try {
    profileEl.hidden = true
    openLink.hidden = true
    setStatus('Starting auth session…')

    const response = await fetch('/api/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const body = await response.json()

    openLink.href = body.launchUrl
    openLink.hidden = false
    setStatus('Opening Facebonk… approve the request there.')
    window.location.href = body.launchUrl

    const result = await poll(body.state)
    setStatus('Connected.')
    renderProfile(result.profile, result.avatar)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Auth failed')
  }
})

const FACEBONK_AUTH_SCHEME = 'facebonk:'

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseUrl(value, message) {
  try {
    return new URL(value)
  } catch {
    throw new Error(message)
  }
}

function normalizeState(value) {
  const state = normalizeText(value)
  if (!state) throw new Error('Auth state is required')
  if (state.length > 256) throw new Error('Auth state is too long')
  return state
}

function normalizeClient(value) {
  const client = normalizeText(value)
  return client || null
}

function isLoopbackHost(hostname) {
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

function normalizeLoopbackCallbackUrl(value) {
  const url = parseUrl(value, 'Callback URL must be a valid URL')

  if (url.protocol !== 'http:') {
    throw new Error('Callback URL must use http')
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error('Callback URL must target loopback')
  }
  if (!url.port) {
    throw new Error('Callback URL must include an explicit port')
  }
  if (url.username || url.password) {
    throw new Error('Callback URL cannot include credentials')
  }

  return url.toString()
}

function normalizeReturnToUrl(value) {
  const text = normalizeText(value)
  if (!text) return null

  const url = parseUrl(text, 'Return URL must be a valid URL')
  return url.toString()
}

function isAuthTarget(url) {
  return url.host === 'auth' || url.pathname === '/auth' || url.pathname === 'auth'
}

export function parseFacebonkAuthUrl(input) {
  const raw = normalizeText(input)
  if (!raw) throw new Error('Auth URL is required')

  const url = parseUrl(raw, 'Auth URL must be a valid URL')
  if (url.protocol !== FACEBONK_AUTH_SCHEME || !isAuthTarget(url)) {
    throw new Error('Not a Facebonk auth URL')
  }

  return {
    client: normalizeClient(url.searchParams.get('client')),
    callbackUrl: normalizeLoopbackCallbackUrl(url.searchParams.get('callback')),
    state: normalizeState(url.searchParams.get('state')),
    returnTo: normalizeReturnToUrl(url.searchParams.get('return_to'))
  }
}

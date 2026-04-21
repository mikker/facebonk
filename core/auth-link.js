export const FACEBONK_AUTH_SCHEME = 'facebonk'
export const FACEBONK_AUTH_ACTION = 'auth'
export const BONK_DOCS_RETURN_SCHEME = 'bonk-docs:'

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

export function normalizeLoopbackCallbackUrl(value) {
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

export function normalizeReturnToUrl(value) {
  const text = normalizeText(value)
  if (!text) return null

  const url = parseUrl(text, 'Return URL must be a valid URL')
  if (url.protocol !== BONK_DOCS_RETURN_SCHEME) {
    throw new Error('Return URL must target Bonk Docs')
  }

  return url.toString()
}

function isAuthTarget(url) {
  return (
    url.host === FACEBONK_AUTH_ACTION ||
    url.pathname === `/${FACEBONK_AUTH_ACTION}` ||
    url.pathname === FACEBONK_AUTH_ACTION
  )
}

export function createFacebonkAuthUrl(options = {}) {
  const callbackUrl = normalizeLoopbackCallbackUrl(options.callbackUrl)
  const state = normalizeState(options.state)
  const client = normalizeClient(options.client)
  const returnTo = normalizeReturnToUrl(options.returnTo)

  const url = new URL(`${FACEBONK_AUTH_SCHEME}://${FACEBONK_AUTH_ACTION}`)
  url.searchParams.set('callback', callbackUrl)
  url.searchParams.set('state', state)
  if (client) url.searchParams.set('client', client)
  if (returnTo) url.searchParams.set('return_to', returnTo)
  return url.toString()
}

export function parseFacebonkAuthUrl(input) {
  const raw = normalizeText(input)
  if (!raw) throw new Error('Auth URL is required')

  const url = parseUrl(raw, 'Auth URL must be a valid URL')
  if (url.protocol !== `${FACEBONK_AUTH_SCHEME}:` || !isAuthTarget(url)) {
    throw new Error('Not a Facebonk auth URL')
  }

  return {
    client: normalizeClient(url.searchParams.get('client')),
    callbackUrl: normalizeLoopbackCallbackUrl(url.searchParams.get('callback')),
    state: normalizeState(url.searchParams.get('state')),
    returnTo: normalizeReturnToUrl(url.searchParams.get('return_to'))
  }
}

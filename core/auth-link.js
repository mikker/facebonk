export const FACEBONK_AUTH_SCHEME = 'facebonk'
export const FACEBONK_AUTH_ACTION = 'auth'
export const FACEBONK_REFRESH_ACTION = 'refresh'

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

function normalizeGrant(value) {
  const grant = normalizeText(value)
  if (!grant) throw new Error('Consumer grant is required')
  if (grant.length > 4096) throw new Error('Consumer grant is too long')
  return grant
}

function normalizeOptionalHash(value) {
  const hash = normalizeText(value).toLowerCase()
  if (!hash) return null
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error('Profile hash must be a sha256 hex string')
  }
  return hash
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
  return url.toString()
}

function isAuthTarget(url) {
  return (
    url.host === FACEBONK_AUTH_ACTION ||
    url.pathname === `/${FACEBONK_AUTH_ACTION}` ||
    url.pathname === FACEBONK_AUTH_ACTION
  )
}

function isRefreshTarget(url) {
  return (
    url.host === FACEBONK_REFRESH_ACTION ||
    url.pathname === `/${FACEBONK_REFRESH_ACTION}` ||
    url.pathname === FACEBONK_REFRESH_ACTION
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

export function createFacebonkRefreshUrl(options = {}) {
  const callbackUrl = normalizeLoopbackCallbackUrl(options.callbackUrl)
  const state = normalizeState(options.state)
  const grant = normalizeGrant(options.grant)
  const client = normalizeClient(options.client)
  const returnTo = normalizeReturnToUrl(options.returnTo)
  const knownProfileDocumentHash = normalizeOptionalHash(options.knownProfileDocumentHash)

  const url = new URL(`${FACEBONK_AUTH_SCHEME}://${FACEBONK_REFRESH_ACTION}`)
  url.searchParams.set('callback', callbackUrl)
  url.searchParams.set('state', state)
  url.searchParams.set('grant', grant)
  if (client) url.searchParams.set('client', client)
  if (knownProfileDocumentHash) {
    url.searchParams.set('profile_hash', knownProfileDocumentHash)
  }
  if (returnTo) url.searchParams.set('return_to', returnTo)
  return url.toString()
}

export function parseFacebonkRefreshUrl(input) {
  const raw = normalizeText(input)
  if (!raw) throw new Error('Refresh URL is required')

  const url = parseUrl(raw, 'Refresh URL must be a valid URL')
  if (url.protocol !== `${FACEBONK_AUTH_SCHEME}:` || !isRefreshTarget(url)) {
    throw new Error('Not a Facebonk refresh URL')
  }

  return {
    client: normalizeClient(url.searchParams.get('client')),
    callbackUrl: normalizeLoopbackCallbackUrl(url.searchParams.get('callback')),
    state: normalizeState(url.searchParams.get('state')),
    grant: normalizeGrant(url.searchParams.get('grant')),
    knownProfileDocumentHash: normalizeOptionalHash(
      url.searchParams.get('profile_hash')
    ),
    returnTo: normalizeReturnToUrl(url.searchParams.get('return_to'))
  }
}

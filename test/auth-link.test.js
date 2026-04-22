import test from 'brittle'
import {
  createFacebonkAuthUrl,
  createFacebonkRefreshUrl,
  parseFacebonkAuthUrl,
  parseFacebonkRefreshUrl
} from '../core/index.js'

test('Facebonk auth URL round-trips through create and parse helpers', (t) => {
  const url = createFacebonkAuthUrl({
    callbackUrl: 'http://127.0.0.1:45123/facebonk-auth',
    state: 'auth-state-123',
    client: 'consumer-app',
    returnTo: 'consumer-app://connect?state=auth-state-123'
  })

  const parsed = parseFacebonkAuthUrl(url)

  t.is(parsed.client, 'consumer-app')
  t.is(parsed.state, 'auth-state-123')
  t.is(parsed.callbackUrl, 'http://127.0.0.1:45123/facebonk-auth')
  t.is(
    parsed.returnTo,
    'consumer-app://connect?state=auth-state-123'
  )
})

test('Facebonk auth URL rejects non-loopback callback URLs', (t) => {
  t.exception(
    () =>
      createFacebonkAuthUrl({
        callbackUrl: 'https://example.com/facebonk-auth',
        state: 'bad'
      }),
    /Callback URL must target loopback|Callback URL must use http/
  )
})

test('Facebonk auth URL accepts generic return URLs', (t) => {
  const parsed = parseFacebonkAuthUrl(
    'facebonk://auth?callback=http%3A%2F%2F127.0.0.1%3A9000%2Ffacebonk-auth&state=x&return_to=consumer-app%3A%2F%2Fconnect'
  )

  t.is(parsed.returnTo, 'consumer-app://connect')
})

test('Facebonk refresh URL round-trips through create and parse helpers', (t) => {
  const url = createFacebonkRefreshUrl({
    callbackUrl: 'http://127.0.0.1:45123/facebonk-auth',
    state: 'refresh-state-123',
    client: 'consumer-app',
    grant: 'facebonk-grant:test-token',
    knownProfileDocumentHash:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    returnTo: 'consumer-app://facebonk-refresh?state=refresh-state-123'
  })

  const parsed = parseFacebonkRefreshUrl(url)

  t.is(parsed.client, 'consumer-app')
  t.is(parsed.state, 'refresh-state-123')
  t.is(parsed.grant, 'facebonk-grant:test-token')
  t.is(
    parsed.knownProfileDocumentHash,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  )
  t.is(parsed.callbackUrl, 'http://127.0.0.1:45123/facebonk-auth')
  t.is(
    parsed.returnTo,
    'consumer-app://facebonk-refresh?state=refresh-state-123'
  )
})

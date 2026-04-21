import test from 'brittle'
import {
  BONK_DOCS_RETURN_SCHEME,
  createFacebonkAuthUrl,
  parseFacebonkAuthUrl
} from '../core/index.js'

test('Facebonk auth URL round-trips through create and parse helpers', (t) => {
  const url = createFacebonkAuthUrl({
    callbackUrl: 'http://127.0.0.1:45123/facebonk-auth',
    state: 'auth-state-123',
    client: 'bonk-docs',
    returnTo: `${BONK_DOCS_RETURN_SCHEME}//facebonk-auth?state=auth-state-123`
  })

  const parsed = parseFacebonkAuthUrl(url)

  t.is(parsed.client, 'bonk-docs')
  t.is(parsed.state, 'auth-state-123')
  t.is(parsed.callbackUrl, 'http://127.0.0.1:45123/facebonk-auth')
  t.is(
    parsed.returnTo,
    `${BONK_DOCS_RETURN_SCHEME}//facebonk-auth?state=auth-state-123`
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

test('Facebonk auth URL rejects non-Bonk Docs return URLs', (t) => {
  t.exception(
    () =>
      parseFacebonkAuthUrl(
        'facebonk://auth?callback=http%3A%2F%2F127.0.0.1%3A9000%2Ffacebonk-auth&state=x&return_to=https%3A%2F%2Fexample.com'
      ),
    /Return URL must target Bonk Docs/
  )
})

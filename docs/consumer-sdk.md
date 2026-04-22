# Consumer SDK

Facebonk exposes a small consumer-facing SDK for apps that want a verified
profile without becoming identity writers.

## Packages

- `@facebonk/protocol`
- `@facebonk/consumer-core`
- `@facebonk/consumer-electron`

Use `consumer-electron` for desktop apps. It builds on `consumer-core`.

## Quick Start

```js
import {
  createFacebonkClient
} from '@facebonk/consumer-electron'

const storage = {
  value: null,
  async load() {
    return this.value
  },
  async save(session) {
    this.value = session
  },
  async clear() {
    this.value = null
  }
}

const facebonk = createFacebonkClient({
  clientId: 'my-app',
  appName: 'My App',
  storage,
  openUrl(url) {
    // In Electron, hand this to shell.openExternal(url)
    console.log(url)
  }
})

const session = await facebonk.authenticate()
const profile = await session.getProfile()
```

## Public API

`createFacebonkClient(options)` returns:

- `authenticate()`
- `restore()`

An authenticated session exposes:

- `profileKey`
- `getProfile()`
- `refresh()`
- `disconnect()`

`getProfile()` returns a normalized verified object:

```js
{
  profileKey,
  displayName,
  bio,
  avatarUrl,
  updatedAt
}
```

## Storage

The storage adapter only needs:

- `load()`
- `save(session)`
- `clear()`

The stored session shape is:

```js
{
  grant,
  profileKey,
  profileDocument,
  profileDocumentHash,
  avatarAssetHash,
  avatarDataUrl
}
```

The SDK verifies this on restore before returning a session handle.

## Refresh

`session.refresh()`:

1. launches `facebonk://refresh?...`
2. sends the stored `grant` plus the current `profileDocumentHash`
3. receives either:
   - `changed: false`
   - or a new signed `profileDocument`
4. re-verifies the returned profile document
5. only fetches avatar bytes when the signed avatar asset changed

Refresh is explicit pull. There is no subscription or watch API yet.

## Advanced

If you need lower-level control over the loopback callback transport, use:

- `createFacebonkAuthSession()` from `@facebonk/consumer-electron`

That helper gives you:

- `state`
- `callbackUrl`
- `launchUrl`
- `waitForPayload()`
- `close()`

Most apps should start with `createFacebonkClient()`.

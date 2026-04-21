# Facebonk

Peer-to-peer identity manager built on Autobonk.

Facebonk now has three layers:

- `core/`: shared identity model and manager API
- `cli/`: terminal steward app
- desktop app: Tauri shell + local Bare backend + plain webview UI

The identity itself stays small and shared:

- one `IdentityContext` per identity
- linked devices and apps write as their own local writer keys
- shared profile fields: `displayName`, `bio`, `avatar`, `updatedAt`
- Bonk Docs auth uses a short `facebonk://auth?...` launch URL plus a loopback callback instead of putting profile data in the URL

## Runtime

![Facebonk app runtime](./docs/architecture-overview.svg)

![Facebonk request flow](./docs/request-flow.svg)

The desktop app is local-only. The Tauri shell starts a local Bare host, and that Bare host owns the real Facebonk manager and storage. The browser UI is only a view and control surface.

For app-to-app linking, Facebonk now acts more like a local OAuth steward:

- Bonk Docs launches Facebonk with `facebonk://auth?...`
- the URL only carries `client`, `state`, `callback`, and optional `return_to`
- Facebonk asks for approval locally
- on approval, Facebonk exports the signed profile token and `POST`s it back to the caller's loopback callback
- avatars stay in the signed token body and never go in the URL

See [docs/bonkdocs-auth.md](./docs/bonkdocs-auth.md).

## Repo layout

- `core/`: `IdentityManager`, `IdentityContext`, profile-share helpers, generated schema
- `core/auth-link.js`: helper for `facebonk://auth` launch URLs
- `cli/`: CLI entrypoint and storage defaults
- `bare/`: local backend for the desktop app
- `renderer/`: plain HTML/JS management console and local approval UI
- `tauri/`: desktop shell
- `scripts/prepare-sidecar.mjs`: stages the Bare sidecar for dev/build

## CLI usage

Create an identity:

```sh
node cli.js init
```

Set profile text:

```sh
node cli.js profile set --name "Mikker" --bio "Linked from Facebonk"
```

Set or replace the avatar:

```sh
node cli.js profile set --avatar ./avatar.png
```

Create a link invite:

```sh
node cli.js link create
```

Keep the current device online for linking:

```sh
node cli.js serve
```

Join the same identity from another local store:

```sh
node cli.js --storage /tmp/facebonk-b link join <invite>
```

## Desktop app usage

Install dependencies:

```sh
npm install
npm install --prefix bare
```

Check the desktop app build:

```sh
npm run check
```

Run the desktop app on an isolated storage dir:

```sh
npm run dev -- -- -- --storage /tmp/facebonk-app
```

The desktop app can:

- create a new identity
- link an existing identity by invite
- edit profile fields
- upload or clear an avatar
- create new link invites
- approve Bonk Docs auth requests from `facebonk://auth`
- export signed profile share tokens for manual fallback flows
- list linked devices and revoke non-current ones

## Bonk Docs auth flow

Bonk Docs should use the desktop app flow instead of asking users to paste giant tokens:

1. Bonk Docs starts a short-lived loopback callback server.
2. Bonk Docs opens `facebonk://auth?...`.
3. Facebonk validates the loopback callback and local `bonk-docs:` return target.
4. Facebonk shows a local approval screen.
5. On approval, Facebonk calls `share_profile`, then `POST`s `{ state, token }` to the callback.
6. Bonk Docs links the returned signed token and can optionally be reopened via `bonk-docs://...`.

`facebonk profile share` still exists, but it is now the manual fallback path rather than the primary integration path for desktop apps.

## Logging

When the desktop app is running, the terminal shows backend logs from the local Bare host, including:

- backend startup and storage paths
- request start and completion
- uncaught exceptions and unhandled rejections

That makes link failures and runtime crashes visible without attaching a debugger.

## Storage rule

Each running device or app needs its own local storage directory.

Two linked devices can control the same identity at the same time. They just cannot both open the exact same local data dir.

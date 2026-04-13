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

## Runtime

![Facebonk app runtime](./docs/architecture-overview.svg)

![Facebonk request flow](./docs/request-flow.svg)

The desktop app is local-only. The Tauri shell starts a local Bare host, and that Bare host owns the real Facebonk manager and storage. The browser UI is only a view and control surface.

## Repo layout

- `core/`: `IdentityManager`, `IdentityContext`, profile-share helpers, generated schema
- `cli/`: CLI entrypoint and storage defaults
- `bare/`: local backend for the desktop app
- `renderer/`: plain HTML/JS management console
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
- export signed profile share tokens
- list linked devices and revoke non-current ones

## Logging

When the desktop app is running, the terminal shows backend logs from the local Bare host, including:

- backend startup and storage paths
- request start and completion
- uncaught exceptions and unhandled rejections

That makes link failures and runtime crashes visible without attaching a debugger.

## Storage rule

Each running device or app needs its own local storage directory.

Two linked devices can control the same identity at the same time. They just cannot both open the exact same local data dir.

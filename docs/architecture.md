# Facebonk Architecture

Facebonk is one identity model with two local steward surfaces:

- CLI for direct terminal control
- desktop app for a local HTML management console

Both use the same `core/` APIs and can link into the same shared identity.

## Layers

- `core/` owns the Autobonk identity model
- `cli/` is the terminal steward
- `tauri/` is the thin desktop shell
- `bare/` is the local app backend
- `renderer/` is the plain webview UI

## Desktop runtime

![Facebonk app runtime](./architecture-overview.svg)

The important boundary is:

- the UI does not own keys
- the Bare host owns the real `IdentityManager`
- local storage and peer-to-peer state stay on-device

## Request flow

![Facebonk request flow](./request-flow.svg)

The renderer calls Tauri commands, Rust forwards JSON RPC to the local Bare host, and the Bare host executes Facebonk operations directly in-process.

## Linking model

Facebonk identities are shared by linking devices or apps with invites.

Typical flow:

1. Create the identity in the CLI or desktop app.
2. Keep that handler online.
3. Create a link invite.
4. Join from another local handler with its own storage root.
5. Both handlers now replicate and edit the same profile.

## Shared profile

The shared profile is intentionally small:

- `displayName`
- `bio`
- `avatar`
- `updatedAt`

`profile share` is separate from live replication. It exports a signed profile token for preview or import flows.

## Storage rule

Each running handler needs its own local storage directory.

Two handlers can control the same identity at the same time, but they cannot both open the exact same local data dir.

## Logging

The desktop app backend logs to the terminal:

- startup paths
- request lifecycle
- request failures
- uncaught exceptions and unhandled rejections

That is the main debugging surface right now.

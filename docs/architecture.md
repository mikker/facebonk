# Facebonk Architecture

Facebonk is now split into a shared core plus handler-specific frontends.

## Layout

![Facebonk layout](./assets/facebonk-layout.svg)

- `core/` contains the Autobonk identity model and reusable APIs.
- `cli/` contains the current command handler and storage defaults.
- `web/` is reserved for a future management UI.

## Core

`core/` owns:

- `IdentityContext`
- `IdentityManager`
- signed profile-card helpers
- generated schema loading

The core does not care whether the caller is a CLI, a web UI, or another local host. It only assumes:

- one handler has one local storage root
- one handler has one writer key
- handlers link into the same identity through invites

## Handler model

![Facebonk multi-handler flow](./assets/facebonk-multi-handler.svg)

Handlers are peers, not clients of a central service.

- The CLI can create the first identity.
- A future web handler can join that identity with an invite.
- Once linked, both handlers replicate and edit the same profile.
- No server is the source of truth.

That means the answer to “can CLI and web edit the same profile?” is yes. The current model already supports it as long as the web handler has its own local store and Hyperstack runtime.

## Share cards

![Facebonk share cards](./assets/facebonk-share-card.svg)

`profile share` exports a signed profile token:

- current display name
- current bio
- embedded avatar data URL when present
- timestamp
- detached signing key for verification

This is useful for copy/paste profile sharing and import previews. It is separate from the live replicated identity.

## Current commands

- `init`
- `serve`
- `whoami`
- `profile show`
- `profile share`
- `profile set`
- `link create`
- `link join`
- `devices list`
- `devices revoke`

## Storage rule

Each running handler needs its own local storage directory.

Two handlers can control the same identity at the same time. They just cannot both open the exact same local data dir.

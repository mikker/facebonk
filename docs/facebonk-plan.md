# Facebonk Plan

## Goal

Build `facebonk` as a small proof-of-concept identity manager for a Hyperstack/Autobonk ecosystem.

For the first pass:

- `facebonk` is the only app that can create identities
- `facebonk` is the only app that can edit shared profile data
- `bonkdocs` will later integrate only the linking flow
- the system stays peer-to-peer and does not rely on a server as truth

This document is the working plan for the first implementation.

## Product Boundary

### In scope

- one Node-based app in this repo
- simple CLI-first UX
- one shared identity domain backed by Autobonk
- shared profile data replicated through the identity context
- device linking from an already-authorized `facebonk` install to another app/device
- enough local metadata to reopen the active identity quickly
- follow-up integration with `bonkdocs` for linking only

### Out of scope

- web UI
- usernames / global registry / handle marketplace
- external server auth
- password accounts
- recovery flows
- avatar blobs
- proofs to other apps or domains
- multiple identities per install, unless needed later
- generalized multi-app SDK polish
- `pear-jam` integration in this first build

## Core Model

### Identity

An identity is a shared Autobonk context keyed by its `identityKey`.

The identity context is the source of truth for:

- profile data
- which device writer keys are authorized to control the identity

The identity context is not the source of truth for app-specific permissions. App contexts continue using their own writer keys and ACLs.

### Device

A device is just a local writer key participating in Autobonk contexts.

A device is considered signed in to an identity if the identity context contains a controller grant for that device key.

### Sign-in

For this system, "sign in" means:

- a new app/device generates its local writer key
- an already-authorized `facebonk` device authorizes that writer key into the identity context
- the new app/device stores the resulting `identityKey` locally

No server session is required.

## Shared Domain

Start with one Autobonk domain: `IdentityContext`.

### Shared collections

- `@facebonk/profile`
  - singleton record keyed by `id = "profile"`
  - fields:
    - `displayName`
    - `bio`
    - `updatedAt`

### Shared routes

- `@facebonk/profile-set`

### Permission rules

- profile writes require the caller to hold the Autobonk `owner` role
- device linking uses Autobonk's built-in invite and pairing flow
- device revocation uses Autobonk role revocation plus writer removal
- bootstrap relies on Autobonk's initial owner seeding

This keeps the domain small and explicit.

## Local State

Use a local `Hyperbee` owned by the manager for app-local state only.

Suggested keys:

- `app/active-identity`
- `identity/<identityKey>`
Local state should not duplicate the shared profile as a second source of truth. It should only cache bootstrap and UX data.

## Architecture

Keep one long-lived backend owner for storage and networking.

### Modules

- `schema.js`
  - Hyperschema + Hyperdb + dispatch generation entrypoint

- `src/identity-context.js`
  - Autobonk `Context` subclass
  - owns shared routes and permission checks

- `src/identity-manager.js`
  - Autobonk `Manager` subclass
  - create/get/load active identity
  - local metadata management

- `src/cli.js`
  - command parser and interactive prompt flow

- `src/index.js`
  - exports the reusable core pieces

### Runtime shape

Phase 1 should stay CLI-first, but it does need one long-lived process mode so another device can pair while an authorized peer is online.

Start with:

- one-shot CLI commands
- optional interactive CLI mode
- `serve` command that keeps the identity context online

## CLI Surface

Prefer a tiny command set.

### Core commands

- `facebonk init`
  - create local storage
  - create one identity if missing
  - set it active

- `facebonk serve`
  - keep the active identity online for replication and pairing

- `facebonk whoami`
  - show active identity key
  - show current profile
  - show authorized devices

- `facebonk profile show`
  - print shared profile from the identity context

- `facebonk profile set --name "..." --bio "..."`
  - update the shared profile

- `facebonk devices list`
  - show current controller keys

- `facebonk devices revoke <writerKey>`
  - revoke another device

- `facebonk link create`
  - create an Autobonk invite string for another device

- `facebonk link join <invite>`
  - join an existing identity from another device

### Interactive mode

Running `facebonk` with no args can open a simple prompt loop:

1. Show active identity
2. Edit profile
3. List devices
4. Approve link
5. Exit

No full-screen TUI is needed unless the plain prompt UX becomes painful.

## Linking Protocol

Keep the first version manual and explicit.

### Flow

1. An authorized `facebonk` install creates an Autobonk invite for the active identity.
2. That install stays online in `serve` or interactive mode.
3. A new app/device starts and joins using the invite string.
4. Autobonk pairing adds the new writer and grants it the `owner` role.
5. The new app/device stores the resulting `identityKey` locally.

### Why this is enough for the proof of concept

The invite already carries the information Autobonk needs for secure pairing. That lets the first implementation avoid a separate custom approval protocol.

## Bonkdocs Phase

After `facebonk` works, integrate `bonkdocs` in the smallest possible way.

### Bonkdocs v1 integration scope

- create local writer key as usual
- add a first-run "Link with Facebonk" flow
- generate a link request code
- after approval, store `identityKey` locally
- include `identityKey` in document metadata and presence where helpful
- resolve shared profile data from the identity context for rendering

### Bonkdocs v1 non-goals

- creating identities
- editing profile data
- account management UI
- registry or username claiming

### Important rule

`bonkdocs` should keep using `writerKey` for document ACLs and Autobonk permissions.

`identityKey` is for shared attribution and profile rendering, not document authorization.

## Data Model Notes

### Why store both `writerKey` and `identityKey`?

Because they answer different questions.

- `writerKey`: who signed this write in this context?
- `identityKey`: which long-lived person/entity should the UI render here?

For app UX, that split is useful and honest.

### Why skip names first?

Because global names introduce governance and scarcity questions that are not needed to prove the identity model.

The first proof of concept only needs:

- shared profile
- linked devices
- cross-app attribution by key

## Implementation Phases

### Phase 1: Core identity domain

- scaffold Node project
- add `schema.js`
- define `profile` and `controllers` collections
- implement `IdentityContext`
- implement `IdentityManager`
- add tests for:
  - create identity
  - bootstrap first controller
  - update profile
  - add controller
  - revoke controller

Acceptance:

- one install can create and reopen its identity
- profile changes replicate through the context

### Phase 2: CLI

- add command parsing
- implement `init`, `serve`, `whoami`, `profile show`, `profile set`, `link create`, `link join`, `devices list`, `devices revoke`
- add plain-text interactive mode

Acceptance:

- identity can be created and managed without touching internal code

### Phase 3: Linking

- reuse Autobonk invite creation and pairing
- add tests using two local stores to simulate two devices

Acceptance:

- first device can create an invite
- second device can join with that invite while the first device is online
- second device becomes an authorized owner of the same identity

### Phase 4: Bonkdocs integration

- add link-request generation in `bonkdocs`
- store resolved `identityKey`
- read shared profile from identity context
- keep all identity creation/editing out of `bonkdocs`

Acceptance:

- `bonkdocs` can link to an existing `facebonk` identity
- linked profile data renders in `bonkdocs`

## Testing Strategy

Focus on real domain behavior, not mocks.

### Facebonk tests

- identity bootstrap creates profile context and active controller
- active controller can edit profile
- non-controller cannot edit profile
- controller grant replicates to another device
- revoked controller loses write authority

### Linking tests

- manual request payload can be approved
- approved device learns `identityKey`
- malformed or replayed payloads fail cleanly

### Bonkdocs integration tests later

- unlinked install cannot claim an identity
- linked install stores `identityKey`
- profile changes from `facebonk` become visible in `bonkdocs`

## Open Questions

These can stay unresolved until implementation reveals pressure:

- whether to keep an append-only events table
- whether one install should support more than one identity
- whether link approval should embed bootstrap info or require out-of-band identity discovery
- whether a background process is worth adding after the CLI works

## Recommended First Cut

If we want the smallest useful build:

- one identity per storage directory
- no avatar blobs
- no names / handles
- no daemon
- no generic app SDK packaging yet
- no `pear-jam` integration
- `bonkdocs` linking only after `facebonk` core is working

That should be enough to prove:

- shared profiles can live in a p2p identity context
- device linking works without central auth
- another Autobonk app can treat identity as a shared external protocol

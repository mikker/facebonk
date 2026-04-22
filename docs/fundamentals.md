# Facebonk Fundamentals

This document defines the system constraints and design rules for Facebonk.

It is intentionally more stable than any current implementation.

## Problem statement

Facebonk exists because one identity may need to be used by many apps and many devices, but the Holepunch stack does not allow multiple running apps to safely share one writable storage directory.

So the system must let:

- one app own or steward an identity locally
- other apps or devices join that identity as their own writers
- other apps authenticate as that identity without becoming writers
- all of this work both on one machine and across machines
- large metadata like avatars work without forcing giant payloads through brittle UX surfaces
- the system remain fundamentally peer-to-peer

## Terms

### Identity

A shared logical person/profile.

### Steward

An app or device that has its own local store and participates as a writer in the shared identity.

Examples:
- Facebonk desktop app
- Facebonk mobile app
- a CLI steward

### Consumer

An app that wants to recognize or use an identity but does not necessarily become a writer.

Examples:
- Bonk Docs
- another app that wants sign-in, attribution, avatars, or presence labels

### Link

Join the shared identity as a separate writer with a separate local store.

This is a replication and permission relationship.

### Connect / Authenticate

Prove identity to another app without necessarily joining the shared writable identity.

This is an authorization and data access relationship.

## Non-negotiable constraints

### 1. No shared writable store between apps

Two independent apps must not depend on writing to the same local storage directory.

Implication:
- identity ownership cannot mean "everyone talks to the same Corestore path"
- every steward must have its own local store and its own writer key

### 2. Peer-to-peer is the source of truth

The system must not depend on a central server for identity validity, profile validity, or authorization validity.

Relays may exist, but only as transport helpers.

A relay must not be required to trust identity data.

### 3. Local and remote are the same logical protocol

Same-machine flows and cross-device flows should differ only in transport, not in trust model.

Implication:
- "works locally" should not require a completely different identity format than "works across machines"
- local deep links / loopback / pipes are transport conveniences, not protocol fundamentals

### 4. Proof and payload are different things

Identity proof and profile payload must be separable.

Implication:
- proving who you are should not require embedding all profile bytes
- large data like avatars must not be forced into auth tokens or launch URLs

### 5. Large assets must be addressable, not embedded by default

Avatars and future large metadata should travel by signed references, hashes, or blobs, not by inline encoding in the main auth artifact.

Implication:
- the primary auth/connect flow should stay small even if avatars or metadata get large

### 6. Consumers must be able to verify offline

A consumer should be able to verify identity proof and profile authenticity from signed data and content hashes, without asking a server whether the identity is real.

### 7. User consent is explicit

A steward must explicitly approve giving another app identity access or letting another device/app link as a writer.

### 8. Revocation must be possible

The system must support revoking:
- writer access for linked stewards
- consumer access capabilities when applicable
- stale metadata through versioning / replacement

## Core model

There are two distinct relationships:

### A. Steward linkage

A new app/device becomes a writer in the shared identity.

Properties:
- separate local store
- separate writer key
- replicated identity state
- long-lived relationship
- revocable

### B. Consumer authentication

A consumer app learns:
- which identity it is dealing with
- what signed profile snapshot or signed profile reference to trust
- optional capability to fetch current profile data and assets

Properties:
- does not imply writer membership
- may be short-lived or renewable
- should be small and transportable
- must verify cryptographically

In practice this usually means:
- an initial connect/auth step that returns a small proof plus a signed profile document
- an optional renewable capability or grant that lets the consumer explicitly refresh that signed profile document later

These must stay conceptually separate even if a UI presents both as "connect".

## Required properties of a connect/auth protocol

A viable connect protocol must provide:

1. **identity proof** — who is this?
2. **audience binding** — who is this proof for?
3. **freshness** — when was it issued, and when does it expire?
4. **replay protection** — nonce / session binding
5. **profile integrity** — which profile snapshot/ref is being authorized?
6. **asset integrity** — if avatar or blobs are fetched separately, their hashes must be verifiable
7. **transport independence** — can travel over local IPC, QR, relay, swarm, or manual handoff

If the protocol supports refresh after the initial connect, that refresh path should:

1. use a capability or grant bound to the original audience
2. return either "unchanged" or a new signed profile document
3. keep full payload transfer out of the launch URL

## Required properties of a profile representation

A profile representation must:

- be signed or hash-bound to a signed object
- include only stable identity-facing fields
- be versioned or timestamped
- allow large fields to be references
- be fetchable peer-to-peer

At minimum this includes:
- display name
- bio
- avatar reference or avatar blob hash
- updated time / version

## Transport rules

Transport is replaceable. Verification is not.

Allowed transport classes:
- same-machine deep link
- same-machine local IPC
- local network pairing
- QR code handoff
- peer-to-peer channel
- optional relay-assisted rendezvous
- manual copy/paste fallback

Rule:
- no transport may be the trust root
- transport only moves signed proofs, signed documents, references, capabilities, or encrypted payloads

## Relay rule

Relays are allowed only for rendezvous, wakeup, or temporary message passing.

A relay must not be able to:
- forge identity
- rewrite profile data undetectably
- become the canonical source of identity truth

If a relay disappears, identities and linked stewards must still remain valid.

## Avatar rule

Avatars are first-class data, but not first-class auth payload.

Therefore:
- auth/connect artifacts should carry avatar references or hashes, not avatar bytes
- avatar bytes should be fetched separately
- avatar authenticity should come from a signed profile document or signed blob reference

This rule should also apply to future large metadata.

## Future-proofing rule

Any design that works only for tiny profiles is not acceptable.

The protocol must remain sound if profiles later include:
- multiple images
- larger bios or fields
- badges / attestations
- app-specific metadata references
- additional signed documents

## Practical design consequences

The system should converge toward:

1. **small signed proof artifacts** for auth/connect
2. **separately fetchable signed profile documents**
3. **separately fetchable blobs/assets** by signed reference or hash
4. **separate link flow** for adding writers
5. **transport adapters** for local desktop, QR, remote peer, and relay-assisted handoff

## What should not be fundamental

The following are implementation details, not fundamentals:

- `facebonk://` URLs
- loopback HTTP callbacks
- Electron
- Tauri
- one specific app being the only steward forever
- manual token copy/paste
- inline avatar data URLs

These may exist as adapters, but the protocol should outlive them.

## Canonical invariants

If a future design violates any of these, it should be treated as suspect:

- one writable store per running app/device
- no central trust authority required
- link and authenticate are separate relationships
- proof is small
- profile data is signed
- large assets are referenced, not embedded by default
- same trust model locally and remotely
- consumers can verify without calling home
- relays are optional transport helpers, not authorities

## Current direction

The repository should be kept aligned with these rules.

In particular:
- connect/auth artifacts stay small
- explicit refresh should be pull-based by default
- profile documents are signed separately
- assets are fetched separately by signed reference
- local transports are adapters, not the trust model
- future remote transports should reuse the same proof/document/asset model

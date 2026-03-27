# Facebonk Approach

Facebonk is a small identity steward app for a Hyperstack/Autobonk world.

It owns identity creation and profile editing. Other apps are expected to link to an existing identity instead of creating their own. The shared identity lives in one Autobonk context and uses Autobonk's built-in owner role, invite flow, pairing, and writer management.

## Core idea

- one identity = one shared Autobonk context
- one profile singleton = shared display data
- one device = one writer key
- one linked device = another writer granted the `owner` role in the same identity

Apps should keep using their own writer keys for app-local ACLs. `identityKey` is for shared attribution and shared profile lookup.

![Runtime Diagram](./assets/facebonk-runtime.png)

## Runtime

The current proof of concept is CLI-first and Pear/Bare-compatible.

- default storage follows Pear's pattern
- dev default: `<tmpdir>/pear/facebonk`
- production default: OS app-data dir
- `Pear.storage` or `Pear.config.storage` wins when available
- `--storage` can be passed explicitly for multi-instance local testing

The core pieces are:

- `IdentityContext`: shared profile, device listing, invite creation, device revoke
- `IdentityManager`: active identity tracking and local metadata
- `cli.js`: command entrypoint with `Bare.argv` fallback

## Commands

- `facebonk init`
- `facebonk serve`
- `facebonk whoami`
- `facebonk profile show`
- `facebonk profile set --name ... --bio ...`
- `facebonk link create`
- `facebonk link join <invite>`
- `facebonk devices list`
- `facebonk devices revoke <writerKey>`

## Linking flow

1. Primary device creates an invite.
2. Primary device stays online with `serve`.
3. Second device joins with the invite.
4. Autobonk pairing adds the second writer and grants `owner`.
5. Both devices now read and write the same shared profile.

![Link Diagram](./assets/facebonk-linking.png)

## Current limitation

One local data directory can only be opened by one process at a time. That does not mean one identity can only be used by one app at a time. It only means each running instance needs its own local storage path.

For local testing, use separate storage dirs such as:

```sh
node cli.js --storage /tmp/pear/facebonk-a serve
node cli.js --storage /tmp/pear/facebonk-b link join <invite>
```

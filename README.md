# Facebonk

Small peer-to-peer identity steward built on Autobonk.

Facebonk is the app that creates and edits a shared identity. Other apps link to that identity instead of inventing their own profile system.

## Runtime

![Facebonk runtime](./docs/assets/facebonk-runtime.svg)

- One identity is one shared `IdentityContext`.
- One profile singleton stores shared display data.
- One device is one writer key with the `owner` role.
- `IdentityManager` keeps track of the active identity and local metadata.

## Linking

![Facebonk linking](./docs/assets/facebonk-linking.svg)

1. Primary device creates a link invite.
2. Primary device stays online with `serve`.
3. Second device joins with that invite.
4. Both devices now read and write the same shared profile.

## Usage

Create an identity:

```sh
node cli.js init
```

Set a shared profile:

```sh
node cli.js profile set --name "Mikker" --bio "Linked from Facebonk"
```

Set or replace the shared avatar:

```sh
node cli.js profile set --avatar ./avatar.png
```

Show the active identity:

```sh
node cli.js whoami
```

Create a link invite:

```sh
node cli.js link create
```

Keep the identity online for linking:

```sh
node cli.js serve
```

Join the identity from a second local store:

```sh
node cli.js --storage /tmp/facebonk-b link join <invite>
```

List or revoke linked devices:

```sh
node cli.js devices list
node cli.js devices revoke <writerKey>
```

## Local Testing

Use separate storage dirs per running process:

```sh
node cli.js --storage /tmp/facebonk-a init
node cli.js --storage /tmp/facebonk-a link create
node cli.js --storage /tmp/facebonk-a serve
node cli.js --storage /tmp/facebonk-b link join <invite>
```

One local data dir can only be opened by one process at a time. That is a local storage lock, not an identity limit.

## Notes

- CLI-first for now.
- Pear/Bare-compatible storage defaults.
- Shared profile is intentionally small in this POC: `displayName`, `bio`, blob-backed `avatar`, and `updatedAt`.

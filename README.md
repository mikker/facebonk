# Facebonk

Peer-to-peer identity manager built on Autobonk.

Facebonk keeps one shared identity context and lets multiple local handlers operate on it. Today the repo ships a CLI handler. A web management handler can use the same core model: it gets its own local storage and writer key, links into the existing identity, and then reads and writes the same shared profile.

## Repo layout

- `core/`: shared identity model, signing helpers, and manager API
- `cli/`: command handler and storage-path defaults
- `web/`: placeholder for a future web management handler
- `schema.js`: generated schema build entrypoint

## Current shape

![Facebonk layout](./docs/assets/facebonk-layout.svg)

- One identity is one shared `IdentityContext`.
- Each handler has its own local store and writer key.
- Linked handlers become `owner` writers in the same identity.
- Profile state stays shared: `displayName`, `bio`, `avatar`, `updatedAt`.

## Multi-handler flow

![Facebonk multi-handler flow](./docs/assets/facebonk-multi-handler.svg)

1. Start in the CLI and create the identity.
2. Create an invite from that handler.
3. Link another handler, such as a future web UI.
4. Both handlers can now edit the same profile.

## Signed share cards

![Facebonk share cards](./docs/assets/facebonk-share-card.svg)

`profile share` exports the current profile as a signed token with embedded avatar data. That is for preview/import flows. It is not the replicated identity itself.

## Usage

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

Export a signed profile card:

```sh
node cli.js profile share
```

Create a link invite:

```sh
node cli.js link create
```

Keep the current handler online for linking:

```sh
node cli.js serve
```

Join the same identity from another local handler store:

```sh
node cli.js --storage /tmp/facebonk-web link join <invite>
```

## Notes

- The local storage lock is per data dir, not per identity.
- Two handlers can use the same identity at once as long as they use different local storage roots.
- A future web management tool fits this model cleanly if it can run the same Hyperstack runtime and keep its own local store.

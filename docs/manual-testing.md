# Manual Testing

This repo is currently a CLI-first proof of concept.

## Basic profile flow

```sh
node cli.js --dir tmp/a init
node cli.js --dir tmp/a profile set --name "Alice" --bio "P2P"
node cli.js --dir tmp/a whoami
```

## Linking flow across two local dirs

1. Create the primary identity and an invite:

```sh
node cli.js --dir tmp/a init
node cli.js --dir tmp/a profile set --name "Alice" --bio "P2P"
node cli.js --dir tmp/a link create
```

2. Keep the primary identity online in another terminal:

```sh
node cli.js --dir tmp/a serve
```

3. Join from a second local dir:

```sh
node cli.js --dir tmp/b link join <invite>
node cli.js --dir tmp/b whoami
```

## Caveat

One data directory can only be opened by one process at a time. In practice that means:

- create the invite before starting `serve`, or
- use a separate interactive session that already owns the store

That is acceptable for this proof of concept because `facebonk` does not yet expose IPC to other local processes.

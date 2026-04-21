# Facebonk

Facebonk is a peer-to-peer identity steward.

It exists because multiple running apps cannot safely share one writable Holepunch storage directory, but one identity still needs to be:

- stewarded by dedicated apps/devices
- linked across devices as separate writers
- authenticated into consumer apps without turning those consumers into writers

## Canon

The canonical design source is:

- [`docs/fundamentals.md`](./docs/fundamentals.md)

If code or older docs disagree with that file, `fundamentals.md` wins.

## Current repo shape

- `core/` — identity model, connect proof/profile document logic
- `cli/` — terminal steward
- `bare/` — local backend used by the desktop steward
- `electron/` — desktop shell
- `renderer/` — desktop steward UI
- `example/` — protocol examples built around the current model

## Core ideas

- one writable store per running app/device
- separate **link** flow for adding writers
- separate **connect** flow for authenticating consumers
- small signed connect proofs
- signed profile documents
- large assets referenced separately, not embedded in auth artifacts

## Development

Install:

```sh
npm install
npm install --prefix bare
```

Run tests:

```sh
npm test
```

Run the desktop steward:

```sh
npm run dev -- --storage /tmp/facebonk-app
```

## Examples

See [`example/README.md`](./example/README.md).

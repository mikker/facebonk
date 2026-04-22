# Facebonk Architecture

This file is intentionally non-canonical.

For system rules and design constraints, see:

- [`fundamentals.md`](./fundamentals.md)

At a high level, the current app is a local steward shell around the shared `core/` identity model:

- `core/` owns identity, connect, and refresh primitives
- `bare/` hosts the steward backend
- `electron/` is the desktop shell
- `renderer/` is the steward UI

For consumer-facing flow details, see:

- [`bonkdocs-auth.md`](./bonkdocs-auth.md)
- [`consumer-sdk.md`](./consumer-sdk.md)

Anything protocol-level should be derived from `fundamentals.md`, not invented here.

# Examples

These examples are built around the current Facebonk model:

- small signed connect proofs
- reusable consumer grants for explicit refresh
- separately signed profile documents
- large assets fetched separately by signed reference

## `auth-client.mjs`

Minimal consumer-side loopback auth client.

It:
- uses `createFacebonkClient()` from `@facebonk/consumer-electron`
- stores the verified session in an in-memory store
- receives a signed connect proof + consumer grant + signed profile document
- fetches avatar bytes separately when needed
- returns a normalized verified profile object

Run it:

```sh
node example/auth-client.mjs
```

## `consumer-app/`

Minimal custom UI consumer app.

Run it:

```sh
node example/consumer-app/server.mjs
```

Then open the printed local URL and click **Connect with Facebonk**.

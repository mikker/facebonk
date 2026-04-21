# Examples

These examples are built around the current Facebonk model:

- small signed connect proofs
- separately signed profile documents
- large assets fetched separately by signed reference

## `auth-client.mjs`

Minimal consumer-side loopback auth client.

It:
- starts a short-lived callback server
- creates a `facebonk://auth?...` request URL
- receives a signed connect proof + signed profile document
- fetches avatar bytes separately when needed
- verifies the whole bundle locally

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

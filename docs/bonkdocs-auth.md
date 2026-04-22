# Bonk Docs Auth

Bonk Docs integrates with Facebonk through two explicit local flows:

1. `connect`
2. `refresh`

Both use custom URL launch plus a short-lived loopback callback. Neither puts avatar bytes or full profile payloads into the launch URL.

Bonk Docs uses the low-level helper exported from `facebonk/consumer-electron`
for this desktop transport, while still keeping its own app-local worker storage
and UI state.

## Connect

1. Bonk Docs opens `facebonk://auth?...`.
2. Facebonk shows a consent UI.
3. On approval, Facebonk creates:
   - a signed connect proof
   - a consumer grant bound to Bonk Docs
   - a signed profile document
4. Facebonk posts `{ state, proof, grant, profileDocument, avatarUrl }` to Bonk Docs' loopback callback.
5. Bonk Docs verifies everything locally and stores the verified bundle in its own storage.

## Refresh

1. Bonk Docs reads the stored `grant` and `profileDocumentHash`.
2. Bonk Docs opens `facebonk://refresh?...`.
3. Facebonk validates the grant and compares the requested hash to the current profile document hash.
4. Facebonk posts one of:
   - `{ state, changed: false }`
   - `{ state, changed: true, profileDocument, avatarUrl }`
5. Bonk Docs re-verifies any returned signed profile document and updates local state.

## Notes

- Refresh is explicit pull. There is no subscription or background watch protocol yet.
- Avatar bytes are fetched separately from the signed proof and profile document.
- Bonk Docs never opens Facebonk storage directly.

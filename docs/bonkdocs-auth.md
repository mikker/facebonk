# Facebonk Bonk Docs Auth Flow

Facebonk no longer expects Bonk Docs to paste a giant profile token into a text box as the primary desktop flow.

The current approach is:

1. Bonk Docs starts a short-lived loopback HTTP callback on `127.0.0.1`, `localhost`, or `::1`.
2. Bonk Docs opens Facebonk with a custom URL:

   ```text
   facebonk://auth?client=bonk-docs&state=...&callback=http://127.0.0.1:NNNN/...&return_to=bonk-docs://...
   ```

3. The Facebonk desktop shell receives that deep link and forwards it to the renderer.
4. The renderer validates the request, shows a local approval UI, and waits for the user to approve or cancel.
5. On approval, the renderer calls `share_profile` through the local backend.
6. Facebonk `POST`s the signed profile token back to the caller's loopback callback:

   ```json
   {
     "state": "...",
     "token": "facebonk-profile:..."
   }
   ```

7. If `return_to` is present, Facebonk reopens Bonk Docs through its custom scheme after the callback succeeds.

## Why this changed

The old copy-paste integration path broke down once avatars were embedded in the signed profile payload:

- the signed payload could become very large
- rendering huge pasted strings in desktop text inputs was unreliable
- avatar bytes did not belong in a launch URL

The new flow keeps the launch URL small and uses the loopback callback for the actual signed payload.

## What stays in the URL

The `facebonk://auth` URL only carries control data:

- `client`
- `state`
- `callback`
- optional `return_to`

It does not carry profile JSON or avatar bytes.

## What Facebonk validates

`core/auth-link.js` enforces a few rules before the desktop UI accepts the request:

- `callback` must be `http:`
- the callback host must be loopback-only
- the callback must include an explicit port
- `return_to`, if present, must be a `bonk-docs:` URL
- `state` must be present and bounded

## Role of `profile share`

`profile share` still exists and still returns a signed profile token, including avatar data when present.

That token is now mainly for:

- manual fallback flows
- debugging
- explicit export/import behavior

It should not be the default desktop integration path when Facebonk can be launched directly.

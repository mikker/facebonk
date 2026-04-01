# Web Handler

This directory is reserved for a future web-based Facebonk management tool.

The intended model is simple:

- the web handler uses `core/`
- it gets its own local storage root
- it gets its own writer key
- it links into an existing Facebonk identity with an invite
- after linking, it edits the same shared profile as the CLI

So yes: the current identity model supports CLI plus web editing the same profile. The web handler just needs a compatible local Hyperstack runtime and should be treated as another linked handler, not as a server of truth.

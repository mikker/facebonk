# Footprint Notes

## Current state

The app now ships one Bare runtime binary.

Current packaged size on macOS arm64 was roughly:

- `104M` `.app`
- `30M` `.dmg`

The main remaining large pieces were:

- bundled `bare` runtime: about `65M`
- `rocksdb-native`: about `18M`

## Deferred idea: stock `pear-runtime` with one Bare binary

We discussed a possible upstream-friendly path that would keep stock `pear-runtime` semantics while avoiding two bundled Bare runtimes.

That would likely require a small extension to `pear-runtime`, for example:

- injectable worker launcher hook
- or selectable worker backend such as sidecar vs thread

The key constraint is that current `pear-runtime.run()` is coupled to `bare-sidecar`, which in turn expects its own sidecar-style Bare process and IPC setup.

So using stock `pear-runtime` with only one Bare binary would probably require one of:

- a `pear-runtime` launcher hook that can spawn the host-provided Bare binary with a compatible IPC surface
- a `pear-runtime` thread-backed worker mode using `bare-worker`

This is worth revisiting if upstream alignment becomes more important than keeping the local runtime host small and explicit.

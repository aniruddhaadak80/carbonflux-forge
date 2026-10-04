# Troubleshooting

## `doctor` is failing

Read the **fix** line under the failing row — it names the exact remedy. Then:

```bash
carbonflux-forge skills --json    # skills subsystem
carbonflux-forge plugins --json   # plugins subsystem
carbonflux-forge tools --json     # registry subsystem
```

## The web app shows a stale build

```bash
rm -rf apps/web/.next && npm run build --workspace @carbonfluxforge/web
```

## The engine call times out

The engine is a subprocess with a hard ceiling (`engine.timeoutMs`, default 10s). Raise the
ceiling, or make the operation cheaper. It will not hang indefinitely — that is the point.

## The MCP server will not start

The most common cause is a tool name that MCP cannot carry. `fs.read` is invalid; MCP names
must match `^[a-z][a-z0-9_]{0,63}$`. The server refuses to start rather than renaming
silently, and names the offending tool.

## A skill change is not reaching users

```bash
carbonflux-forge skills --json
```

If `metadata.version` did not change, the update will not be offered. Bump it.

## Everything is fine but the deploy is stale

Vercel caches aggressively. Confirm the deployed build is current by checking the `commit`
field in `/api/health` against the commit you expect to be live.

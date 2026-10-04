# Architecture

## The narrow waist

Every capability is a `Tool`. One registry. One interface. Four transports.

```
                    ┌──────────────┐
   CLI ────────────▶│              │
   Web ────────────▶│  ToolRegistry│────▶ packages/memory  (SQLite, WAL, FTS)
   MCP server ─────▶│              │
   Channel ─────────▶└──────────────┘
```

The CLI, the web app, the MCP server, and every channel adapter are transports. None of them
contains product logic. If one of them needs a behaviour, that behaviour belongs in a tool.

## Invariants

1. **Tools are stateless.** State lives in `packages/memory`, addressed through the context.
2. **Input is validated before the handler runs.** Never after, never partially.
3. **Permissions are declared, not assumed.** `doctor` cross-checks declarations against the
   registry; a tool that touches more than it declares is a bug.
4. **Duplicate tool names throw**, naming both registrants. A silent overwrite is an
   undebuggable product bug.
5. **No cross-package deep imports.** Only declared entry points. Enforced by
   `check:boundaries`.

## The footprint ladder

Where new capability goes, in order of preference:

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool
4. Add a plugin
5. Add an MCP server tool
6. Add a new core tool — last resort

Every core tool is paid for in context window on every request, forever. Plugins are free.
That asymmetry is the whole reason for the ladder.

## The deterministic engine

The parts that must be exactly right are code, not generation. They live in
`services/engine`: a dependency-free Python package called as a **pure function** over
stdin/stdout. No server, no port, no daemon, no shared state — so two concurrent calls can
never interfere, and every operation is property-testable in isolation.

See [adr/0002-python-engine-boundary.md](adr/0002-python-engine-boundary.md).

## Packages

| Package         | Responsibility                                                               |
| --------------- | ---------------------------------------------------------------------------- |
| `core`          | the `Tool` interface, the registry, permissions, the error taxonomy. No I/O. |
| `config`        | layered config; the zod schema is the source of truth                        |
| `memory`        | SQLite storage, numbered migrations, FTS5 search                             |
| `skills`        | `SKILL.md` discovery, frontmatter parsing, catalog validation                |
| `plugins`       | manifest loading, schema validation, priority conflict resolution            |
| `channels`      | one `Channel` interface; retry and queueing live in the base class           |
| `providers`     | one `Provider` interface; validation, cost accounting, retry, normalisation  |
| `mcp`           | MCP server (stdio) and MCP client, both over the core registry               |
| `engine-client` | typed subprocess bridge to the Python engine                                 |
| `cli`           | commander CLI; `doctor` is the flagship command                              |
| `sdk`           | the public facade — the stable surface and nothing else                      |

## Deliberate omission

`apps/web` has **no workspace-package dependencies**. The deployed bundle is
self-contained, which removes build-order coupling between the monorepo and the deployment
target. The cost is that the web app reads its own data layer rather than importing
`packages/memory`; the benefit is a deploy that cannot break because a workspace build
reordered itself.

See [adr/0003-web-app-self-contained.md](adr/0003-web-app-self-contained.md).

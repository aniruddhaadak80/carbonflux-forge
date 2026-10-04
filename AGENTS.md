# AGENTS.md

A **router**, not a manual. Read the file that owns the area before changing it.

| Area                                          | Read first                                |
| --------------------------------------------- | ----------------------------------------- |
| tool interface, registry, permissions, errors | `packages/core/src/`                      |
| configuration schema                          | `packages/config/src/schema.ts`           |
| storage, migrations                           | `packages/memory/src/migrations.ts`       |
| skill format and authoring rules              | `skills/AGENTS.md`                        |
| plugin manifest contract                      | `docs/plugins.md`                         |
| MCP surface and tool naming                   | `docs/mcp.md`                             |
| the Python engine                             | `docs/adr/0002-python-engine-boundary.md` |
| the web app and design tokens                 | `apps/web/styles/tokens.css`              |
| CI jobs and gates                             | `docs/ci.md`                              |
| architectural decisions                       | `docs/adr/`                               |

## Hard rules

1. **The narrow waist holds.** One registry, one `Tool` interface. A surface is a transport,
   never a second implementation. A second code path is a bug even when it works.
2. **The footprint ladder is binding.** Extend an existing tool → CLI command + skill →
   service-gated tool → plugin → MCP tool → new core tool. Core is last, not first.
3. **No cross-package deep imports.** Only declared entry points. `check:boundaries` fails
   otherwise.
4. **Tokens only in `apps/web`.** No raw colour literal outside `styles/tokens.css`.
5. **Never edit a version in a PR.** The release workflow owns version bumps.
6. **Never edit an applied migration.** Append a new one.
7. **The engine is pure.** No clock, no network, no randomness, no filesystem.
8. **Bump `metadata.version` on any `SKILL.md` body change.**
9. **Run the full gate before claiming done:** `npm run check`.

## Structural limits

A file over ~2000 lines, a function over ~300 lines, or a cyclomatic complexity over 30 is a
defect, not a style preference. Split it.

## Definition of done

- [ ] `npm run check` exits 0
- [ ] tests cover the failure path, not only the happy path
- [ ] `CHANGELOG.md` has an `Unreleased` entry
- [ ] any user-visible change has a docs update (see the table in `docs/notes/`)

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

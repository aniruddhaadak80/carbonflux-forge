# ADR 0004 — The web app renders committed, engine-produced verdicts

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

ADR 0003 makes `apps/web` self-contained: it depends on no workspace package and reads from its own
data layer. That is necessary but not sufficient, because of a fact about the deployment target:

**Vercel runs Node, not Python.** The deterministic engine cannot be invoked from a server-rendered
route, and no workspace package — including the engine client — is reachable from the web app.

So the web app needs verdicts, and cannot compute them at request time.

## Decision

`apps/web/data/inventory.json` holds verdicts produced by the real Python engine and committed to
the repository. `npm run fixtures` regenerates it by running the engine over
`examples/inventory.json`.

The web app reads that file and recomputes nothing: no tonnage, no graph walk, no verdict logic.

## Consequences

**Good**

- The deployed page shows data produced by the engine a user can run locally, not a second
  implementation of it.
- The generation is deterministic — same input, byte-identical output — which is asserted in CI.
  Two runs producing different bytes would mean the engine is not pure, and that is worth failing on.
- The web bundle has no dependency on Python, on `better-sqlite3`, or on any workspace package, so
  the deploy cannot break because a workspace build reordered.
- A reviewer can verify the deployed data end to end: run `npm run fixtures` and diff.

**Bad**

- The data is as fresh as the commit. Adding evidence through the web UI would require a
  regeneration step before it appeared. The web app is a read surface, not an editor, so this is
  the intended trade — but it would need revisiting if an editor is ever added.
- A stale committed fixture can disagree with a freshly forged verdict. The seal is the mitigation:
  both carry it, so a mismatch is detectable rather than silent.

## Alternatives rejected

**Reimplement the engine in TypeScript and run it in the web app.** Rejected decisively. The product
claims a verdict is arithmetic and graph work, not generation. A second engine means one of the two is
unverified, and no test can compare them — Python and TypeScript would be separate implementations of
the same rules, and the disagreement between them would be discovered by an auditor, not by CI.

**Move the engine to a hosted Python service and call it over HTTP.** Rejected: it adds a network
dependency and an availability failure mode to a product whose central claim is local determinism,
in exchange for freshness the read-only web surface does not need.

**Render no data and let the web app be a marketing page.** Rejected: a deployed page showing a
placeholder would not demonstrate anything the product claims.

---

# ADR 0003 — The web app has no workspace dependencies

- **Status:** Accepted
- **Date:** 2026-01-01

## Context

The web app is the only part of this repository deployed to Vercel. The rest is a
multi-package monorepo built with turbo, so the workspace dependency graph creates a coupling
between the deployment target and the local build order.

## Decision

`apps/web` depends on **no** workspace package. It has its own typed data layer in
`apps/web/lib/` and reads only what it needs.

## Consequences

**Good**

- The Vercel build cannot break because a workspace build reordered or failed.
- `vercel --prod` works from a bare checkout of `apps/web`.
- The deployed bundle is inspectable and has a small, known dependency set.

**Bad**

- `packages/memory` is not reachable from the web app, so server-rendered product routes
  read from the local data layer instead. If that layer ever needs to become the real store,
  this ADR is revisited.
- Some types are restated in `apps/web/lib/product.ts`. They are small and stable; a
  generated client would be the fix if they grew.

## Alternatives rejected

**Import workspace packages directly.** Rejected after the failure mode was made concrete: a
turbo cache miss or a workspace build failure becomes a deploy failure, and the fix is not
local to the deploy.

**Deploy the whole monorepo with the web app at the root.** Rejected: it pulls the Python
engine and every package into the deployment image for no benefit.

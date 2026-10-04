<div align="center">

# CarbonFlux Forge

**Turns greenhouse-gas inventory claims into a content-addressed provenance graph, then proves which claims still hold.**

[CI](https://github.com/aniruddhaadak80/carbonflux-forge/actions/workflows/ci.yml) ·
[License](https://github.com/aniruddhaadak80/carbonflux-forge/blob/main/LICENSE) ·
[Issues](https://github.com/aniruddhaadak80/carbonflux-forge/issues)

</div>

---

## The problem

A GHG inventory is a spreadsheet where every number is `activity data × emission factor = tCO2e`.
Auditors ask the same question of every line: **what is this number made of, and does its support
still stand?** Today that is a spreadsheet, a shared drive and email. When a supplier re-sends a
corrected emission factor, nothing tells you which claims quietly became unsupported — you find
out during the audit.

## What this does

CarbonFlux Forge takes inventory claims plus their raw evidence documents, content-addresses every
document by the SHA-256 of its own bytes, builds a provenance graph, and forges a verdict per
claim: recomputed from its own evidence, with the chain that supports it, and the specific reason
it does not.

The case it is built for, straight from the shipped example inventory:

```console
$ carbonflux-forge forge scope1-stationary-gas

scope1-stationary-gas  UNSUPPORTED

  reported      2.282 tCO2e
  recomputed    2.282 tCO2e
  delta         0 tCO2e (0%)
  uncertainty   +/- 0.10269 tCO2e from the factor
  support depth 2
  terminal      68161cfc…aa1d, 8898bfa0…2ba7
  seal          sha256:9a2a4278f6b3501707f5e120e36cc4590117954a18210ab1145ca8873c0384e4

  reasons:
    - FACTOR_DOC_SUPERSEDED: emission factor sha256:8898bfa0…d52b has been replaced by a newer revision
    - SUPERSEDED_NODE: 'sha256:8898bfa0…d52b' was replaced by a newer revision but is still relied on
```

The arithmetic is **exact** — delta `0`, to the last digit. The claim is still unsupported, because
the factor it rests on was replaced three weeks ago and nobody re-based it. A number can be
arithmetically perfect and still be undefendable, and that is the finding this tool exists to
surface.

## Quick start

```bash
git clone https://github.com/aniruddhaadak80/carbonflux-forge.git
cd carbonflux-forge
npm install
npm run build
carbonflux-forge forge-all
```

Requires **Node ≥ 22.12** and **Python ≥ 3.11**. No API keys, no accounts, no network access.

`carbonflux-forge doctor` probes the runtime, the engine, the skill catalog, the plugin registry and
the store, and prints a **fix hint** for anything that fails. If it exits `0`, the install is good.

## Walkthrough

### 1. Triage a whole reporting period

```bash
carbonflux-forge forge-all
```

```console
8 claims forged

  SUPPORTED    2  ######
  UNSUPPORTED  5  ###############
  CIRCULAR     1  ###
  UNVERIFIED   0
```

Every verdict is recorded, so this is a one-off cost per period rather than a per-question cost.

### 2. Read one claim

```bash
carbonflux-forge forge scope1-fleet-diesel
```

The reported tonnage is `46.05`, the card transactions and the published factor give `30.7758`, and
the tool says so in those words with the seal attached.

### 3. Ask what a claim rests on

```bash
carbonflux-forge lineage scope3-business-travel-flights
```

```console
  circular       scope3-business-travel-flights -> sha256:c6f947ce…2eafc9 -> scope3-business-travel-flights
```

That claim's allocation method note cites the claim, which cites the method note. A number that
ultimately rests on itself cannot be verified by any amount of arithmetic, so the verdict is
`circular` and the tool declines to score it.

### 4. Inspect the arithmetic on its own

```bash
carbonflux-forge recompute scope2-tenant-electricity
```

Catches the single most common real defect in a hand-maintained inventory: quantity in MWh against
a factor per kWh. Reported `7.7588`; the factor is applied to `42.5`, not `42 500`.

### 5. List the evidence store

```bash
carbonflux-forge evidence
```

Every document, its content address, and whether a newer revision has replaced it.

### 6. Export sealed verdicts

```bash
carbonflux-forge export --dir .data/export
```

One NDJSON file per period, each record carrying its seal — so a reader can check any line against
the tool that produced it, in a spreadsheet or `jq` without a bespoke importer.

### 7. Regenerate the web app's data

```bash
npm run fixtures
```

Runs the Python engine over `examples/inventory.json` and writes the verdicts the web app renders.
Deterministic: two runs produce byte-identical output, which is checked in CI.

### 8. Connect an agent over MCP

CarbonFlux Forge is not only an MCP client. It runs a server, making it a tool provider for other
agents:

```json
{
  "mcpServers": {
    "carbonflux-forge": {
      "command": "carbonflux-forge",
      "args": ["mcp", "serve"]
    }
  }
}
```

Thirteen tools, the same ones the CLI uses. Proof it works, over real stdio with a real client:

```bash
npm run e2e:mcp
```

```console
  [PASS] tools/list returns at least five tools — 13 tools
  [PASS] tools/call forge_verdict reaches the Python engine — status=unsupported seal=sha256:5e330964…
  [PASS] the same claim seals identically twice — sha256:5e330964…
  [PASS] tools/call walk_provenance finds the circular chain — scope3-business-travel-flights -> sha256:c6f947ce… -> scope3-business-travel-flights

  9 passed, 0 failed
MCP ROUNDTRIP PASSED
```

## The engine

Three pure functions in `services/engine`, and the reason they are code rather than a model call is
the product's entire claim: an auditor must get the same number forever, and be able to point at the
line that produced it.

| Function          | What it guarantees                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `recompute_claim` | `Decimal` arithmetic, factor uncertainty propagated, `ROUND_HALF_EVEN` to significant figures. A malformed cell is a _finding_, not a crash. |
| `walk_provenance` | Depth-first support walk with explicit cycle detection, a hard visit budget, and chain reconstruction capped at 8 paths.                     |
| `forge_verdict`   | Folds both into `supported` / `unsupported` / `circular` / `unverified`, then **seals** it.                                                  |

No clock, no network, no randomness, no filesystem. Called as a subprocess over JSON, so two
concurrent invocations cannot interfere. Run it yourself:

```console
$ echo '{"op":"forge","input":{...}}' | python -m carbonflux_forge
{"ok":true,"value":{"claimId":"...","status":"unsupported","seal":"sha256:..."},"durationMs":344}
```

**Status precedence is `circular` > `unsupported` > `unverified` > `supported`**, because each of the
first three invalidates the question the fourth would answer.

## How it fits together

```
                  ┌──────────────┐
   CLI ──────────▶│              │
   Web ──────────▶│  ToolRegistry│───▶ packages/memory  (SQLite, WAL, CAS, FTS)
   MCP server ───▶│              │
   Channel ──────▶└──────────────┘
                         │
                         └──▶ services/engine  (pure Python, stdin/stdout)
```

Five invariants:

1. Tools are **stateless**. State lives in `packages/memory`.
2. Input is validated **before** the handler runs, never after.
3. Permissions are **declared**, and a call exceeding the granted set is refused.
4. A duplicate tool name **throws**, naming both registrants.
5. No cross-package deep imports. `check:boundaries` enforces it.

### Why the web app has committed data

Per [ADR 0003](docs/adr/0003-web-app-self-contained.md), `apps/web` depends on no workspace package
and Vercel runs Node — **not Python**. So the web app cannot call the engine at request time.

The obvious workaround, reimplementing the engine in TypeScript, is exactly the failure this
repository exists to prevent: two engines, one of them unverified. Instead, `npm run fixtures` runs
the real engine and commits its verdicts, and the web app renders those. The data on the deployed
page was produced by the engine you can run locally, and the generation is deterministic.

### The footprint ladder

Where new capability goes, in order of preference:

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool
4. Add a plugin
5. Add an MCP server tool
6. Add a new core tool — **last resort**

Every core tool is paid for in context window on every request, forever. Plugins are free. That
asymmetry is why adding to `packages/core` first is the most common review comment here.

## What ships

| Surface              | Status  | What it is                                                                                      |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| Deterministic engine | shipped | pure Python, `Decimal` arithmetic, graph walk, verdict sealing                                  |
| CLI                  | shipped | `forge`, `forge-all`, `claims`, `lineage`, `recompute`, `evidence`, `export`, `doctor`, `tools` |
| MCP server + client  | shipped | the same 13 tools over stdio, proven by `npm run e2e:mcp`                                       |
| Web notebook         | shipped | server-rendered claims, verdicts and provenance chains, deployed to Vercel                      |
| Memory               | shipped | SQLite, WAL, numbered migrations, content-addressed documents and claims                        |
| Skills catalog       | shipped | `SKILL.md` discovery, validation, `metadata.version` gating                                     |
| Plugin registry      | shipped | manifest validation, priority conflict resolution                                               |
| Channels             | shipped | one `Channel` interface; the export adapter writes NDJSON verdicts                              |
| Desktop shell        | shipped | Electron around the web build                                                                   |

### Deliberate omissions

**No LLM provider, anywhere.** The whole claim of this product is that a verdict is arithmetic and
graph work rather than generated prose. Wiring a model in would make every result arguable.
`packages/providers` exists but nothing in the product calls it.

**No chat channels.** An auditor's next step is to open the evidence somewhere they already trust.
Export is a file, not a conversation.

**No telemetry.** `TELEMETRY_ENABLED` defaults to unset and `/api/health` reports `warn` while it is
off. The product is local-first; shipping usage data by default would contradict the design.

## Configuration

Layered, later wins: **defaults → `product.config.json` → environment**.

| Key                | Default       | Meaning                         |
| ------------------ | ------------- | ------------------------------- |
| `productEnv`       | `development` | runtime mode                    |
| `dataDir`          | `.data`       | where SQLite lives              |
| `engine.python`    | `python`      | interpreter for the engine      |
| `engine.timeoutMs` | `10000`       | hard ceiling on one engine call |
| `logLevel`         | `info`        | log verbosity                   |

An invalid value raises a `ValidationError` naming the field — it is never coerced. See
[docs/configuration.md](docs/configuration.md).

## Development

```bash
npm install
npm run build        # turbo build across every package
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
npm test             # vitest, every package
npm run pytest       # the Python engine, including property tests
npm run fixtures     # regenerate the web app's data from the engine
npm run e2e:mcp      # real MCP client round-trip over stdio
npm run check        # everything CI runs
```

`npm run check` is the exact command CI runs, in the same order — so a green local run means a green
CI run. It covers format, lint, typecheck, six policy gates, the TypeScript tests, the Python
tests, and the build.

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). The architecture rules that are not negotiable are
in [AGENTS.md](AGENTS.md), and the reasoning behind each decision is in [docs/adr/](docs/adr/).

## Documentation

| Page                                       | Read it when                              |
| ------------------------------------------ | ----------------------------------------- |
| [getting-started](docs/getting-started.md) | you have just cloned this                 |
| [architecture](docs/architecture.md)       | you need the map before changing anything |
| [cli](docs/cli.md)                         | you are scripting the CLI                 |
| [mcp](docs/mcp.md)                         | you are connecting an agent               |
| [skills](docs/skills.md)                   | you are writing or editing a skill        |
| [plugins](docs/plugins.md)                 | you are adding an extension               |
| [ci](docs/ci.md)                           | you are adding a gate                     |
| [troubleshooting](docs/troubleshooting.md) | something is broken                       |
| [adr/](docs/adr/)                          | you want the reasoning behind a decision  |

## License

MIT — see [LICENSE](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

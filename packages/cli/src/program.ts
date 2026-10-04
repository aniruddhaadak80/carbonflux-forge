import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { buildToolRegistry, createContext } from './bootstrap.js'
import { doctor, renderReport } from './doctor.js'
import {
  renderClaims,
  renderCensus,
  renderComputation,
  renderEvidence,
  renderVerdict,
  renderWalk,
} from './render.js'

const VERSION = '0.1.0'

/** Exit codes are part of the contract: 0 ok, 1 runtime failure, 2 usage error. */
/**
 * The repository root, resolved by walking up from this module rather than from `process.cwd()`.
 *
 * `npm test --workspace <pkg>` runs vitest with the package directory as the cwd, so anything
 * resolving `examples/`, `skills/` or `plugins/` from the cwd breaks in CI while working
 * interactively. Anchoring to the module makes every surface — CLI, MCP, tests — find the same
 * repository regardless of who invoked it.
 */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('carbonflux-forge')
    .description(
      'CarbonFlux Forge — Turns greenhouse-gas inventory claims into a content-addressed provenance graph, then proves which claims still hold.',
    )
    .version(VERSION, '-v, --version', 'print the version')
    .exitOverride((error) => {
      process.exitCode = error.exitCode === 0 ? 0 : 2
      throw error
    })

  program
    .command('doctor')
    .description('diagnose every subsystem and print an actionable report')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const report = await doctor(REPO_ROOT)
      process.stdout.write(
        process.argv.includes('--json')
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${renderReport(report)}\n`,
      )
      if (!report.ok) process.exitCode = 1
    })

  program
    .command('tools')
    .description('list the registered tools — the authoritative capability list')
    .option('--json', 'machine-readable output')
    .action(() => {
      const registry = buildToolRegistry(REPO_ROOT)
      const tools = registry.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        surface: registry.surfaceOf(tool.name),
        source: registry.sourceOf(tool.name),
        permissions: tool.permissions,
        inputSchema: tool.inputSchema,
      }))
      if (process.argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`)
        return
      }
      const width = Math.max(...tools.map((t) => t.name.length), 4)
      for (const tool of tools) {
        process.stdout.write(`  ${tool.name.padEnd(width)}  [${tool.surface}]  ${tool.description}\n`)
      }
    })

  const GRANTS = ['fs:read', 'fs:write', 'proc:spawn'] as const

  /** Every command goes through the registry, so the CLI can never drift from the MCP surface. */
  const invoke = async (tool: string, input: unknown): Promise<unknown> => {
    const registry = buildToolRegistry(REPO_ROOT)
    try {
      return await registry.invoke(tool, input, createContext('cli'), [...GRANTS])
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? 'INTERNAL'
      process.stderr.write(`${code}: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      process.exitCode = 1
      return undefined
    }
  }

  const emit = (value: unknown, render: (v: never) => string): void => {
    if (value === undefined) return
    process.stdout.write(
      process.argv.includes('--json') ? `${JSON.stringify(value, null, 2)}\n` : `${render(value as never)}\n`,
    )
  }

  program
    .command('forge')
    .description('recompute one claim from its evidence and seal a verdict')
    .argument('<claimId>', 'the inventory claim id')
    .option('--sig-figs <n>', 'significant figures for the recomputed tonnage', Number)
    .option('--tolerance <pct>', 'accepted percentage difference from the reported figure')
    .option('--json', 'machine-readable output')
    .action(async (claimId: string, options: { sigFigs?: number; tolerance?: string }) => {
      const value = await invoke('forge_verdict', {
        claimId,
        ...(options.sigFigs === undefined ? {} : { sigFigs: options.sigFigs }),
        ...(options.tolerance === undefined ? {} : { tolerancePct: options.tolerance }),
      })
      emit(value, renderVerdict)
    })

  program
    .command('forge-all')
    .description('forge every claim in the inventory and print the census by status')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const value = await invoke('forge_inventory', {})
      emit(value, renderCensus)
    })

  program
    .command('claims')
    .description('list inventory claims with the verdict recorded for each')
    .option('--scope <n>', 'restrict to scope 1, 2 or 3', Number)
    .option('--period <period>', 'restrict to a reporting period, e.g. 2026-Q1')
    .option('--json', 'machine-readable output')
    .action(async (options: { scope?: number; period?: string }) => {
      const value = await invoke('list_claims', {
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(options.period === undefined ? {} : { period: options.period }),
      })
      emit(value, renderClaims)
    })

  program
    .command('lineage')
    .description('walk the provenance chain behind a claim')
    .argument('<claimId>', 'the inventory claim id')
    .option('--budget <n>', 'hard cap on node visits', Number)
    .option('--json', 'machine-readable output')
    .action(async (claimId: string, options: { budget?: number }) => {
      const value = await invoke('walk_provenance', {
        claimId,
        ...(options.budget === undefined ? {} : { budget: options.budget }),
      })
      emit(value, renderWalk)
    })

  program
    .command('recompute')
    .description('rebuild the tonnage of one claim and show the arithmetic')
    .argument('<claimId>', 'the inventory claim id')
    .option('--json', 'machine-readable output')
    .action(async (claimId: string) => {
      const value = await invoke('recompute_claim', { claimId })
      emit(value, renderComputation)
    })

  program
    .command('evidence')
    .description('list the content-addressed evidence store')
    .option('--kind <kind>', 'restrict to one document kind')
    .option('--json', 'machine-readable output')
    .action(async (options: { kind?: string }) => {
      const value = await invoke('evidence_catalogue', {
        ...(options.kind === undefined ? {} : { kind: options.kind }),
      })
      emit(value, renderEvidence)
    })

  program
    .command('export')
    .description('forge the inventory and write sealed verdicts as NDJSON, one file per period')
    .option('--dir <path>', 'export directory', '.data/export')
    .option('--json', 'machine-readable output')
    .action(async (options: { dir: string }) => {
      const census = (await invoke('forge_inventory', {})) as
        { count: number; byStatus: Record<string, number>; seals: Record<string, string> } | undefined
      if (census === undefined) return

      const { VerdictExportChannel } = await import('@carbonfluxforge/channels')
      const channel = new VerdictExportChannel({ directory: options.dir })
      await channel.start()

      let exported = 0
      for (const claimId of Object.keys(census.seals)) {
        const verdict = (await invoke('forge_verdict', { claimId })) as
          | {
              claimId: string
              status: string
              seal: string
              reasons: readonly string[]
              computation: {
                reportedTonnes: string
                recomputedTonnes: string
                deltaPct: string
              }
            }
          | undefined
        if (verdict === undefined) continue
        const receipt = await channel.send('2026-Q1', {
          // One line per verdict, carrying the seal so a reader can check any record against
          // the tool that produced it.
          text: JSON.stringify({
            claimId: verdict.claimId,
            status: verdict.status,
            seal: verdict.seal,
            reportedTonnes: verdict.computation.reportedTonnes,
            recomputedTonnes: verdict.computation.recomputedTonnes,
            deltaPct: verdict.computation.deltaPct,
            reasons: verdict.reasons,
          }),
          idempotencyKey: `${verdict.claimId}:${verdict.seal}`,
        })
        if (receipt.attempts > 0) exported += 1
      }

      const probe = await channel.probe()
      await channel.stop()

      if (process.argv.includes('--json')) {
        process.stdout.write(
          `${JSON.stringify({ exported, directory: options.dir, channel: probe }, null, 2)}\n`,
        )
      } else {
        process.stdout.write(`exported ${exported} verdict(s) to ${options.dir}\n${probe.detail}\n`)
      }
    })

  const mcp = program.command('mcp').description('Model Context Protocol commands')

  mcp
    .command('serve')
    .description('run the MCP server over stdio')
    .action(async () => {
      const { serveStdio } = await import('@carbonfluxforge/mcp')
      const registry = buildToolRegistry(REPO_ROOT)
      // stdout belongs to the protocol from here on; diagnostics must go to stderr.
      await serveStdio(registry, createContext('mcp'))
    })

  mcp
    .command('call')
    .description('invoke one tool directly, without MCP')
    .argument('<tool>', 'tool name')
    .argument('<input>', 'JSON input document')
    .action(async (tool: string, raw: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        process.stderr.write(`error: input is not valid JSON — ${String(cause)}\n`)
        process.exitCode = 2
        return
      }
      const registry = buildToolRegistry(REPO_ROOT)
      try {
        const value = await registry.invoke(tool, parsed, createContext('cli'), [
          'fs:read',
          'net:fetch',
          'proc:spawn',
        ])
        process.stdout.write(`${JSON.stringify(value ?? null, null, 2)}\n`)
      } catch (cause) {
        const code = (cause as { code?: string }).code ?? 'INTERNAL'
        process.stderr.write(`${code}: ${cause instanceof Error ? cause.message : String(cause)}\n`)
        process.exitCode = 1
      }
    })

  program
    .command('version')
    .description('print version and runtime information as JSON')
    .action(() => {
      process.stdout.write(
        `${JSON.stringify(
          {
            name: 'carbonflux-forge',
            version: VERSION,
            node: process.versions.node,
            platform: process.platform,
            tools: buildToolRegistry(REPO_ROOT).size,
          },
          null,
          2,
        )}\n`,
      )
    })

  return program
}

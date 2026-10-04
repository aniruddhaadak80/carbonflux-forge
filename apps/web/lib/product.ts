import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The product's identity and static manifest, in one typed place. Both the web UI and the
 * health endpoint read from here so a value is never stated twice.
 */
export interface Surface {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly status: 'shipped' | 'planned'
}

export const PRODUCT = {
  name: 'CarbonFlux Forge',
  slug: 'carbonflux-forge',
  version: '0.1.0',
  tagline:
    'Turns greenhouse-gas inventory claims into a content-addressed provenance graph, then proves which claims still hold.',
} as const

export const SURFACES: readonly Surface[] = [
  {
    id: 'engine',
    title: 'Deterministic engine',
    summary:
      'Pure Python. Recomputes tCO2e with Decimal, walks provenance with cycle detection and a hard visit budget, and seals the verdict. No model is asked whether a number is right.',
    status: 'shipped',
  },
  {
    id: 'cli',
    title: 'CLI',
    summary:
      'forge, forge-all, claims, lineage, recompute, evidence. The load-bearing entry point — every capability works without a browser.',
    status: 'shipped',
  },
  {
    id: 'mcp',
    title: 'MCP server and client',
    summary:
      'The same 13 tools over stdio, verified by a real client round-trip in e2e/mcp-roundtrip.mjs. Any MCP client can audit an inventory with this.',
    status: 'shipped',
  },
  {
    id: 'web',
    title: 'Web notebook',
    summary:
      'Server-rendered from committed, engine-produced verdicts. Vercel runs Node, not Python, so the verdicts are computed by the engine and committed rather than reimplemented.',
    status: 'shipped',
  },
  {
    id: 'skills',
    title: 'Skills catalog',
    summary: 'Markdown skills loaded from disk with frontmatter validation and a version gate.',
    status: 'shipped',
  },
  {
    id: 'plugins',
    title: 'Plugin registry',
    summary: 'Manifest-driven extensions with priority-based conflict resolution.',
    status: 'shipped',
  },
  {
    id: 'memory',
    title: 'Memory',
    summary:
      'SQLite with WAL and numbered migrations. Documents, claims, edges and verdicts, keyed by content address.',
    status: 'shipped',
  },
  {
    id: 'desktop',
    title: 'Desktop shell',
    summary: 'Electron shell that loads the web build and adds a native menu, tray and single-instance lock.',
    status: 'shipped',
  },
]

/**
 * Deliberately absent, and that is a design decision rather than a gap.
 *
 * A forge is not an assistant. There is no LLM provider wired in anywhere, because the entire
 * claim this product makes is that a verdict is arithmetic and graph work rather than generated
 * prose — and there are no chat channels, because a conversational persona would turn it into a
 * wrapper around something else.
 */
export const DELIBERATELY_OMITTED: readonly Surface[] = [
  {
    id: 'providers',
    title: 'No LLM provider',
    summary:
      'No model is consulted about a tonnage or a verdict. Adding one would make every result arguable, which is the opposite of the point.',
    status: 'planned',
  },
  {
    id: 'channels',
    title: 'No chat channels',
    summary:
      'No Slack or webhook delivery of verdicts. Export is a file the auditor already has tools to read.',
    status: 'planned',
  },
]

function packageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function resolveVersion(): string {
  return packageVersion()
}

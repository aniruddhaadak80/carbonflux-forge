import { ValidationError, type Tool, type ToolContext, type ToolRegistry } from '@carbonfluxforge/core'
import { buildGraph, engineBridge, forgeClaim, forgeInputFor, openSeededStore } from './forge-service.js'
import { addressOf, type Store } from '@carbonfluxforge/memory'

// --------------------------------------------------------------------------- input guards
//
// Input is validated against the declared inputSchema before a handler runs, and these guards
// are the runtime half of that: the schema documents the shape, these enforce it.

function requireString(input: unknown, field: string): string {
  const value = (input as Record<string, unknown>)[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`"${field}" is required and must be a non-empty string`, { field })
  }
  return value
}

function optionalString(input: unknown, field: string): string | undefined {
  const value = (input as Record<string, unknown>)[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new ValidationError(`"${field}" must be a string when present`, { field })
  }
  return value
}

function optionalInt(input: unknown, field: string): number | undefined {
  const value = (input as Record<string, unknown>)[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`"${field}" must be an integer when present`, { field })
  }
  return value
}

const CLAIM_OPTIONS = {
  claimId: { type: 'string', description: 'The inventory claim id, e.g. scope1-fleet-diesel.' },
  sigFigs: { type: 'integer', description: 'Significant figures for the recomputed tonnage.' },
  tolerancePct: {
    type: 'string',
    description: 'Percentage difference between reported and recomputed that is still accepted.',
  },
} as const

/** Tools hold no state between calls: the store is opened per invocation from the context. */
function storeFor(cwd: string, ctx: ToolContext): Store {
  return openSeededStore(cwd, ctx.dataDir).store
}

/**
 * The product's tools.
 *
 * Each is the same capability the CLI exposes and the MCP server advertises; there is no second
 * implementation. `forge_verdict` is the one to reach for first — it answers "does this number
 * still hold, and if not, why not".
 */
export function buildForgeTools(cwd: string): readonly Tool<never, unknown>[] {
  const tools: Tool<never, unknown>[] = []

  tools.push({
    name: 'forge_verdict',
    description:
      'Recompute one greenhouse-gas inventory claim from its evidence, walk its provenance chain, and return a sealed verdict. Status is one of supported, unsupported, circular or unverified, with the specific reasons. This is the deterministic core: the same claim and evidence always give the same verdict and the same seal.',
    inputSchema: {
      type: 'object',
      properties: CLAIM_OPTIONS,
      required: ['claimId'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    permissions: ['fs:read', 'fs:write', 'proc:spawn'],
    surface: 'core',
    handler: async (input: unknown, ctx: ToolContext) => {
      const claimId = requireString(input, 'claimId')
      const sigFigs = optionalInt(input, 'sigFigs')
      const tolerancePct = optionalString(input, 'tolerancePct')
      const store = storeFor(cwd, ctx)
      return await forgeClaim(engineBridge(cwd), store, claimId, {
        ...(sigFigs === undefined ? {} : { sigFigs }),
        ...(tolerancePct === undefined ? {} : { tolerancePct }),
      })
    },
  })

  tools.push({
    name: 'recompute_claim',
    description:
      'Rebuild the tCO2e of one claim from its activity quantity and emission factor, and compare it with the reported figure. Returns the recomputed value, the delta, the propagated factor uncertainty, and any defect found in the factor evidence.',
    inputSchema: {
      type: 'object',
      properties: CLAIM_OPTIONS,
      required: ['claimId'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    permissions: ['fs:read', 'proc:spawn'],
    surface: 'core',
    handler: async (input: unknown, ctx: ToolContext) => {
      const claimId = requireString(input, 'claimId')
      const sigFigs = optionalInt(input, 'sigFigs')
      const tolerancePct = optionalString(input, 'tolerancePct')
      const store = storeFor(cwd, ctx)
      return await engineBridge(cwd).call({
        op: 'recompute',
        input: forgeInputFor(store, claimId, {
          ...(sigFigs === undefined ? {} : { sigFigs }),
          ...(tolerancePct === undefined ? {} : { tolerancePct }),
        }),
      })
    },
  })

  tools.push({
    name: 'walk_provenance',
    description:
      'Walk the provenance chain from a claim to the evidence that grounds it, reporting support depth, the terminal evidence, whether the chain is circular, and whether the walk hit its visit budget.',
    inputSchema: {
      type: 'object',
      properties: {
        claimId: { type: 'string', description: 'Claim to walk from.' },
        budget: { type: 'integer', description: 'Hard cap on node visits, default 10000.' },
      },
      required: ['claimId'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    permissions: ['fs:read', 'proc:spawn'],
    surface: 'core',
    handler: async (input: unknown, ctx: ToolContext) => {
      const claimId = requireString(input, 'claimId')
      const budget = optionalInt(input, 'budget')
      const store = storeFor(cwd, ctx)
      const forge = forgeInputFor(store, claimId, {})
      return await engineBridge(cwd).call({
        op: 'walk',
        input: { graph: forge.graph, root: claimId, ...(budget === undefined ? {} : { budget }) },
      })
    },
  })

  tools.push({
    name: 'list_claims',
    description:
      'List the inventory claims with the verdict recorded for each, so a whole inventory can be triaged without forging it again. Claims never forged show a null status.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'integer', description: 'Restrict to scope 1, 2 or 3.' },
        period: { type: 'string', description: 'Restrict to a reporting period, e.g. 2026-Q1.' },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    permissions: ['fs:read'],
    surface: 'core',
    handler: async (input: unknown, ctx: ToolContext) => {
      const scope = optionalInt(input, 'scope')
      const period = optionalString(input, 'period')
      const store = storeFor(cwd, ctx)
      const rows = store.listClaims({
        ...(scope === undefined ? {} : { scope }),
        ...(period === undefined ? {} : { period }),
      })
      return {
        count: rows.length,
        claims: rows.map((row) => {
          const verdict = store.latestVerdict(row.id)
          return {
            id: row.id,
            scope: row.scope,
            category: row.category,
            period: row.period,
            reportedTonnes: row.reported_tonnes,
            factorAddress: row.factor_address,
            address: row.address,
            status: verdict?.status ?? null,
            seal: verdict?.seal ?? null,
          }
        }),
      }
    },
  })

  tools.push({
    name: 'forge_inventory',
    description:
      'Forge every claim in the inventory and record each verdict, then return the census by status. Use this to establish which numbers in a reporting period still hold before asking about any individual one.',
    inputSchema: {
      type: 'object',
      properties: { sigFigs: { type: 'integer' }, tolerancePct: { type: 'string' } },
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    permissions: ['fs:read', 'fs:write', 'proc:spawn'],
    surface: 'core',
    handler: async (input: unknown, ctx: ToolContext) => {
      const sigFigs = optionalInt(input, 'sigFigs')
      const tolerancePct = optionalString(input, 'tolerancePct')
      const store = storeFor(cwd, ctx)
      const bridge = engineBridge(cwd)
      const options = {
        ...(sigFigs === undefined ? {} : { sigFigs }),
        ...(tolerancePct === undefined ? {} : { tolerancePct }),
      }
      const verdicts = []
      for (const row of store.listClaims()) {
        verdicts.push(await forgeClaim(bridge, store, row.id, options))
      }
      const byStatus: Record<string, number> = {}
      for (const verdict of verdicts) byStatus[verdict.status] = (byStatus[verdict.status] ?? 0) + 1
      return {
        count: verdicts.length,
        byStatus,
        seals: Object.fromEntries(verdicts.map((verdict) => [verdict.claimId, verdict.seal])),
      }
    },
  })

  tools.push({
    name: 'ingest_evidence',
    description:
      'Store a piece of evidence and return its content address. The address is the SHA-256 of the content, so identical evidence is stored once and a corrected document becomes a new address rather than an overwrite — which is what lets a claim still citing the old document be found.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The document text. Its bytes are what get hashed.' },
        kind: {
          type: 'string',
          enum: ['activity-data', 'emission-factor', 'calibration', 'method', 'invoice', 'report'],
        },
        label: { type: 'string' },
        supersedes: { type: 'string', description: 'Address of the document this one replaces.' },
        trusted: { type: 'boolean', description: 'Defaults to true.' },
      },
      required: ['content', 'kind', 'label'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    permissions: ['fs:read', 'fs:write'],
    surface: 'core',
    handler: async (input: unknown, ctx: ToolContext) => {
      const content = requireString(input, 'content')
      const kind = requireString(input, 'kind')
      const label = requireString(input, 'label')
      const supersedes = optionalString(input, 'supersedes')
      const trusted = (input as Record<string, unknown>).trusted
      const store = storeFor(cwd, ctx)
      const bytes = new TextEncoder().encode(content)
      const address = addressOf(bytes)
      const result = store.putDocument({
        address,
        kind,
        label,
        capturedAt: ctx.now(),
        supersedes: supersedes ?? null,
        trusted: trusted !== false,
        bytes,
      })
      return { address, stored: result.stored, kind, label }
    },
  })

  tools.push({
    name: 'evidence_catalogue',
    description:
      'List the evidence store: every document, its kind, whether it is trusted, and whether a newer revision has replaced it.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string' } },
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    permissions: ['fs:read'],
    surface: 'core',
    handler: async (input: unknown, ctx: ToolContext) => {
      const store = storeFor(cwd, ctx)
      const kind = optionalString(input, 'kind')
      const rows = store.listDocuments(...(kind === undefined ? [] : [kind]))
      const superseded = new Set(
        rows.map((row) => row.supersedes).filter((value): value is string => value !== null),
      )
      return {
        count: rows.length,
        documents: rows.map((row) => ({
          address: row.address,
          kind: row.kind,
          label: row.label,
          capturedAt: row.captured_at,
          trusted: row.trusted === 1,
          superseded: superseded.has(row.address),
          supersedes: row.supersedes,
        })),
      }
    },
  })

  tools.push({
    name: 'provenance_graph',
    description:
      'Return the whole provenance graph: nodes, edges, and the claim-to-evidence structure the walks run over. Use this to understand the shape of an inventory before querying it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object' },
    permissions: ['fs:read'],
    surface: 'core',
    handler: async (_input: unknown, ctx: ToolContext) => {
      const store = storeFor(cwd, ctx)
      const graph = buildGraph(store)
      return { nodes: graph.nodes.length, edges: graph.edges.length, graph }
    },
  })

  return tools
}

export function registerForgeTools(registry: ToolRegistry, cwd: string): ToolRegistry {
  return registry.registerAll(buildForgeTools(cwd), { source: 'core' })
}

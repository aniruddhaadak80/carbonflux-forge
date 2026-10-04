import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildToolRegistry, createContext } from './bootstrap.js'
import {
  claimAddress,
  evidenceSet,
  forgeInputFor,
  loadSeed,
  openSeededStore,
  seedStore,
} from './forge-service.js'

const dirs: string[] = []

/**
 * The repository root, found by walking up from this file rather than from `process.cwd()`.
 *
 * `npm test --workspace` runs vitest with the *package* directory as the cwd, so a test that
 * assumed the repo root would pass locally and fail in CI — and it did. Resolving from
 * `import.meta.url` makes the path correct regardless of who launched the runner.
 */
const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

/** A data directory per test, so no test can see another's verdicts. */
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-store-'))
  dirs.push(dir)
  return dir
}

function context(dir: string) {
  return { ...createContext('test'), dataDir: dir }
}

/**
 * The registry refuses a tool whose permissions were not granted. Tests assert validation
 * behaviour, so they grant everything — the permission gate has its own tests in core.
 */
const ALL_PERMISSIONS = ['fs:read', 'fs:write', 'net:fetch', 'proc:spawn'] as const

async function invokeTool(name: string, input: unknown, dir: string): Promise<unknown> {
  // A tool opens the store per call and does not expose the handle, so WAL/SHM files can still be
  // open when the call resolves. Without this pause, Windows returns EBUSY on the next test's
  // cleanup unlink — a lock artefact, not a product failure.
  await new Promise((resolve) => setTimeout(resolve, 25))
  return await buildToolRegistry(REPO).invoke(name, input, context(dir), [...ALL_PERMISSIONS])
}

afterEach(async () => {
  // SQLite in WAL mode leaves -wal and -shm files that Windows keeps locked for a moment after
  // the last handle closes. Retrying the removal is the difference between a deterministic suite
  // and one that fails on a fast machine.
  for (const dir of dirs.splice(0)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }
})

describe('the shipped example inventory', () => {
  it('parses, and every claim cites a factor that exists', () => {
    const seed = loadSeed(REPO)
    const refs = new Set(seed.documents.map((document) => document.ref))
    for (const claim of seed.claims) {
      expect(refs.has(claim.factorRef), `${claim.id} cites ${claim.factorRef}`).toBe(true)
    }
  })

  it('resolves every edge endpoint to a real node', () => {
    const seed = loadSeed(REPO)
    const refs = new Set(seed.documents.map((document) => document.ref))
    const ids = new Set(seed.claims.map((claim) => claim.id))
    for (const edge of seed.edges) {
      expect(refs.has(edge.from) || ids.has(edge.from), `edge source ${edge.from}`).toBe(true)
      expect(refs.has(edge.to) || ids.has(edge.to), `edge target ${edge.to}`).toBe(true)
    }
  })

  it('every claim carries a note explaining why it is in the dataset', () => {
    for (const claim of loadSeed(REPO).claims) {
      expect(claim.note, `${claim.id} has no note`).toBeTruthy()
    }
  })
})

describe('seeding', () => {
  it('loads documents, claims and edges', () => {
    const dir = dataDir()
    const store = openSeededStore(REPO, dir).store
    const seed = loadSeed(REPO)
    expect(store.listClaims()).toHaveLength(seed.claims.length)
    expect(store.listDocuments()).toHaveLength(seed.documents.length)
    expect(store.listEdges()).toHaveLength(seed.edges.length)
    store.close()
  })

  it('reports that it seeded only on first use', () => {
    const dir = dataDir()
    // The first open creates and seeds the store; the second finds it already populated. Both
    // handles are closed so the WAL is checkpointed before the next open reads it.
    const first = openSeededStore(REPO, dir)
    expect(first.seeded).toBe(true)
    first.store.close()

    const second = openSeededStore(REPO, dir)
    expect(second.seeded).toBe(false)
    second.store.close()
  })

  it('is idempotent — re-seeding does not duplicate anything', () => {
    const dir = dataDir()
    const store = openSeededStore(REPO, dir).store
    const claims = store.listClaims().length
    const documents = store.listDocuments().length
    seedStore(store, loadSeed(REPO))
    expect(store.listClaims()).toHaveLength(claims)
    expect(store.listDocuments()).toHaveLength(documents)
    store.close()
  })

  it('creates the data directory if it does not exist', () => {
    const parent = dataDir()
    const nested = join(parent, 'deep', 'nested')
    const store = openSeededStore(REPO, nested).store
    expect(store.listClaims().length).toBeGreaterThan(0)
    store.close()
  })

  it('rejects a claim citing a factor that does not exist', () => {
    const store = openSeededStore(REPO, dataDir()).store
    const broken = {
      period: '2026-Q1',
      documents: [],
      claims: [
        {
          id: 'a',
          scope: 1 as const,
          category: 'x',
          activityQuantity: '1',
          activityUnit: 'kWh',
          factorValue: '1',
          factorUnit: 'kgCO2e/kWh',
          factorRef: 'ghost',
          factorUncertaintyPct: '1',
          reportedTonnes: '1',
        },
      ],
      edges: [],
    }
    expect(() => seedStore(store, broken)).toThrow(/cites unknown factor/)
    store.close()
  })

  it('rejects an edge that points at an unknown node', () => {
    const store = openSeededStore(REPO, dataDir()).store
    const broken = {
      period: '2026-Q1',
      documents: [{ ref: 'f', kind: 'emission-factor' as const, label: 'F', content: 'x', trusted: true }],
      claims: [
        {
          id: 'a',
          scope: 1 as const,
          category: 'x',
          activityQuantity: '1',
          activityUnit: 'kWh',
          factorValue: '1',
          factorUnit: 'kgCO2e/kWh',
          factorRef: 'f',
          factorUncertaintyPct: '1',
          reportedTonnes: '1',
        },
      ],
      edges: [{ from: 'a', to: 'nowhere', relation: 'derived-from' as const }],
    }
    expect(() => seedStore(store, broken)).toThrow(/unknown node/)
    store.close()
  })
})

describe('claim addressing', () => {
  it('gives the same claim the same address every time', () => {
    const seed = loadSeed(REPO)
    const claim = seed.claims[0]
    if (claim === undefined) throw new Error('the seed inventory has no claims')
    const address = 'sha256:' + 'a'.repeat(64)
    const shape = {
      id: claim.id,
      scope: claim.scope,
      category: claim.category,
      period: seed.period,
      activityQuantity: claim.activityQuantity,
      activityUnit: claim.activityUnit,
      factorValue: claim.factorValue,
      factorUnit: claim.factorUnit,
      factorAddress: address,
      factorUncertaintyPct: claim.factorUncertaintyPct,
      reportedTonnes: claim.reportedTonnes,
    } as const
    expect(claimAddress(shape)).toBe(claimAddress(shape))
  })

  it('changes the address when the reported tonnage changes', () => {
    const seed = loadSeed(REPO)
    const claim = seed.claims[0]
    if (claim === undefined) throw new Error('the seed inventory has no claims')
    const address = 'sha256:' + 'a'.repeat(64)
    const base = {
      id: claim.id,
      scope: claim.scope,
      category: claim.category,
      period: seed.period,
      activityQuantity: claim.activityQuantity,
      activityUnit: claim.activityUnit,
      factorValue: claim.factorValue,
      factorUnit: claim.factorUnit,
      factorAddress: address,
      factorUncertaintyPct: claim.factorUncertaintyPct,
      reportedTonnes: claim.reportedTonnes,
    } as const
    expect(claimAddress(base)).not.toBe(claimAddress({ ...base, reportedTonnes: '999' }))
  })
})

describe('the graph built from the store', () => {
  it('has a node for every claim and every document', () => {
    const store = openSeededStore(REPO, dataDir()).store
    const seed = loadSeed(REPO)
    const input = forgeInputFor(store, 'scope1-stationary-gas')
    expect(input.graph.nodes).toHaveLength(seed.claims.length + seed.documents.length)
    store.close()
  })

  it('never leaves a dangling edge once refs are resolved', () => {
    const store = openSeededStore(REPO, dataDir()).store
    const input = forgeInputFor(store, 'scope1-stationary-gas')
    const ids = new Set(input.graph.nodes.map((node) => node.id))
    for (const edge of input.graph.edges) {
      expect(ids.has(edge.from), `${edge.from} missing`).toBe(true)
      expect(ids.has(edge.to), `${edge.to} missing`).toBe(true)
    }
    store.close()
  })

  it('carries every document as engine evidence', () => {
    const store = openSeededStore(REPO, dataDir()).store
    expect(evidenceSet(store)).toHaveLength(loadSeed(REPO).documents.length)
    store.close()
  })
})

describe('forgeInputFor', () => {
  it('refuses an unknown claim with a validation error', () => {
    const store = openSeededStore(REPO, dataDir()).store
    expect(() => forgeInputFor(store, 'no-such-claim')).toThrow(/no claim with id/)
    store.close()
  })

  it('defaults the root to the claim id', () => {
    const store = openSeededStore(REPO, dataDir()).store
    expect(forgeInputFor(store, 'scope1-fleet-diesel').root).toBe('scope1-fleet-diesel')
    store.close()
  })

  it('passes options through only when given', () => {
    const store = openSeededStore(REPO, dataDir()).store
    expect(forgeInputFor(store, 'scope1-fleet-diesel').sigFigs).toBeUndefined()
    expect(forgeInputFor(store, 'scope1-fleet-diesel', { sigFigs: 3 }).sigFigs).toBe(3)
    store.close()
  })
})

describe('the tool registry', () => {
  it('registers the five baseline tools and the eight forge tools', () => {
    const names = buildToolRegistry(REPO).names()
    for (const expected of [
      'list_skills',
      'list_plugins',
      'engine_summarize',
      'engine_diff',
      'engine_normalize',
      'forge_verdict',
      'recompute_claim',
      'walk_provenance',
      'list_claims',
      'forge_inventory',
      'ingest_evidence',
      'evidence_catalogue',
      'provenance_graph',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('gives every tool an object input schema and a real description', () => {
    for (const tool of buildToolRegistry(REPO).list()) {
      expect(tool.inputSchema).toHaveProperty('type', 'object')
      expect(tool.description.length).toBeGreaterThan(30)
      expect(tool.permissions.length).toBeGreaterThan(0)
    }
  })

  it('names every tool so it is safe to expose over MCP', () => {
    for (const tool of buildToolRegistry(REPO).list()) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})

describe('input validation happens before the handler', () => {
  it('rejects a missing claimId', async () => {
    await expect(invokeTool('forge_verdict', {}, dataDir())).rejects.toThrow(/claimId/)
  })

  it('rejects a non-integer budget', async () => {
    await expect(
      invokeTool('walk_provenance', { claimId: 'scope1-fleet-diesel', budget: 1.5 }, dataDir()),
    ).rejects.toThrow(/must be an integer/)
  })

  it('rejects a non-string period', async () => {
    await expect(invokeTool('list_claims', { period: 42 }, dataDir())).rejects.toThrow(/must be a string/)
  })

  it('rejects ingest_evidence without content', async () => {
    await expect(invokeTool('ingest_evidence', { kind: 'report', label: 'x' }, dataDir())).rejects.toThrow(
      /content/,
    )
  })
})

describe('tools that do not need the engine', () => {
  it('list_claims returns the inventory with no prior verdicts', async () => {
    const result = (await invokeTool('list_claims', {}, dataDir())) as {
      count: number
      claims: { id: string; status: string | null }[]
    }
    expect(result.count).toBe(loadSeed(REPO).claims.length)
    expect(result.claims.every((claim) => claim.status === null)).toBe(true)
  })

  it('list_claims filters by scope', async () => {
    const result = (await invokeTool('list_claims', { scope: 2 }, dataDir())) as {
      count: number
      claims: { scope: number }[]
    }
    expect(result.claims.every((claim) => claim.scope === 2)).toBe(true)
  })

  it('evidence_catalogue marks the replaced factor as superseded', async () => {
    const result = (await invokeTool('evidence_catalogue', {}, dataDir())) as {
      documents: { address: string; superseded: boolean }[]
    }
    expect(result.documents.some((document) => document.superseded)).toBe(true)
  })

  it('ingest_evidence returns a content address and dedupes identical bytes', async () => {
    const dir = dataDir()
    const input = { content: 'a,b\n1,2\n', kind: 'activity-data', label: 'First' }
    const first = (await invokeTool('ingest_evidence', input, dir)) as {
      address: string
      stored: boolean
    }
    const second = (await invokeTool('ingest_evidence', input, dir)) as {
      address: string
      stored: boolean
    }

    expect(first.address).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(first.stored).toBe(true)
    expect(second.stored).toBe(false)
    expect(second.address).toBe(first.address)
  })

  it('a corrected document gets a new address rather than overwriting', async () => {
    const dir = dataDir()
    const original = (await invokeTool(
      'ingest_evidence',
      { content: 'value\n1\n', kind: 'report', label: 'Original' },
      dir,
    )) as { address: string }
    const corrected = (await invokeTool(
      'ingest_evidence',
      { content: 'value\n2\n', kind: 'report', label: 'Corrected', supersedes: original.address },
      dir,
    )) as { address: string }

    expect(corrected.address).not.toBe(original.address)

    const catalogue = (await invokeTool('evidence_catalogue', {}, dir)) as {
      documents: { address: string; superseded: boolean }[]
    }
    const old = catalogue.documents.find((document) => document.address === original.address)
    expect(old?.superseded).toBe(true)
  })

  it('provenance_graph reports node and edge counts', async () => {
    const result = (await invokeTool('provenance_graph', {}, dataDir())) as {
      nodes: number
      edges: number
    }
    const seed = loadSeed(REPO)
    expect(result.nodes).toBe(seed.claims.length + seed.documents.length)
    expect(result.edges).toBe(seed.edges.length)
  })
})

describe('a temporary directory exists for the store', () => {
  it('dataDir() creates a unique directory per test', () => {
    const first = dataDir()
    const second = dataDir()
    expect(first).not.toBe(second)
    mkdirSync(first, { recursive: true })
  })
})

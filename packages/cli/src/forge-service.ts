import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ValidationError,
  type Claim,
  type EvidenceDocument,
  type ForgeInput,
  type ProvenanceGraph,
  type Relation,
  type Verdict,
} from '@carbonfluxforge/core'
import { EngineBridge } from '@carbonfluxforge/engine-client'
import { Store, addressOf, addressOfText, type ClaimRow, type DocumentRow } from '@carbonfluxforge/memory'

/** The seed dataset is a fixture, so its timestamps are fixed rather than read from the clock. */
export const SEED_CAPTURED_AT = 1_767_225_600_000

export const ENGINE_MODULE = 'carbonflux_forge'

interface SeedDocument {
  readonly ref: string
  readonly kind: EvidenceDocument['kind']
  readonly label: string
  readonly trusted?: boolean
  readonly supersedes?: string
  readonly content: string
}

interface SeedClaim {
  readonly id: string
  readonly scope: 1 | 2 | 3
  readonly category: string
  readonly activityQuantity: string
  readonly activityUnit: string
  readonly factorValue: string
  readonly factorUnit: string
  readonly factorRef: string
  readonly factorUncertaintyPct: string
  readonly reportedTonnes: string
  readonly note?: string
}

interface SeedEdge {
  readonly from: string
  readonly to: string
  readonly relation: Relation
}

interface Seed {
  readonly period: string
  readonly documents: readonly SeedDocument[]
  readonly claims: readonly SeedClaim[]
  readonly edges: readonly SeedEdge[]
}

export function loadSeed(cwd: string): Seed {
  const path = join(cwd, 'examples', 'inventory.json')
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new ValidationError(`cannot read the example inventory at ${path}`, { cause: String(cause) })
  }
  try {
    return JSON.parse(raw) as Seed
  } catch (cause) {
    throw new ValidationError(`examples/inventory.json is not valid JSON: ${String(cause)}`)
  }
}

/** A claim's address is the hash of its own content, exactly as a document's is. */
export function claimAddress(claim: Claim): string {
  return addressOfText(
    JSON.stringify([
      claim.id,
      claim.scope,
      claim.category,
      claim.period,
      claim.activityQuantity,
      claim.activityUnit,
      claim.factorValue,
      claim.factorUnit,
      claim.factorAddress,
      claim.factorUncertaintyPct,
      claim.reportedTonnes,
    ]),
  )
}

export function documentAddress(document: Pick<SeedDocument, 'content'>): string {
  return addressOfText(document.content)
}

/**
 * Loads the example inventory into an empty store.
 *
 * Idempotent: documents are content-addressed, so re-seeding is a no-op, and claims are keyed by
 * id with an upsert. That means `forge` can be run repeatedly on the same data directory without
 * the store drifting.
 */
export function seedStore(store: Store, seed: Seed): { documents: number; claims: number; edges: number } {
  const refToAddress = new Map<string, string>()
  for (const document of seed.documents) {
    const address = documentAddress(document)
    refToAddress.set(document.ref, address)
    store.putDocument({
      address,
      kind: document.kind,
      label: document.label,
      capturedAt: SEED_CAPTURED_AT,
      supersedes: document.supersedes === undefined ? null : (refToAddress.get(document.supersedes) ?? null),
      trusted: document.trusted !== false,
      bytes: new TextEncoder().encode(document.content),
    })
  }

  // Supersession is a second pass: a document may be superseded by one declared after it.
  for (const document of seed.documents) {
    if (document.supersedes === undefined) continue
    const address = refToAddress.get(document.ref)
    const target = refToAddress.get(document.supersedes)
    if (address === undefined || target === undefined) {
      throw new ValidationError(
        `document "${document.ref}" supersedes unknown reference "${document.supersedes ?? ''}"`,
      )
    }
    store.putDocument({
      address,
      kind: document.kind,
      label: document.label,
      capturedAt: SEED_CAPTURED_AT,
      supersedes: target,
      trusted: document.trusted !== false,
    })
  }

  for (const claim of seed.claims) {
    const factorAddress = refToAddress.get(claim.factorRef)
    if (factorAddress === undefined) {
      throw new ValidationError(`claim "${claim.id}" cites unknown factor "${claim.factorRef}"`)
    }
    const address = claimAddress({
      id: claim.id,
      scope: claim.scope,
      category: claim.category,
      period: seed.period,
      activityQuantity: claim.activityQuantity,
      activityUnit: claim.activityUnit,
      factorValue: claim.factorValue,
      factorUnit: claim.factorUnit,
      factorAddress: factorAddress as `sha256:${string}`,
      factorUncertaintyPct: claim.factorUncertaintyPct,
      reportedTonnes: claim.reportedTonnes,
    })
    store.putClaim({
      address,
      id: claim.id,
      scope: claim.scope,
      category: claim.category,
      period: seed.period,
      activityQuantity: claim.activityQuantity,
      activityUnit: claim.activityUnit,
      factorValue: claim.factorValue,
      factorUnit: claim.factorUnit,
      factorAddress,
      factorUncertaintyPct: claim.factorUncertaintyPct,
      reportedTonnes: claim.reportedTonnes,
      now: SEED_CAPTURED_AT,
    })
  }

  // An edge endpoint is either an evidence reference or a claim id — documents derive from
  // documents, and a circular provenance chain points back at a claim. Evidence refs are resolved
  // to their content address here, or the graph would carry refs the walk can never match.
  const claimIds = new Set(seed.claims.map((claim) => claim.id))
  const resolve = (endpoint: string, side: string): string => {
    const address = refToAddress.get(endpoint)
    if (address !== undefined) return address
    if (claimIds.has(endpoint)) return endpoint
    throw new ValidationError(`edge ${side} references unknown node "${endpoint}"`)
  }

  for (const edge of seed.edges) {
    store.putEdge({
      from: resolve(edge.from, 'source'),
      to: resolve(edge.to, 'target'),
      relation: edge.relation,
    })
  }

  return { documents: seed.documents.length, claims: seed.claims.length, edges: seed.edges.length }
}

export function rowToClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    scope: row.scope as 1 | 2 | 3,
    category: row.category,
    activityQuantity: row.activity_quantity,
    activityUnit: row.activity_unit,
    factorValue: row.factor_value,
    factorUnit: row.factor_unit,
    factorAddress: row.factor_address as `sha256:${string}`,
    factorUncertaintyPct: row.factor_uncertainty_pct,
    reportedTonnes: row.reported_tonnes,
    period: row.period,
  }
}

export function rowToDocument(row: DocumentRow): EvidenceDocument {
  return {
    address: row.address as `sha256:${string}`,
    kind: row.kind as EvidenceDocument['kind'],
    label: row.label,
    capturedAt: row.captured_at,
    supersedes: row.supersedes as `sha256:${string}` | null,
    trusted: row.trusted === 1,
  }
}

/** Every claim and every document, wired by the stored edges, as one graph. */
export function buildGraph(store: Store): ProvenanceGraph {
  const nodes = [
    ...store.listClaims().map((row) => ({
      id: row.id,
      type: 'claim' as const,
      address: row.address as `sha256:${string}`,
      kind: `scope-${row.scope}`,
      trusted: true,
    })),
    ...store.listDocuments().map((row) => ({
      id: row.address,
      type: 'document' as const,
      address: row.address as `sha256:${string}`,
      kind: row.kind,
      trusted: row.trusted === 1,
    })),
  ]
  const edges = store.listEdges().map((row) => ({
    from: row.from_id,
    to: row.to_id,
    relation: row.relation as Relation,
  }))
  return { nodes, edges }
}

export function evidenceSet(store: Store): readonly EvidenceDocument[] {
  return store.listDocuments().map(rowToDocument)
}

/** Opens the store the tool context points at, seeding it on first use. */
export function openSeededStore(cwd: string, dataDir: string): { store: Store; seeded: boolean } {
  // The data directory is created on demand: a first run should not require the operator to know
  // that a directory has to exist before the product works.
  mkdirSync(dataDir, { recursive: true })
  const store = new Store(join(dataDir, 'carbonflux.sqlite'))
  const empty = store.listClaims().length === 0
  if (empty) seedStore(store, loadSeed(cwd))
  return { store, seeded: empty }
}

export function engineBridge(cwd: string): EngineBridge {
  return new EngineBridge({ module: ENGINE_MODULE, cwd: join(cwd, 'services', 'engine', 'src') })
}

export interface ForgeOptions {
  readonly budget?: number
  readonly sigFigs?: number
  readonly tolerancePct?: string
}

export function forgeInputFor(store: Store, claimId: string, options: ForgeOptions = {}): ForgeInput {
  const row = store.getClaim(claimId)
  if (row === undefined) throw new ValidationError(`no claim with id "${claimId}"`, { claimId })
  return {
    claim: rowToClaim(row),
    documents: evidenceSet(store),
    graph: buildGraph(store),
    root: claimId,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.sigFigs === undefined ? {} : { sigFigs: options.sigFigs }),
    ...(options.tolerancePct === undefined ? {} : { tolerancePct: options.tolerancePct }),
  }
}

export async function forgeClaim(
  bridge: EngineBridge,
  store: Store,
  claimId: string,
  options: ForgeOptions = {},
  now: number = SEED_CAPTURED_AT,
): Promise<Verdict> {
  const verdict = await bridge.call<Verdict>({
    op: 'forge',
    input: forgeInputFor(store, claimId, options),
  })
  store.putVerdict({
    claimId: verdict.claimId,
    seal: verdict.seal,
    status: verdict.status,
    payload: verdict,
    now,
  })
  return verdict
}

export function addressOfBytes(bytes: Uint8Array): string {
  return addressOf(bytes)
}

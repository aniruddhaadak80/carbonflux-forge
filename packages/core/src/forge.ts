/**
 * The product's domain types.
 *
 * These are the shapes that cross the narrow waist and the boundary to the Python engine. They
 * live in `core` because `core` has no dependencies and no I/O: anything may depend on these
 * types, and they depend on nothing.
 *
 * Every numeric quantity that represents an amount of carbon is a **string**, never a number.
 * `tCO2e` is summed across thousands of inventory rows and audited to the decimal place;
 * IEEE-754 rounding is a finding in that context, not a rounding nuance. The Python engine
 * parses them as `Decimal`.
 */

/** A content address: the SHA-256 of the document's bytes, in the document's own form. */
export type Address = `sha256:${string}`

export const ADDRESS_PATTERN = /^sha256:[0-9a-f]{64}$/

export function isAddress(value: unknown): value is Address {
  return typeof value === 'string' && ADDRESS_PATTERN.test(value)
}

export type DocumentKind =
  'activity-data' | 'emission-factor' | 'calibration' | 'method' | 'invoice' | 'report'

/** One piece of evidence, identified by the hash of its bytes rather than by a filename. */
export interface EvidenceDocument {
  readonly address: Address
  readonly kind: DocumentKind
  readonly label: string
  readonly capturedAt: number
  readonly supersedes: Address | null
  readonly trusted: boolean
}

/** How one node in the provenance graph depends on another. */
export type Relation = 'derived-from' | 'calibrated-by' | 'measured-by' | 'supersedes'

/** One row of a GHG inventory: a number, and the evidence that is supposed to produce it. */
export interface Claim {
  readonly id: string
  readonly scope: 1 | 2 | 3
  readonly category: string
  readonly activityQuantity: string
  readonly activityUnit: string
  readonly factorValue: string
  readonly factorUnit: string
  readonly factorAddress: Address
  readonly factorUncertaintyPct: string
  readonly reportedTonnes: string
  readonly period: string
}

export interface ProvenanceNode {
  readonly id: string
  readonly type: 'claim' | 'document'
  readonly address: Address
  readonly kind: string
  readonly trusted: boolean
}

export interface ProvenanceEdge {
  readonly from: string
  readonly to: string
  readonly relation: Relation
}

export interface ProvenanceGraph {
  readonly nodes: readonly ProvenanceNode[]
  readonly edges: readonly ProvenanceEdge[]
}

export interface Defect {
  readonly code: string
  readonly message: string
  readonly node: string
}

/** Verdict status, in the precedence the engine applies: circular beats unsupported. */
export type VerdictStatus = 'supported' | 'unsupported' | 'circular' | 'unverified'

export interface FactorReport {
  readonly address: Address
  readonly kind: string
  readonly present: boolean
  readonly trusted: boolean
  readonly superseded: boolean
}

export interface ClaimComputation {
  readonly claimId: string
  readonly recomputedKg: string
  readonly recomputedTonnes: string
  readonly exactTonnes: string
  readonly reportedTonnes: string
  readonly deltaTonnes: string
  readonly deltaPct: string
  readonly uncertaintyTonnes: string
  readonly roundingResidual: string
  readonly withinTolerance: boolean
  readonly tolerancePct: string
  readonly sigFigs: number
  readonly factors: readonly FactorReport[]
  readonly defects: readonly Defect[]
}

export interface Terminal {
  readonly id: string
  readonly address: Address
  readonly kind: string
}

export interface ProvenanceWalk {
  readonly root: string
  readonly visited: number
  readonly budget: number
  readonly budgetExhausted: boolean
  readonly supportDepth: number
  readonly terminals: readonly Terminal[]
  /** One reconstructed root-to-terminal chain per terminal, capped by the engine. */
  readonly paths: readonly (readonly string[])[]
  readonly pathsTruncated: boolean
  readonly cycle: readonly string[] | null
  readonly defects: readonly Defect[]
}

export interface Verdict {
  readonly claimId: string
  readonly status: VerdictStatus
  readonly reasons: readonly string[]
  readonly computation: ClaimComputation
  readonly walk: ProvenanceWalk
  /** Content address of the verdict's substance. Identical inputs always produce an identical seal. */
  readonly seal: Address
  readonly engine: string
}

/** The engine's input for a full forge: one claim, its evidence, and the graph they sit in. */
export interface ForgeInput {
  readonly claim: Claim
  readonly documents: readonly EvidenceDocument[]
  readonly graph: ProvenanceGraph
  readonly root?: string
  readonly budget?: number
  readonly sigFigs?: number
  readonly tolerancePct?: string
}

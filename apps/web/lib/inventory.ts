import raw from '@/data/inventory.json'

/**
 * The web app's data layer.
 *
 * Per ADR 0003 this app depends on no workspace package, so it cannot call the Python engine:
 * Vercel runs Node. The verdicts in `data/inventory.json` were produced by the real engine via
 * `npm run fixtures`, and this module only reads and types them. Nothing here recomputes a
 * tonnage or re-walks a graph — a second implementation of the engine is the one thing this
 * repository must never contain.
 */

export type VerdictStatus = 'supported' | 'unsupported' | 'circular' | 'unverified'

export interface SpineNode {
  readonly id: string
  readonly address: string
  readonly kind: string
  readonly type: string
  readonly trusted: boolean
  readonly label: string | null
  readonly relation: string | null
}

export interface Terminal {
  readonly id: string
  readonly address: string
  readonly kind: string
}

export interface Claim {
  readonly id: string
  readonly scope: number
  readonly category: string
  readonly period: string
  readonly note: string | null
  readonly reportedTonnes: string
  readonly recomputedTonnes: string
  readonly deltaTonnes: string
  readonly deltaPct: string
  readonly uncertaintyTonnes: string
  readonly activityQuantity: string
  readonly activityUnit: string
  readonly factorValue: string
  readonly factorUnit: string
  readonly factorAddress: string
  readonly factorRef: string
  readonly factorLabel: string | null
  readonly status: VerdictStatus
  readonly seal: string
  readonly reasons: readonly string[]
  readonly supportDepth: number
  readonly visited: number
  readonly terminals: readonly Terminal[]
  readonly spine: readonly SpineNode[]
  readonly allPaths: number
}

export interface EvidenceDocument {
  readonly address: string
  readonly kind: string
  readonly label: string
  readonly trusted: boolean
  readonly supersedes: string | null
  readonly bytes: number
}

export interface Census {
  readonly total: number
  readonly byStatus: Readonly<Record<string, number>>
}

export interface Inventory {
  readonly generatedBy: string
  readonly engine: string
  readonly note: string
  readonly period: string
  readonly census: Census
  readonly totals: { readonly reportedTonnes: string; readonly recomputedTonnes: string }
  readonly documents: readonly EvidenceDocument[]
  readonly claims: readonly Claim[]
}

const data = raw as unknown as Inventory

export const INVENTORY: Inventory = data

export function claimsByStatus(status: VerdictStatus): readonly Claim[] {
  return INVENTORY.claims.filter((claim) => claim.status === status)
}

export function findClaim(id: string): Claim | undefined {
  return INVENTORY.claims.find((claim) => claim.id === id)
}

export function documentsSuperseding(address: string): readonly EvidenceDocument[] {
  return INVENTORY.documents.filter((document) => document.supersedes === address)
}

/** Trims a digest for display while keeping both ends, so a truncation cannot hide a collision. */
export function shortAddress(address: string): string {
  const digest = address.startsWith('sha256:') ? address.slice(7) : address
  if (digest.length <= 12) return digest
  return `${digest.slice(0, 8)}…${digest.slice(-4)}`
}

/** Status ordering used everywhere a list of verdicts is shown: worst first. */
export const STATUS_ORDER: readonly VerdictStatus[] = ['circular', 'unsupported', 'unverified', 'supported']

export function orderedClaims(claims: readonly Claim[]): readonly Claim[] {
  const weight = new Map(STATUS_ORDER.map((status, index) => [status, index]))
  return [...claims].sort((left, right) => {
    const byStatus = (weight.get(left.status) ?? 9) - (weight.get(right.status) ?? 9)
    return byStatus !== 0 ? byStatus : left.id.localeCompare(right.id)
  })
}

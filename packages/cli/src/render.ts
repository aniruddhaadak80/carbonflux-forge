import type { ClaimComputation, ProvenanceWalk, Verdict } from '@carbonfluxforge/core'
import { shortAddress } from '@carbonfluxforge/memory'

const STATUS_LABEL: Record<string, string> = {
  supported: 'SUPPORTED',
  unsupported: 'UNSUPPORTED',
  circular: 'CIRCULAR',
  unverified: 'UNVERIFIED',
}

export function renderVerdict(verdict: Verdict): string {
  const lines = [
    `${verdict.claimId}  ${STATUS_LABEL[verdict.status] ?? verdict.status}`,
    '',
    `  reported      ${verdict.computation.reportedTonnes} tCO2e`,
    `  recomputed    ${verdict.computation.recomputedTonnes} tCO2e`,
    `  delta         ${verdict.computation.deltaTonnes} tCO2e (${verdict.computation.deltaPct}%)`,
    `  uncertainty   +/- ${verdict.computation.uncertaintyTonnes} tCO2e from the factor`,
    `  support depth ${verdict.walk.supportDepth}`,
    `  terminal      ${verdict.walk.terminals.map((t) => shortAddress(t.address)).join(', ') || '(none)'}`,
    `  seal          ${verdict.seal}`,
  ]
  if (verdict.reasons.length > 0) {
    lines.push('', '  reasons:')
    for (const reason of verdict.reasons) lines.push(`    - ${reason}`)
  }
  return lines.join('\n')
}

export function renderCensus(census: { count: number; byStatus: Record<string, number> }): string {
  const lines = [`${census.count} claims forged`, '']
  for (const status of ['supported', 'unsupported', 'circular', 'unverified']) {
    const count = census.byStatus[status] ?? 0
    lines.push(`  ${STATUS_LABEL[status]}  ${String(count).padStart(3)}  ${bar(count, census.count)}`)
  }
  return lines.join('\n')
}

function bar(count: number, total: number): string {
  if (total === 0) return ''
  const width = Math.round((count / total) * 24)
  return '#'.repeat(width)
}

interface ClaimRowView {
  id: string
  scope: number
  reportedTonnes: string
  status: string | null
  seal: string | null
}

export function renderClaims(result: { count: number; claims: ClaimRowView[] }): string {
  if (result.claims.length === 0) return 'no claims in this inventory'
  const width = Math.max(...result.claims.map((claim) => claim.id.length), 4)
  const lines = [`${result.count} claims`, '']
  for (const claim of result.claims) {
    const status = claim.status === null ? 'UNFORGED' : (STATUS_LABEL[claim.status] ?? claim.status)
    lines.push(
      `  ${claim.id.padEnd(width)}  scope ${claim.scope}  ${claim.reportedTonnes.padStart(10)} tCO2e  ${status}`,
    )
  }
  return lines.join('\n')
}

export function renderWalk(walk: ProvenanceWalk): string {
  const lines = [
    `walk from ${walk.root}`,
    '',
    `  visited        ${walk.visited} (budget ${walk.budget})`,
    `  support depth  ${walk.supportDepth}`,
    `  budget spent   ${walk.budgetExhausted ? 'YES — chain is longer than the budget' : 'no'}`,
    `  circular       ${walk.cycle === null ? 'no' : walk.cycle.join(' -> ')}`,
  ]
  if (walk.terminals.length > 0) {
    lines.push('', '  terminal evidence:')
    for (const terminal of walk.terminals) {
      lines.push(`    ${shortAddress(terminal.address)}  ${terminal.kind}  ${terminal.id}`)
    }
  }
  if (walk.defects.length > 0) {
    lines.push('', '  defects:')
    for (const defect of walk.defects) lines.push(`    - ${defect.code}: ${defect.message}`)
  }
  return lines.join('\n')
}

export function renderComputation(computation: ClaimComputation): string {
  const lines = [
    computation.claimId,
    '',
    `  reported      ${computation.reportedTonnes} tCO2e`,
    `  recomputed    ${computation.recomputedTonnes} tCO2e  (${computation.recomputedKg} kgCO2e)`,
    `  delta         ${computation.deltaTonnes} tCO2e (${computation.deltaPct}%)`,
    `  tolerance     ${computation.tolerancePct}%  ->  ${
      computation.withinTolerance ? 'within tolerance' : 'OUTSIDE TOLERANCE'
    }`,
    `  uncertainty   +/- ${computation.uncertaintyTonnes} tCO2e`,
    `  significant   ${computation.sigFigs} figures (residual ${computation.roundingResidual})`,
  ]
  if (computation.defects.length > 0) {
    lines.push('', '  defects:')
    for (const defect of computation.defects) lines.push(`    - ${defect.code}: ${defect.message}`)
  }
  return lines.join('\n')
}

interface EvidenceView {
  count: number
  documents: {
    address: string
    kind: string
    label: string
    trusted: boolean
    superseded: boolean
  }[]
}

export function renderEvidence(result: EvidenceView): string {
  if (result.documents.length === 0) return 'the evidence store is empty'
  const lines = [`${result.count} documents`, '']
  for (const document of result.documents) {
    const flags = [document.trusted ? 'trusted' : 'UNTRUSTED']
    if (document.superseded) flags.push('SUPERSEDED')
    lines.push(
      `  ${shortAddress(document.address)}  ${document.kind.padEnd(15)} ${flags.join(' ').padEnd(18)} ${document.label}`,
    )
  }
  return lines.join('\n')
}

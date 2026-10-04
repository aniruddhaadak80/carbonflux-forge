#!/usr/bin/env node
// Produces the data the web app renders, by running the real Python engine over the shipped
// example inventory and writing the verdicts it returns.
//
// Why this exists, stated plainly: Vercel runs Node, not Python, so a server-rendered route
// cannot call the engine at request time. Re-implementing the engine in TypeScript to work
// around that would give the product two engines and one of them unverified — exactly the
// failure this repository exists to prevent. So the verdicts are computed here, by the engine,
// and committed. The web app renders committed, engine-produced truth.
//
//   npm run fixtures
//
// The output is deterministic: same input, same bytes, so a rebuild with no change is a no-op.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = process.cwd()
const SEED = join(ROOT, 'examples', 'inventory.json')
const OUT = join(ROOT, 'apps', 'web', 'data', 'inventory.json')
const ENGINE_SRC = join(ROOT, 'services', 'engine', 'src')
const CAPTURED_AT = 1_767_225_600_000

function addressOf(text) {
  return `sha256:${createHash('sha256').update(new TextEncoder().encode(text)).digest('hex')}`
}

/** Calls the engine the same way the CLI does: one JSON request in, one JSON response out. */
function callEngine(op, input) {
  const stdout = execFileSync(process.env.PYTHON ?? 'python', ['-m', 'carbonflux_forge'], {
    cwd: ENGINE_SRC,
    input: JSON.stringify({ op, input }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const response = JSON.parse(stdout)
  if (!response.ok) {
    throw new Error(`engine op "${op}" failed: ${response.error.code} ${response.error.message}`)
  }
  return response.value
}

const seed = JSON.parse(readFileSync(SEED, 'utf8'))

// Documents become content-addressed exactly as the CLI does it.
const addressByRef = new Map()
const documents = seed.documents.map((document) => {
  const address = addressOf(document.content)
  addressByRef.set(document.ref, address)
  return {
    address,
    ref: document.ref,
    kind: document.kind,
    label: document.label,
    trusted: document.trusted !== false,
    supersedesRef: document.supersedes ?? null,
    bytes: Buffer.byteLength(document.content, 'utf8'),
  }
})
// Second pass so a document can be superseded by one declared after it.
for (const document of documents) {
  document.supersedes =
    document.supersedesRef === null ? null : (addressByRef.get(document.supersedesRef) ?? null)
}

const byAddress = new Map(documents.map((document) => [document.address, document]))
const claimIds = new Set(seed.claims.map((claim) => claim.id))
const resolve = (endpoint) => addressByRef.get(endpoint) ?? (claimIds.has(endpoint) ? endpoint : null)

const nodes = [
  ...seed.claims.map((claim) => {
    return {
      id: claim.id,
      type: 'claim',
      address: addressOf(JSON.stringify(Object.values(claim).slice(0, 12))),
      kind: `scope-${claim.scope}`,
      trusted: true,
    }
  }),
  ...documents.map((document) => ({
    id: document.address,
    type: 'document',
    address: document.address,
    kind: document.kind,
    trusted: document.trusted,
  })),
]

const edges = seed.edges.map((edge) => {
  const from = resolve(edge.from)
  const to = resolve(edge.to)
  if (from === null || to === null) {
    throw new Error(`edge ${edge.from} -> ${edge.to} references an unknown node`)
  }
  return { from, to, relation: edge.relation }
})

const graph = { nodes, edges }
const evidence = documents.map((document) => ({
  address: document.address,
  kind: document.kind,
  label: document.label,
  capturedAt: CAPTURED_AT,
  supersedes: document.supersedes,
  trusted: document.trusted,
}))

const claims = []
for (const claim of seed.claims) {
  const factorAddress = addressByRef.get(claim.factorRef)
  if (factorAddress === undefined) throw new Error(`claim ${claim.id} cites unknown ${claim.factorRef}`)
  const verdict = callEngine('forge', {
    claim: {
      id: claim.id,
      scope: claim.scope,
      category: claim.category,
      activityQuantity: claim.activityQuantity,
      activityUnit: claim.activityUnit,
      factorValue: claim.factorValue,
      factorUnit: claim.factorUnit,
      factorAddress,
      factorUncertaintyPct: claim.factorUncertaintyPct,
      reportedTonnes: claim.reportedTonnes,
      period: seed.period,
    },
    documents: evidence,
    graph,
    root: claim.id,
    sigFigs: 6,
    tolerancePct: '2',
  })

  // The spine the UI draws: the chain as node descriptors, so the page never has to know how a
  // walk works or resolve an address itself.
  const spine = (verdict.walk.paths[0] ?? [claim.id]).map((id) => {
    const node = nodes.find((candidate) => candidate.id === id)
    const document = byAddress.get(id)
    return {
      id,
      address: node?.address ?? id,
      kind: node?.kind ?? 'claim',
      type: node?.type ?? 'claim',
      trusted: node?.trusted ?? true,
      label: document?.label ?? null,
      relation: null,
    }
  })
  for (let index = 0; index < spine.length - 1; index += 1) {
    const edge = edges.find(
      (candidate) => candidate.from === spine[index].id && candidate.to === spine[index + 1].id,
    )
    spine[index].relation = edge?.relation ?? null
  }

  claims.push({
    id: claim.id,
    scope: claim.scope,
    category: claim.category,
    period: seed.period,
    note: claim.note ?? null,
    reportedTonnes: verdict.computation.reportedTonnes,
    recomputedTonnes: verdict.computation.recomputedTonnes,
    deltaTonnes: verdict.computation.deltaTonnes,
    deltaPct: verdict.computation.deltaPct,
    uncertaintyTonnes: verdict.computation.uncertaintyTonnes,
    activityQuantity: claim.activityQuantity,
    activityUnit: claim.activityUnit,
    factorValue: claim.factorValue,
    factorUnit: claim.factorUnit,
    factorAddress,
    factorRef: claim.factorRef,
    factorLabel: byAddress.get(factorAddress)?.label ?? null,
    status: verdict.status,
    seal: verdict.seal,
    reasons: verdict.reasons,
    supportDepth: verdict.walk.supportDepth,
    visited: verdict.walk.visited,
    terminals: verdict.walk.terminals,
    spine,
    allPaths: verdict.walk.paths.length,
  })
}

const byStatus = {}
for (const claim of claims) byStatus[claim.status] = (byStatus[claim.status] ?? 0) + 1

const output = {
  generatedBy: 'scripts/build-fixtures.mjs',
  engine: 'carbonflux_forge/1',
  note: 'Every verdict below was produced by the Python engine. The web app renders this file; it does not recompute anything.',
  period: seed.period,
  census: { total: claims.length, byStatus },
  totals: {
    reportedTonnes: claims
      .map((claim) => Number(claim.reportedTonnes))
      .reduce((sum, value) => sum + value, 0)
      .toFixed(6),
    recomputedTonnes: claims
      .map((claim) => Number(claim.recomputedTonnes))
      .reduce((sum, value) => sum + value, 0)
      .toFixed(6),
  },
  graph: { nodes, edges },
  documents: documents.map((document) => ({
    address: document.address,
    kind: document.kind,
    label: document.label,
    trusted: document.trusted,
    supersedes: document.supersedes,
    bytes: document.bytes,
  })),
  claims,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

console.log(`wrote ${OUT}`)
console.log(`  ${claims.length} claims forged by the engine`)
console.log(
  `  census: ${Object.entries(byStatus)
    .sort()
    .map(([status, count]) => `${status}=${count}`)
    .join(' ')}`,
)
console.log(`  engine: ${output.engine}`)

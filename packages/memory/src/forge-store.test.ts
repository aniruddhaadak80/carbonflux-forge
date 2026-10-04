import { describe, expect, it } from 'vitest'
import { Store } from './store.js'
import { addressOf, addressOfText, shortAddress } from './content-address.js'

const A = addressOfText('grid factor 2026')
const B = addressOfText('grid factor 2026 revised')
const C = addressOfText('meter reading january')

function document(overrides: Partial<Parameters<Store['putDocument']>[0]> = {}) {
  return {
    address: A,
    kind: 'emission-factor',
    label: 'UK grid factor 2026',
    capturedAt: 1_770_000_000_000,
    ...overrides,
  }
}

function claim(overrides: Partial<Parameters<Store['putClaim']>[0]> = {}) {
  return {
    id: 'scope1-stationary',
    address: A,
    scope: 1,
    category: 'stationary-combustion',
    period: '2026-Q1',
    activityQuantity: '12500',
    activityUnit: 'kWh',
    factorValue: '0.207',
    factorUnit: 'kgCO2e/kWh',
    factorAddress: A,
    factorUncertaintyPct: '5',
    reportedTonnes: '2.5875',
    now: 1_770_000_000_000,
    ...overrides,
  }
}

describe('content addressing', () => {
  it('produces a sha256: address', () => {
    expect(addressOfText('hello')).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is stable for identical bytes', () => {
    expect(addressOfText('same')).toBe(addressOfText('same'))
  })

  it('differs for different bytes', () => {
    expect(addressOfText('one')).not.toBe(addressOfText('two'))
  })

  it('matches the well-known digest of the empty input', () => {
    expect(addressOf(new Uint8Array())).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('shortens an address for display while keeping both ends', () => {
    expect(shortAddress(A)).toBe(`${A.slice(7, 15)}…${A.slice(-4)}`)
  })

  it('leaves a digest that is already short alone', () => {
    expect(shortAddress('sha256:abcd')).toBe('abcd')
  })
})

describe('Store documents', () => {
  it('stores a document and reports it as new', () => {
    const store = new Store()
    expect(store.putDocument(document()).stored).toBe(true)
    expect(store.getDocument(A)?.label).toBe('UK grid factor 2026')
    store.close()
  })

  it('re-ingesting identical bytes is a no-op, not a second row', () => {
    const store = new Store()
    store.putDocument(document())
    expect(store.putDocument(document()).stored).toBe(false)
    expect(store.listDocuments()).toHaveLength(1)
    store.close()
  })

  it('changed bytes get a different address, so the old document survives', () => {
    const store = new Store()
    store.putDocument(document())
    store.putDocument(document({ address: B, label: 'UK grid factor 2026 revised' }))
    expect(store.listDocuments()).toHaveLength(2)
    expect(store.getDocument(A)).toBeDefined()
    expect(store.getDocument(B)).toBeDefined()
    store.close()
  })

  it('round-trips document bytes', () => {
    const store = new Store()
    store.putDocument(document({ bytes: new TextEncoder().encode('hello') }))
    expect(store.getDocumentBytes(A)?.toString('utf8')).toBe('hello')
    store.close()
  })

  it('does not overwrite bytes already stored under an address', () => {
    const store = new Store()
    store.putDocument(document({ bytes: new TextEncoder().encode('original') }))
    store.putDocument(document({ bytes: new TextEncoder().encode('tampered') }))
    expect(store.getDocumentBytes(A)?.toString('utf8')).toBe('original')
    store.close()
  })

  it('records supersession', () => {
    const store = new Store()
    store.putDocument(document({ address: B, supersedes: A }))
    expect(store.getDocument(B)?.supersedes).toBe(A)
    store.close()
  })

  it('filters by kind', () => {
    const store = new Store()
    store.putDocument(document())
    store.putDocument(document({ address: C, kind: 'activity-data' }))
    expect(store.listDocuments('emission-factor')).toHaveLength(1)
    expect(store.listDocuments('activity-data')).toHaveLength(1)
    store.close()
  })
})

describe('Store claims', () => {
  it('round-trips a claim keeping quantities exact', () => {
    const store = new Store()
    store.putClaim(claim())
    const row = store.getClaim('scope1-stationary')
    expect(row?.activity_quantity).toBe('12500')
    expect(row?.reported_tonnes).toBe('2.5875')
    expect(row?.factor_address).toBe(A)
    expect(row?.address).toBe(A)
    store.close()
  })

  it('recomputes the claim address when its content changes', () => {
    const store = new Store()
    store.putClaim(claim())
    store.putClaim(claim({ address: B, reportedTonnes: '2.6000' }))
    expect(store.getClaim('scope1-stationary')?.address).toBe(B)
    store.close()
  })

  it('updates in place rather than duplicating', () => {
    const store = new Store()
    store.putClaim(claim())
    store.putClaim(claim({ reportedTonnes: '2.6000' }))
    expect(store.listClaims()).toHaveLength(1)
    expect(store.getClaim('scope1-stationary')?.reported_tonnes).toBe('2.6000')
    store.close()
  })

  it('filters by scope and period', () => {
    const store = new Store()
    store.putClaim(claim())
    store.putClaim(claim({ id: 'scope2-purchased', scope: 2 }))
    store.putClaim(claim({ id: 'q2', period: '2026-Q2' }))
    // scope 1 holds the Q1 station and the Q2 claim; scope 2 holds only purchased electricity.
    expect(store.listClaims({ scope: 1 })).toHaveLength(2)
    expect(store.listClaims({ scope: 2 })).toHaveLength(1)
    expect(store.listClaims({ period: '2026-Q2' })).toHaveLength(1)
    expect(store.listClaims({ scope: 1, period: '2026-Q1' })).toHaveLength(1)
    expect(store.listClaims({ scope: 2, period: '2026-Q2' })).toHaveLength(0)
    store.close()
  })
})

describe('Store edges and verdicts', () => {
  it('stores edges idempotently', () => {
    const store = new Store()
    store.putEdge({ from: 'scope1-stationary', to: 'factor-2026', relation: 'derived-from' })
    store.putEdge({ from: 'scope1-stationary', to: 'factor-2026', relation: 'derived-from' })
    expect(store.listEdges()).toHaveLength(1)
    store.close()
  })

  it('keeps distinct relations between the same pair', () => {
    const store = new Store()
    store.putEdge({ from: 'a', to: 'b', relation: 'derived-from' })
    store.putEdge({ from: 'a', to: 'b', relation: 'measured-by' })
    expect(store.listEdges()).toHaveLength(2)
    store.close()
  })

  it('collapses a repeated verdict onto one row', () => {
    const store = new Store()
    const verdict = {
      claimId: 'scope1-stationary',
      seal: A,
      status: 'supported',
      payload: { status: 'supported' },
      now: 1_770_000_000_000,
    }
    expect(store.putVerdict(verdict).stored).toBe(true)
    expect(store.putVerdict(verdict).stored).toBe(false)
    expect(store.listVerdicts()).toHaveLength(1)
    store.close()
  })

  it('returns the most recent verdict for a claim', () => {
    const store = new Store()
    store.putVerdict({
      claimId: 'c',
      seal: A,
      status: 'unsupported',
      payload: {},
      now: 1,
    })
    store.putVerdict({
      claimId: 'c',
      seal: B,
      status: 'supported',
      payload: {},
      now: 2,
    })
    expect(store.latestVerdict('c')?.status).toBe('supported')
    store.close()
  })
})

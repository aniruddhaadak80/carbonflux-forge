import Database from 'better-sqlite3'
import { MIGRATIONS, LATEST_VERSION, pendingMigrations } from './migrations.js'

export interface RecordRow {
  id: string
  kind: string
  payload: string
  created_at: number
  updated_at: number
}

export interface DocumentRow {
  address: string
  kind: string
  label: string
  captured_at: number
  supersedes: string | null
  trusted: number
  byte_size: number
}

export interface ClaimRow {
  id: string
  address: string
  scope: number
  category: string
  period: string
  activity_quantity: string
  activity_unit: string
  factor_value: string
  factor_unit: string
  factor_address: string
  factor_uncertainty_pct: string
  reported_tonnes: string
  created_at: number
  updated_at: number
}

export interface EdgeRow {
  from_id: string
  to_id: string
  relation: string
}

export interface VerdictRow {
  claim_id: string
  seal: string
  status: string
  payload: string
  created_at: number
}

/**
 * Every write goes through `transaction()`. No ad-hoc db.exec outside it — that rule is
 * what makes concurrent writers safe and makes a failed write leave no partial state.
 */
export class Store {
  readonly #db: Database.Database

  constructor(path = ':memory:') {
    this.#db = new Database(path)
    this.#db.pragma('journal_mode = WAL')
    this.#db.pragma('foreign_keys = ON')
    this.migrate()
  }

  get version(): number {
    return (this.#db.pragma('user_version', { simple: true }) as number) ?? 0
  }

  get isPending(): boolean {
    return pendingMigrations(this.version).length > 0
  }

  migrate(): number {
    const from = this.version
    for (const migration of pendingMigrations(from)) {
      this.transaction(() => {
        for (const statement of migration.up) this.#db.exec(statement)
        this.#db.pragma(`user_version = ${migration.version}`)
      })
    }
    return this.version
  }

  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn)()
  }

  put(record: { id: string; kind: string; payload: unknown; now: number }): void {
    const text = JSON.stringify(record.payload)
    this.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO records (id, kind, payload, created_at, updated_at)
           VALUES (@id, @kind, @payload, @now, @now)
           ON CONFLICT(id) DO UPDATE SET
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
        )
        .run({ id: record.id, kind: record.kind, payload: text, now: record.now })

      // FTS5 virtual tables do not support UPSERT (ON CONFLICT), so the index row is
      // replaced explicitly. This is a SQLite limitation, not a style preference.
      this.#db.prepare('DELETE FROM records_fts WHERE id = ?').run(record.id)
      this.#db.prepare('INSERT INTO records_fts (id, body) VALUES (?, ?)').run(record.id, text)
    })
  }

  get(id: string): RecordRow | undefined {
    return this.#db.prepare('SELECT * FROM records WHERE id = ?').get(id) as RecordRow | undefined
  }

  list(kind: string, limit = 50): readonly RecordRow[] {
    return this.#db
      .prepare('SELECT * FROM records WHERE kind = ? ORDER BY updated_at DESC LIMIT ?')
      .all(kind, limit) as RecordRow[]
  }

  search(query: string, limit = 50): readonly RecordRow[] {
    return this.#db
      .prepare(
        `SELECT r.* FROM records_fts f
           JOIN records r ON r.id = f.id
           WHERE records_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit) as RecordRow[]
  }

  delete(id: string): boolean {
    return this.transaction(() => {
      const result = this.#db.prepare('DELETE FROM records WHERE id = ?').run(id)
      this.#db.prepare('DELETE FROM records_fts WHERE id = ?').run(id)
      return result.changes > 0
    })
  }

  // ------------------------------------------------------------------ content-addressed forge store
  //
  // Documents are keyed by the hash of their bytes. Re-ingesting identical bytes is a no-op, and
  // changed bytes produce a new address rather than overwriting the old one — which is what lets
  // a claim keep citing evidence that has since been replaced, and be caught for it.

  /** Stores a document and its bytes. Returns the address, and whether the bytes were new. */
  putDocument(document: {
    address: string
    kind: string
    label: string
    capturedAt: number
    supersedes?: string | null
    trusted?: boolean
    bytes?: Uint8Array
  }): { address: string; stored: boolean } {
    return this.transaction(() => {
      const existing = this.#db
        .prepare('SELECT address FROM documents WHERE address = ?')
        .get(document.address) as { address: string } | undefined
      const bytes = document.bytes ?? Buffer.alloc(0)

      if (existing === undefined) {
        this.#db
          .prepare(
            `INSERT INTO documents (address, kind, label, captured_at, supersedes, trusted, byte_size)
             VALUES (@address, @kind, @label, @capturedAt, @supersedes, @trusted, @byteSize)`,
          )
          .run({
            address: document.address,
            kind: document.kind,
            label: document.label,
            capturedAt: document.capturedAt,
            supersedes: document.supersedes ?? null,
            trusted: document.trusted === false ? 0 : 1,
            byteSize: bytes.byteLength,
          })
      } else {
        // Metadata may be corrected without changing the content; the address must not move.
        this.#db
          .prepare(
            `UPDATE documents SET kind = @kind, label = @label, supersedes = @supersedes,
               trusted = @trusted WHERE address = @address`,
          )
          .run({
            address: document.address,
            kind: document.kind,
            label: document.label,
            supersedes: document.supersedes ?? null,
            trusted: document.trusted === false ? 0 : 1,
          })
      }

      if (document.bytes !== undefined) {
        this.#db
          .prepare(
            `INSERT INTO document_blobs (address, bytes) VALUES (?, ?)
             ON CONFLICT(address) DO NOTHING`,
          )
          .run(document.address, Buffer.from(bytes))
      }

      return { address: document.address, stored: existing === undefined }
    })
  }

  getDocument(address: string): DocumentRow | undefined {
    return this.#db.prepare('SELECT * FROM documents WHERE address = ?').get(address) as
      DocumentRow | undefined
  }

  listDocuments(kind?: string, limit = 200): readonly DocumentRow[] {
    if (kind === undefined) {
      return this.#db
        .prepare('SELECT * FROM documents ORDER BY captured_at DESC, address LIMIT ?')
        .all(limit) as DocumentRow[]
    }
    return this.#db
      .prepare('SELECT * FROM documents WHERE kind = ? ORDER BY captured_at DESC, address LIMIT ?')
      .all(kind, limit) as DocumentRow[]
  }

  getDocumentBytes(address: string): Buffer | undefined {
    const row = this.#db.prepare('SELECT bytes FROM document_blobs WHERE address = ?').get(address) as
      { bytes: Buffer } | undefined
    return row?.bytes
  }

  putClaim(claim: {
    id: string
    address: string
    scope: number
    category: string
    period: string
    activityQuantity: string
    activityUnit: string
    factorValue: string
    factorUnit: string
    factorAddress: string
    factorUncertaintyPct: string
    reportedTonnes: string
    now: number
  }): void {
    this.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO claims (
             id, address, scope, category, period, activity_quantity, activity_unit, factor_value,
             factor_unit, factor_address, factor_uncertainty_pct, reported_tonnes,
             created_at, updated_at
           ) VALUES (
             @id, @address, @scope, @category, @period, @activityQuantity, @activityUnit,
             @factorValue, @factorUnit, @factorAddress, @factorUncertaintyPct, @reportedTonnes,
             @now, @now
           )
           ON CONFLICT(id) DO UPDATE SET
             address = excluded.address,
             scope = excluded.scope,
             category = excluded.category,
             period = excluded.period,
             activity_quantity = excluded.activity_quantity,
             activity_unit = excluded.activity_unit,
             factor_value = excluded.factor_value,
             factor_unit = excluded.factor_unit,
             factor_address = excluded.factor_address,
             factor_uncertainty_pct = excluded.factor_uncertainty_pct,
             reported_tonnes = excluded.reported_tonnes,
             updated_at = excluded.updated_at`,
        )
        .run({ ...claim })
    })
  }

  getClaim(id: string): ClaimRow | undefined {
    return this.#db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as ClaimRow | undefined
  }

  listClaims(filter: { scope?: number; period?: string; limit?: number } = {}): readonly ClaimRow[] {
    const limit = filter.limit ?? 200
    if (filter.scope !== undefined && filter.period !== undefined) {
      return this.#db
        .prepare('SELECT * FROM claims WHERE scope = ? AND period = ? ORDER BY id LIMIT ?')
        .all(filter.scope, filter.period, limit) as ClaimRow[]
    }
    if (filter.scope !== undefined) {
      return this.#db
        .prepare('SELECT * FROM claims WHERE scope = ? ORDER BY id LIMIT ?')
        .all(filter.scope, limit) as ClaimRow[]
    }
    if (filter.period !== undefined) {
      return this.#db
        .prepare('SELECT * FROM claims WHERE period = ? ORDER BY id LIMIT ?')
        .all(filter.period, limit) as ClaimRow[]
    }
    return this.#db.prepare('SELECT * FROM claims ORDER BY id LIMIT ?').all(limit) as ClaimRow[]
  }

  putEdge(edge: { from: string; to: string; relation: string }): void {
    this.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO claim_edges (from_id, to_id, relation) VALUES (@from, @to, @relation)
           ON CONFLICT(from_id, to_id, relation) DO NOTHING`,
        )
        .run(edge)
    })
  }

  listEdges(): readonly EdgeRow[] {
    return this.#db.prepare('SELECT * FROM claim_edges ORDER BY from_id, relation, to_id').all() as EdgeRow[]
  }

  /** A verdict is immutable: re-forging the same claim yields the same seal, which collapses
   * onto the existing row rather than accumulating duplicates. */
  putVerdict(verdict: { claimId: string; seal: string; status: string; payload: unknown; now: number }): {
    stored: boolean
  } {
    return this.transaction(() => {
      const existing = this.#db
        .prepare('SELECT seal FROM verdicts WHERE claim_id = ? AND seal = ?')
        .get(verdict.claimId, verdict.seal)
      if (existing !== undefined) return { stored: false }
      this.#db
        .prepare(
          `INSERT INTO verdicts (claim_id, seal, status, payload, created_at)
           VALUES (@claimId, @seal, @status, @payload, @now)`,
        )
        .run({ ...verdict, payload: JSON.stringify(verdict.payload) })
      return { stored: true }
    })
  }

  latestVerdict(claimId: string): VerdictRow | undefined {
    return this.#db
      .prepare('SELECT * FROM verdicts WHERE claim_id = ? ORDER BY created_at DESC, seal LIMIT 1')
      .get(claimId) as VerdictRow | undefined
  }

  listVerdicts(limit = 200): readonly VerdictRow[] {
    return this.#db
      .prepare('SELECT * FROM verdicts ORDER BY created_at DESC, claim_id, seal LIMIT ?')
      .all(limit) as VerdictRow[]
  }

  close(): void {
    this.#db.close()
  }
}

export { LATEST_VERSION, MIGRATIONS }

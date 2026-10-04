/**
 * Migrations are numbered, ordered, and idempotent. Never edit an applied migration —
 * append a new one. `user_version` is the source of truth for the applied prefix.
 */
export interface Migration {
  readonly version: number
  readonly name: string
  readonly up: readonly string[]
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    up: [
      `CREATE TABLE IF NOT EXISTS records (
         id         TEXT PRIMARY KEY,
         kind       TEXT NOT NULL,
         payload    TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS records_kind_idx ON records (kind, updated_at DESC)`,
    ],
  },
  {
    version: 2,
    name: 'full_text',
    up: [
      `CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5 (
         id UNINDEXED, body, tokenize = 'porter unicode61'
       )`,
    ],
  },
  {
    version: 3,
    name: 'forge_content_addressed',
    up: [
      `CREATE TABLE IF NOT EXISTS documents (
         address     TEXT PRIMARY KEY,
         kind        TEXT NOT NULL,
         label       TEXT NOT NULL,
         captured_at INTEGER NOT NULL,
         supersedes  TEXT,
         trusted     INTEGER NOT NULL DEFAULT 1,
         byte_size   INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS documents_kind_idx ON documents (kind)`,
      // The bytes live beside the metadata under the same address, so a document can never have
      // metadata without content, or content without metadata.
      `CREATE TABLE IF NOT EXISTS document_blobs (
         address TEXT PRIMARY KEY REFERENCES documents(address) ON DELETE CASCADE,
         bytes   BLOB NOT NULL
       )`,
      // Quantities are TEXT, never REAL: tCO2e is audited to the decimal place, and a float
      // column would silently lose digits the moment a claim is written.
      `CREATE TABLE IF NOT EXISTS claims (
         id                     TEXT PRIMARY KEY,
         address                TEXT NOT NULL,
         scope                  INTEGER NOT NULL,
         category               TEXT NOT NULL,
         period                 TEXT NOT NULL,
         activity_quantity      TEXT NOT NULL,
         activity_unit          TEXT NOT NULL,
         factor_value           TEXT NOT NULL,
         factor_unit            TEXT NOT NULL,
         factor_address         TEXT NOT NULL,
         factor_uncertainty_pct TEXT NOT NULL,
         reported_tonnes        TEXT NOT NULL,
         created_at             INTEGER NOT NULL,
         updated_at             INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS claims_scope_idx ON claims (scope, period)`,
      `CREATE TABLE IF NOT EXISTS claim_edges (
         from_id  TEXT NOT NULL,
         to_id    TEXT NOT NULL,
         relation TEXT NOT NULL,
         PRIMARY KEY (from_id, to_id, relation)
       )`,
      `CREATE INDEX IF NOT EXISTS claim_edges_from_idx ON claim_edges (from_id)`,
      // Keyed by seal as well as claim, so a claim carries a history of verdicts while two runs
      // that agree collapse onto a single row.
      `CREATE TABLE IF NOT EXISTS verdicts (
         claim_id   TEXT NOT NULL,
         seal       TEXT NOT NULL,
         status     TEXT NOT NULL,
         payload    TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (claim_id, seal)
       )`,
    ],
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

export function pendingMigrations(current: number): readonly Migration[] {
  return MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
}

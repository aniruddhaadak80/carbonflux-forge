import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ValidationError } from '@carbonfluxforge/core'
import { BaseChannel } from './base.js'
import type { ProbeResult } from './types.js'

export interface VerdictExportOptions {
  /** Directory the NDJSON files are written to. Created on start if absent. */
  readonly directory: string
  /** Reject payloads larger than this rather than writing a truncated record. */
  readonly maxRecordBytes?: number
}

const DEFAULT_MAX_RECORD_BYTES = 512 * 1024

/**
 * Writes sealed verdicts as newline-delimited JSON — one file per reporting period.
 *
 * This is the only channel this product ships, and the reason is deliberate: an auditor's next
 * step is to open the evidence somewhere they already trust. NDJSON loads into a spreadsheet, a
 * log pipeline or `jq` without a bespoke importer, and the seal travels with every record, so a
 * reader can check any line against the tool that produced it.
 *
 * It is a channel rather than a CLI flag because it goes through the same interface as any other
 * adapter — retry, receipt and probe all come from the base class, not from a special case.
 */
export class VerdictExportChannel extends BaseChannel {
  readonly id = 'verdict-export'
  readonly displayName = 'Verdict export (NDJSON)'
  readonly requiresNetwork = false

  readonly #directory: string
  readonly #maxRecordBytes: number
  readonly #written = new Map<string, number>()

  constructor(options: VerdictExportOptions) {
    // Filesystem writes are not retried usefully: a retry would duplicate a partial line. One
    // attempt, and the caller is told.
    super({ attempts: 1, baseDelayMs: 0, maxDelayMs: 0 })
    if (options.directory.trim().length === 0) {
      throw new ValidationError('verdict export needs a directory', { field: 'directory' })
    }
    this.#directory = options.directory
    this.#maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES
  }

  get directory(): string {
    return this.#directory
  }

  /** Records written per period. Powers the probe detail. */
  get written(): ReadonlyMap<string, number> {
    return this.#written
  }

  override async start(): Promise<void> {
    mkdirSync(this.#directory, { recursive: true })
    await super.start()
  }

  protected override async deliver(target: string, message: { text: string }): Promise<void> {
    const period = target.trim()
    if (period.length === 0) {
      throw new ValidationError('verdict export target must be a reporting period')
    }
    const bytes = Buffer.byteLength(message.text, 'utf8')
    if (bytes > this.#maxRecordBytes) {
      throw new ValidationError(
        `verdict record is ${bytes} bytes, over the ${this.#maxRecordBytes} byte limit`,
        { field: 'text', bytes },
      )
    }

    const file = join(this.#directory, `${period}.ndjson`)
    // A record must be exactly one line: an embedded newline would produce a file that parses as
    // two half-records and silently corrupts the export.
    const line = message.text.replace(/\r?\n/g, ' ')
    appendFileSync(file, `${line}\n`, 'utf8')
    this.#written.set(period, (this.#written.get(period) ?? 0) + 1)
  }

  protected override probeImpl(): ProbeResult {
    if (!this.running) {
      return {
        channel: this.id,
        status: 'warn',
        detail: 'configured but not started',
        fix: 'run verdict-export.start() so the export directory is created',
      }
    }
    if (!existsSync(this.#directory)) {
      return {
        channel: this.id,
        status: 'fail',
        detail: `export directory ${this.#directory} does not exist`,
        fix: 'restart the channel so it can create the directory',
      }
    }

    const files = [...this.#written.keys()].map((period) => {
      const path = join(this.#directory, `${period}.ndjson`)
      return `${period}:${statSync(path).size}b`
    })
    const total = [...this.#written.values()].reduce((sum, value) => sum + value, 0)
    return {
      channel: this.id,
      status: 'ok',
      detail: `${total} verdict(s) exported to ${this.#directory}${files.length > 0 ? ` (${files.join(' ')})` : ''}`,
    }
  }
}

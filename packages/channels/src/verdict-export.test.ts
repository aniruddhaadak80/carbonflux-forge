import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '@carbonfluxforge/core'
import { ChannelRegistry } from './registry.js'
import { VerdictExportChannel } from './verdict-export.js'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'verdict-export-'))
}

function envelope(claimId: string, status: string): string {
  return JSON.stringify({ claimId, status, seal: `sha256:${'a'.repeat(64)}` })
}

describe('VerdictExportChannel', () => {
  it('writes one NDJSON line per verdict', async () => {
    const dir = join(tempDir(), 'out')
    const channel = new VerdictExportChannel({ directory: dir })
    await channel.start()

    await channel.send('2026-Q1', { text: envelope('a', 'supported'), idempotencyKey: '1' })
    await channel.send('2026-Q1', { text: envelope('b', 'unsupported'), idempotencyKey: '2' })

    const lines = readFileSync(join(dir, '2026-Q1.ndjson'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ claimId: 'a', status: 'supported' })
  })

  it('creates the export directory on start', async () => {
    const dir = join(tempDir(), 'nested', 'deeper')
    const channel = new VerdictExportChannel({ directory: dir })
    expect(existsSync(dir)).toBe(false)
    await channel.start()
    expect(existsSync(dir)).toBe(true)
  })

  it('separates periods into separate files', async () => {
    const dir = tempDir()
    const channel = new VerdictExportChannel({ directory: dir })
    await channel.start()
    await channel.send('2026-Q1', { text: envelope('a', 'supported'), idempotencyKey: '1' })
    await channel.send('2026-Q2', { text: envelope('b', 'supported'), idempotencyKey: '2' })
    expect(existsSync(join(dir, '2026-Q1.ndjson'))).toBe(true)
    expect(existsSync(join(dir, '2026-Q2.ndjson'))).toBe(true)
  })

  it('keeps a record on one line even when the payload contains newlines', async () => {
    const dir = tempDir()
    const channel = new VerdictExportChannel({ directory: dir })
    await channel.start()
    await channel.send('2026-Q1', { text: 'a\nb\nc', idempotencyKey: '1' })
    const raw = readFileSync(join(dir, '2026-Q1.ndjson'), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(1)
    expect(raw.trim()).toBe('a b c')
  })

  it('rejects an oversized record rather than writing a truncated one', async () => {
    const dir = tempDir()
    const channel = new VerdictExportChannel({ directory: dir, maxRecordBytes: 32 })
    await channel.start()
    // The base class owns retry and the error envelope, so a permanent rejection surfaces as its
    // failure. What matters is that nothing partial reached the file.
    await expect(channel.send('2026-Q1', { text: 'x'.repeat(64), idempotencyKey: '1' })).rejects.toThrow(
      /failed after/,
    )
    expect(existsSync(join(dir, '2026-Q1.ndjson'))).toBe(false)
    expect(channel.written.size).toBe(0)
  })

  it('refuses an empty target', async () => {
    const dir = tempDir()
    const channel = new VerdictExportChannel({ directory: dir })
    await channel.start()
    await expect(
      channel.send('   ', { text: envelope('a', 'supported'), idempotencyKey: '1' }),
    ).rejects.toThrow(/failed after/)
    expect(channel.written.size).toBe(0)
  })

  it('refuses a blank directory at construction', () => {
    expect(() => new VerdictExportChannel({ directory: '  ' })).toThrow(ValidationError)
  })

  it('reports warn before start and ok after', async () => {
    const dir = tempDir()
    const channel = new VerdictExportChannel({ directory: dir })
    expect((await channel.probe()).status).toBe('warn')
    await channel.start()
    expect((await channel.probe()).status).toBe('ok')
  })

  it('counts what it wrote', async () => {
    const dir = tempDir()
    const channel = new VerdictExportChannel({ directory: dir })
    await channel.start()
    await channel.send('2026-Q1', { text: envelope('a', 'supported'), idempotencyKey: '1' })
    await channel.send('2026-Q1', { text: envelope('b', 'supported'), idempotencyKey: '2' })
    expect(channel.written.get('2026-Q1')).toBe(2)
    expect((await channel.probe()).detail).toContain('2 verdict(s)')
  })

  it('registers alongside another channel and probes without throwing', async () => {
    const dir = tempDir()
    const channel = new VerdictExportChannel({ directory: dir })
    await channel.start()
    const registry = new ChannelRegistry().register(channel)
    const results = await registry.probeAll()
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('ok')
  })
})

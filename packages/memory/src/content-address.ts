import { createHash } from 'node:crypto'
import type { Address } from '@carbonfluxforge/core'

/**
 * Content addressing.
 *
 * A document's identity is the SHA-256 of its bytes. That single decision is what makes the
 * product work: the same file imported twice is stored once, a corrected file is a *different*
 * address rather than an overwrite, and every claim that leaned on the old address can be found
 * and flagged instead of quietly continuing to cite a number that no longer exists.
 */
export function addressOf(bytes: Uint8Array): Address {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function addressOfText(text: string): Address {
  return addressOf(new TextEncoder().encode(text))
}

/**
 * Short form for display. Deliberately shows the head *and* the tail of the digest: the head
 * alone is what people compare against each other, and the tail is what makes a truncation
 * collision between two different documents visible rather than assumed away.
 */
export function shortAddress(address: string, head = 8, tail = 4): string {
  const digest = address.startsWith('sha256:') ? address.slice('sha256:'.length) : address
  if (digest.length <= head + tail) return digest
  return `${digest.slice(0, head)}…${digest.slice(-tail)}`
}

#!/usr/bin/env node
// A real end-to-end proof of the MCP surface, not a unit test with a mock transport.
//
// It launches the built MCP server as a subprocess over stdio, connects a real MCP client,
// lists the tools, and calls two of them — one of which reaches the Python engine. It exits
// non-zero if any of that fails, so it is usable as a gate.
//
//   npm run build && node e2e/mcp-roundtrip.mjs

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { McpClient } from '../packages/mcp/dist/client.js'

const root = process.cwd()
const entry = join(root, 'packages', 'cli', 'dist', 'bin.js')

if (!existsSync(entry)) {
  console.error('e2e/mcp-roundtrip — packages/cli/dist/bin.js is missing. Run "npm run build" first.')
  process.exit(1)
}

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const client = new McpClient()
try {
  await client.connect({
    id: 'carbonflux-forge',
    command: process.execPath,
    args: ['packages/cli/dist/bin.js', 'mcp', 'serve'],
    enabled: true,
  })
  check('client connected to the server over stdio', true)

  const tools = await client.listTools()
  check('tools/list returns at least five tools', tools.length >= 5, `${tools.length} tools`)

  const required = [
    'forge_verdict',
    'recompute_claim',
    'walk_provenance',
    'list_claims',
    'forge_inventory',
    'ingest_evidence',
    'evidence_catalogue',
    'provenance_graph',
  ]
  const names = tools.map((tool) => tool.name)
  const missing = required.filter((name) => !names.includes(name))
  check('every product tool is advertised', missing.length === 0, missing.join(', ') || 'none missing')

  const schemaOk = tools.every((tool) => tool.description.length > 20 && tool.inputSchema.type === 'object')
  check('every tool has a description and an object input schema', schemaOk)

  const verdict = await client.callTool('forge_verdict', { claimId: 'scope1-fleet-diesel' })
  check(
    'tools/call forge_verdict reaches the Python engine',
    verdict?.status === 'unsupported' && typeof verdict?.seal === 'string',
    `status=${verdict?.status} seal=${verdict?.seal}`,
  )
  check(
    'the verdict reports the arithmetic, not just a verdict',
    verdict?.computation?.recomputedTonnes === '30.7758' && verdict?.computation?.reportedTonnes === '46.05',
    `recomputed=${verdict?.computation?.recomputedTonnes} reported=${verdict?.computation?.reportedTonnes}`,
  )

  const again = await client.callTool('forge_verdict', { claimId: 'scope1-fleet-diesel' })
  check('the same claim seals identically twice', again?.seal === verdict?.seal, again?.seal)

  const walk = await client.callTool('walk_provenance', { claimId: 'scope3-business-travel-flights' })
  check(
    'tools/call walk_provenance finds the circular chain',
    Array.isArray(walk?.cycle) && walk.cycle.length === 3,
    walk?.cycle === null ? 'no cycle' : walk?.cycle?.join(' -> '),
  )

  const bad = await client
    .callTool('forge_verdict', { claimId: 'no-such-claim' })
    .then(() => null)
    .catch((error) => error)
  check('a missing claim returns an error, not a silent success', bad !== null)
} finally {
  await client.close()
}

const failed = checks.filter((entry) => !entry.ok)
console.log('')
console.log(`  ${checks.length - failed.length} passed, ${failed.length} failed`)
console.log(failed.length === 0 ? 'MCP ROUNDTRIP PASSED' : 'MCP ROUNDTRIP FAILED')
process.exitCode = failed.length === 0 ? 0 : 1

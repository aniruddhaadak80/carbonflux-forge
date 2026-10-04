import { join } from 'node:path'
import { ToolRegistry, ValidationError, type Tool, type ToolContext } from '@carbonfluxforge/core'
import { buildRegistry } from '@carbonfluxforge/plugins'
import { loadCatalog } from '@carbonfluxforge/skills'
import { registerForgeTools } from './forge-tools.js'

export const ENGINE_MODULE = 'carbonflux_forge'

/**
 * Builds the one registry every surface shares.
 *
 * These five tools are real and working out of the box — they are what makes the MCP server
 * useful on a fresh install instead of exposing an empty tool list. They are also the
 * intended shape for your own tools: a name a model can type, an inputSchema it can fill,
 * declared permissions, and a handler that returns JSON-serialisable data.
 *
 * Every name matches ^[a-z][a-z0-9_]*$ so it is directly exposable over MCP.
 */
export function buildToolRegistry(cwd = process.cwd()): ToolRegistry {
  const registry = new ToolRegistry()

  registry.register(
    {
      name: 'list_skills',
      description:
        'List the skill catalog with each skill name, version and description. Use this to discover what the agent can do before guessing a command.',
      inputSchema: {
        type: 'object',
        properties: {
          includeBodies: { type: 'boolean', description: 'Include each skill body.' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          issues: { type: 'array', items: { type: 'string' } },
          skills: { type: 'array', items: { type: 'object' } },
        },
        required: ['count', 'issues', 'skills'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { includeBodies?: boolean }) => {
        const { skills, issues } = loadCatalog(join(cwd, 'skills'))
        return {
          count: skills.length,
          issues: [...issues],
          skills: skills.map((skill) => ({
            name: skill.name,
            version: skill.version,
            description: skill.description,
            ...(input.includeBodies === true ? { body: skill.body } : {}),
          })),
        }
      },
    } satisfies Tool<{ includeBodies?: boolean }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'list_plugins',
      description:
        'List the resolved plugin registry, including plugins that were shadowed, disabled or rejected and why. Use this to explain why an expected capability is missing.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async () => {
        const result = buildRegistry(join(cwd, 'plugins'))
        return {
          active: result.active.map((p) => ({
            name: p.manifest.name,
            version: p.manifest.version,
            capabilities: p.manifest.capabilities,
            shadowed: p.shadowed,
          })),
          disabled: result.disabled.map((p) => p.manifest.name),
          rejected: result.rejected.map((p) => ({ path: p.path, issues: p.issues })),
        }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  const runEngine = async (op: string, input: unknown): Promise<unknown> => {
    const { EngineBridge } = await import('@carbonfluxforge/engine-client')
    const bridge = new EngineBridge({
      module: ENGINE_MODULE,
      cwd: join(cwd, 'services', 'engine', 'src'),
    })
    return await bridge.call({ op, input })
  }

  const engineSchema = (properties: Record<string, unknown>, required: string[]) =>
    ({
      type: 'object',
      properties: { records: { type: 'array', items: { type: 'object' } }, ...properties },
      required: ['records', ...required],
      additionalProperties: false,
    }) as const

  const validateRecords = (input: unknown): unknown[] => {
    const records = (input as { records?: unknown }).records
    if (!Array.isArray(records)) {
      throw new ValidationError('"records" must be an array', { field: 'records' })
    }
    return records
  }

  registry.register(
    {
      name: 'engine_summarize',
      description:
        'Aggregate a set of records by kind and report the total and the newest/oldest timestamps. Deterministic: same records always give the same answer.',
      inputSchema: engineSchema({}, []),
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateRecords(input)
        return await runEngine('summarize', input)
      },
    } satisfies Tool<{ records: unknown[] }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'engine_diff',
      description:
        'Compute a minimal structural diff between two record sets, reporting added, removed, changed and unchanged identifiers. Use this instead of comparing JSON by eye.',
      inputSchema: {
        type: 'object',
        properties: {
          before: { type: 'array', items: { type: 'object' } },
          after: { type: 'array', items: { type: 'object' } },
        },
        required: ['before', 'after'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        if (!Array.isArray((input as { before?: unknown }).before)) {
          throw new ValidationError('"before" must be an array', { field: 'before' })
        }
        if (!Array.isArray((input as { after?: unknown }).after)) {
          throw new ValidationError('"after" must be an array', { field: 'after' })
        }
        return await runEngine('diff', input)
      },
    } satisfies Tool<{ before: unknown[]; after: unknown[] }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'engine_normalize',
      description:
        'Flatten records into a stable, sorted, comparable shape. Use this before diffing or storing so ordering never changes the result.',
      inputSchema: engineSchema({}, []),
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateRecords(input)
        return await runEngine('normalize', input)
      },
    } satisfies Tool<{ records: unknown[] }, unknown>,
    { source: 'core' },
  )

  // The product's own tools, registered through the same waist as the five above. The CLI, the
  // web app and the MCP server all reach these by name; none of them re-implements one.
  registerForgeTools(registry, cwd)

  return registry
}

/** A minimal, dependency-free logger for the tool context. */
export function createContext(requestId = 'cli'): ToolContext {
  return {
    requestId,
    now: () => Date.now(),
    log: (level, message, fields) => {
      process.stderr.write(`${JSON.stringify({ level, message, requestId, ...fields })}\n`)
    },
    dataDir: process.env.PRODUCT_DATA_DIR ?? '.data',
  }
}

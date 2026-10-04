import { NextResponse } from 'next/server'
import { PRODUCT, resolveVersion } from '@/lib/product'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Status = 'ok' | 'warn' | 'fail'
interface Check {
  name: string
  status: Status
  detail: string
  fix?: string
}

const startedAt = Date.now()

/**
 * A health endpoint that reports only things it can actually observe at runtime. It does
 * not claim a probe it did not run — a health check that lies is worse than none.
 */
function probe(): { ok: boolean; checks: Check[] } {
  const checks: Check[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0] ?? '0')
  checks.push(
    nodeMajor >= 22
      ? { name: 'runtime', status: 'ok', detail: `node ${process.versions.node}` }
      : {
          name: 'runtime',
          status: 'fail',
          detail: `node ${process.versions.node} is below the required v22.12.0`,
          fix: 'target Node 22 in the deployment runtime',
        },
  )

  checks.push({
    name: 'package',
    status: 'ok',
    detail: `${PRODUCT.slug}@${resolveVersion()}`,
  })

  const region = process.env.VERCEL_REGION ?? 'local'
  checks.push({ name: 'region', status: 'ok', detail: region })

  const telemetry = process.env.TELEMETRY_ENABLED === 'true'
  checks.push({
    name: 'telemetry',
    status: 'warn',
    detail: telemetry ? 'enabled' : 'disabled (default)',
    ...(telemetry ? {} : { fix: 'set TELEMETRY_ENABLED=true to enable' }),
  })

  const ok = checks.every((check) => check.status !== 'fail')
  return { ok, checks }
}

export function GET() {
  const { ok, checks } = probe()
  return NextResponse.json(
    {
      ok,
      name: PRODUCT.slug,
      version: resolveVersion(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
      runtime: process.versions.node,
      region: process.env.VERCEL_REGION ?? 'local',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks,
    },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  )
}

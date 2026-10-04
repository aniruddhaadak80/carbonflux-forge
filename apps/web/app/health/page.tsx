import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Health' }
export const dynamic = 'force-dynamic'

interface Check {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  fix?: string
}

const TONE = { ok: 'ok', warn: 'warn', fail: 'danger' } as const

export default async function HealthPage() {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

  let checks: Check[] = []
  let reachable = false
  try {
    const response = await fetch(`${base}/api/health`, { cache: 'no-store' })
    const body = (await response.json()) as { checks?: Check[] }
    checks = body.checks ?? []
    reachable = true
  } catch (cause) {
    checks = [
      {
        name: 'api/health',
        status: 'fail',
        detail: String(cause),
        fix: 'the route must be reachable from the server runtime',
      },
    ]
  }

  return (
    <>
      <section className="hero">
        <span className="eyebrow">Diagnostics</span>
        <h1>Health</h1>
        <p>
          Live probe results from <code>/api/health</code> on this deployment.
        </p>
      </section>

      {!reachable && (
        <p className="state" data-kind="error">
          The health endpoint could not be reached.
        </p>
      )}

      <div className="grid">
        {checks.map((check) => (
          <article className="card" key={check.name}>
            <span className="badge" data-tone={TONE[check.status]}>
              {check.status}
            </span>
            <h2>{check.name}</h2>
            <p>{check.detail}</p>
            {check.fix !== undefined && (
              <p style={{ color: 'var(--warn)' }}>
                <strong>fix:</strong> {check.fix}
              </p>
            )}
          </article>
        ))}
      </div>
    </>
  )
}

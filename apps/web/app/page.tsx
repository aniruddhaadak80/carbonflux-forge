import Link from 'next/link'
import { SpineMini } from '@/components/Spine'
import { PRODUCT } from '@/lib/product'
import { INVENTORY, STATUS_ORDER, orderedClaims, shortAddress } from '@/lib/inventory'
import type { VerdictStatus } from '@/lib/inventory'

export const dynamic = 'force-static'

const STATUS_MEANING: Record<VerdictStatus, string> = {
  supported: 'reproduces from its own evidence',
  unsupported: 'does not hold',
  circular: 'rests on itself',
  unverified: 'reaches no terminal evidence',
}

export default function NotebookPage() {
  const claims = orderedClaims(INVENTORY.claims)
  const census = INVENTORY.census.byStatus

  return (
    <>
      <section className="notebook-head">
        <p className="eyebrow">
          reporting period {INVENTORY.period} · forged by {INVENTORY.engine}
        </p>
        <h1>{PRODUCT.name}</h1>
        <p className="lede">{PRODUCT.tagline}</p>

        <dl className="census">
          {STATUS_ORDER.map((status) => (
            <div className="census-cell" key={status} data-status={status}>
              <dt>
                <span className="census-count">{census[status] ?? 0}</span>
                <span className="census-label">{status}</span>
              </dt>
              <dd>{STATUS_MEANING[status]}</dd>
            </div>
          ))}
        </dl>

        <p className="totals">
          reported {INVENTORY.totals.reportedTonnes} tCO2e · recomputed {INVENTORY.totals.recomputedTonnes}{' '}
          tCO2e across {INVENTORY.census.total} claims
        </p>
      </section>

      <section aria-labelledby="claims-heading">
        <h2 id="claims-heading" className="section-heading">
          The notebook
        </h2>
        <p className="section-note">
          One cell per claim, ordered worst first. Every figure below was produced by the Python engine and
          sealed; this page renders those results and recomputes nothing.
        </p>

        {claims.length === 0 ? (
          <p className="state" data-kind="empty">
            No claims have been forged yet. Run <code>npm run fixtures</code> to generate them.
          </p>
        ) : (
          <ol className="cells">
            {claims.map((claim, index) => (
              <li className="cell" key={claim.id} data-status={claim.status}>
                <div className="cell-gutter">
                  <span className="cell-index">[{index + 1}]</span>
                  <span className="cell-scope">scope {claim.scope}</span>
                </div>

                <div className="cell-main">
                  <div className="cell-head">
                    <Link href={`/claims/${claim.id}`} className="cell-id">
                      {claim.id}
                    </Link>
                    <span className="stamp" data-status={claim.status}>
                      {claim.status}
                    </span>
                  </div>

                  <p className="cell-category">{claim.category}</p>

                  <dl className="figures">
                    <div>
                      <dt>reported</dt>
                      <dd>{claim.reportedTonnes}</dd>
                    </div>
                    <div>
                      <dt>recomputed</dt>
                      <dd>{claim.recomputedTonnes}</dd>
                    </div>
                    <div>
                      <dt>delta</dt>
                      <dd data-sign={Number(claim.deltaTonnes) === 0 ? 'flat' : 'moved'}>
                        {claim.deltaTonnes} ({claim.deltaPct}%)
                      </dd>
                    </div>
                    <div>
                      <dt>depth</dt>
                      <dd>{claim.supportDepth}</dd>
                    </div>
                  </dl>

                  <div className="cell-foot">
                    <SpineMini nodes={claim.spine} />
                    <span className="cell-chain">
                      {claim.spine.length} node{claim.spine.length === 1 ? '' : 's'} of support
                    </span>
                    <span className="cell-seal" title={claim.seal}>
                      {shortAddress(claim.seal)}
                    </span>
                  </div>

                  {claim.reasons.length > 0 && (
                    <ul className="reasons">
                      {claim.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

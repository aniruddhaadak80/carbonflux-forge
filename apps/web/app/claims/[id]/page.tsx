import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Spine } from '@/components/Spine'
import { INVENTORY, documentsSuperseding, findClaim, shortAddress } from '@/lib/inventory'

/**
 * Exactly the claims in the inventory are routable, and nothing else.
 *
 * `dynamicParams = false` makes the router itself answer 404 for an unknown id, which is what we
 * need: rendering `notFound()` from inside this statically-optimised page renders the not-found
 * body but answers HTTP 200, so a wrong URL would look like a right one to every client, crawler
 * and monitor. The ids that do exist are still prerendered.
 */
export const dynamicParams = false

export function generateStaticParams(): { id: string }[] {
  return INVENTORY.claims.map((claim) => ({ id: claim.id }))
}

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const claim = findClaim(id)
  if (claim === undefined) notFound()

  const superseding = documentsSuperseding(claim.factorAddress)
  const exact = claim.deltaTonnes === '0' || Number(claim.deltaTonnes) === 0

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link href="/">notebook</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{claim.id}</span>
      </nav>

      <header className="claim-head">
        <div>
          <p className="eyebrow">
            scope {claim.scope} · {claim.category} · {claim.period}
          </p>
          <h1>{claim.id}</h1>
        </div>
        <span className="stamp stamp-large" data-status={claim.status}>
          {claim.status}
        </span>
      </header>

      {claim.note !== null && <p className="claim-note">{claim.note}</p>}

      <section aria-labelledby="arithmetic-heading" className="panel">
        <h2 id="arithmetic-heading">The arithmetic</h2>
        <p className="panel-note">
          Recomputed from the claim&apos;s own activity data and emission factor, then compared with the
          figure the inventory reports.
        </p>

        <table className="ledger">
          <caption className="visually-hidden">Recomputation of {claim.id}</caption>
          <tbody>
            <tr>
              <th scope="row">activity</th>
              <td>
                {claim.activityQuantity} {claim.activityUnit}
              </td>
            </tr>
            <tr>
              <th scope="row">emission factor</th>
              <td>
                {claim.factorValue} {claim.factorUnit}
              </td>
            </tr>
            <tr>
              <th scope="row">factor evidence</th>
              <td>
                {claim.factorLabel ?? claim.factorRef}{' '}
                <span className="mono-dim">{shortAddress(claim.factorAddress)}</span>
              </td>
            </tr>
            <tr className="ledger-total">
              <th scope="row">recomputed</th>
              <td>{claim.recomputedTonnes} tCO2e</td>
            </tr>
            <tr>
              <th scope="row">reported</th>
              <td>{claim.reportedTonnes} tCO2e</td>
            </tr>
            <tr className={exact ? 'ledger-flat' : 'ledger-moved'}>
              <th scope="row">difference</th>
              <td>
                {claim.deltaTonnes} tCO2e ({claim.deltaPct}%)
              </td>
            </tr>
            <tr>
              <th scope="row">factor uncertainty</th>
              <td>± {claim.uncertaintyTonnes} tCO2e</td>
            </tr>
          </tbody>
        </table>

        {exact && claim.status !== 'supported' && (
          <p className="callout" data-tone="warn">
            The arithmetic reproduces exactly, and the claim is still <strong>{claim.status}</strong>. That is
            the case this product exists for: a number can be arithmetically perfect and still rest on
            evidence that no longer stands.
          </p>
        )}

        {superseding.length > 0 && (
          <div className="callout" data-tone="danger">
            <p>
              This factor was replaced by {superseding.length} newer revision
              {superseding.length === 1 ? '' : 's'}:
            </p>
            <ul>
              {superseding.map((document) => (
                <li key={document.address}>
                  {document.label} <span className="mono-dim">{shortAddress(document.address)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {claim.reasons.length > 0 && (
        <section aria-labelledby="reasons-heading" className="panel">
          <h2 id="reasons-heading">Why</h2>
          <ul className="reasons reasons-large">
            {claim.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="chain-heading" className="panel">
        <h2 id="chain-heading">The chain of support</h2>
        <p className="panel-note">
          Drawn as a core sample: depth downwards, each node stamped with the SHA-256 of its own bytes. The
          walk visited {claim.visited} node{claim.visited === 1 ? '' : 's'} and found {claim.allPaths} path
          {claim.allPaths === 1 ? '' : 's'} to terminal evidence.
        </p>
        <Spine nodes={claim.spine} caption={`Support chain for ${claim.id}`} />
      </section>

      <section aria-labelledby="seal-heading" className="panel">
        <h2 id="seal-heading">The seal</h2>
        <p className="panel-note">
          A content address over the verdict&apos;s substance — the status, the two tonnages, the defects and
          the terminal evidence. Forging this claim again returns the same seal.
        </p>
        <p className="seal-full">{claim.seal}</p>
      </section>
    </>
  )
}

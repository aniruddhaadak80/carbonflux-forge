import { INVENTORY, shortAddress } from '@/lib/inventory'

export const dynamic = 'force-static'

/** Addresses that some newer revision has replaced, computed once for the whole page. */
function supersededAddresses(): ReadonlySet<string> {
  const set = new Set<string>()
  for (const document of INVENTORY.documents) {
    if (document.supersedes !== null) set.add(document.supersedes)
  }
  return set
}

export default function EvidencePage() {
  const superseded = supersededAddresses()
  const documents = [...INVENTORY.documents].sort((left, right) =>
    left.kind === right.kind ? left.label.localeCompare(right.label) : left.kind.localeCompare(right.kind),
  )

  return (
    <>
      <section className="notebook-head">
        <p className="eyebrow">content-addressed store</p>
        <h1>Evidence</h1>
        <p className="lede">
          Every document is identified by the SHA-256 of its own bytes. Identical evidence is stored once; a
          corrected document becomes a new address rather than overwriting the old one, which is how a claim
          still citing a replaced document gets caught.
        </p>
      </section>

      {documents.length === 0 ? (
        <p className="state" data-kind="empty">
          The evidence store is empty. Run <code>npm run fixtures</code> to populate it.
        </p>
      ) : (
        <section aria-labelledby="documents-heading">
          <h2 id="documents-heading" className="section-heading">
            {documents.length} documents
          </h2>
          <div className="table-scroll">
            <table className="ledger ledger-wide">
              <thead>
                <tr>
                  <th scope="col">address</th>
                  <th scope="col">kind</th>
                  <th scope="col">label</th>
                  <th scope="col">bytes</th>
                  <th scope="col">state</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.address} data-superseded={superseded.has(document.address)}>
                    <td className="mono-cell">{shortAddress(document.address)}</td>
                    <td>{document.kind}</td>
                    <td>{document.label}</td>
                    <td className="num">{document.bytes}</td>
                    <td>
                      {!document.trusted && (
                        <span className="tag" data-tone="danger">
                          untrusted
                        </span>
                      )}
                      {superseded.has(document.address) && (
                        <span className="tag" data-tone="warn">
                          superseded
                        </span>
                      )}
                      {document.trusted && !superseded.has(document.address) && (
                        <span className="tag" data-tone="ok">
                          current
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

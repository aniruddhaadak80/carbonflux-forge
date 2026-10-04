import { PRODUCT, SURFACES, DELIBERATELY_OMITTED } from '@/lib/product'

export const dynamic = 'force-static'

export default function SurfacesPage() {
  const shipped = SURFACES.filter((surface) => surface.status === 'shipped')

  return (
    <>
      <section className="notebook-head">
        <p className="eyebrow">what this repository actually contains</p>
        <h1>Surfaces</h1>
        <p className="lede">
          Every capability is a <code>Tool</code> in one registry, reachable identically from the CLI and the
          MCP server. There is no second implementation of anything listed here.
        </p>
      </section>

      <section aria-labelledby="shipped-heading">
        <h2 id="shipped-heading" className="section-heading">
          Shipped
        </h2>
        <div className="grid">
          {shipped.map((surface) => (
            <article className="card" key={surface.id}>
              <span className="badge" data-tone="ok">
                shipped
              </span>
              <h3>{surface.title}</h3>
              <p>{surface.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="omitted-heading" className="panel">
        <h2 id="omitted-heading">Deliberately absent</h2>
        <p className="panel-note">
          Omission is a design decision, not a gap. {PRODUCT.name} exists to make one number defensible, and
          both of these would make it arguable.
        </p>
        <div className="grid">
          {DELIBERATELY_OMITTED.map((surface) => (
            <article className="card" key={surface.id}>
              <span className="badge" data-tone="warn">
                omitted
              </span>
              <h3>{surface.title}</h3>
              <p>{surface.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="rules-heading" className="panel">
        <h2 id="rules-heading">Rules this app obeys</h2>
        <div className="grid">
          <article className="card">
            <h3>Tokens only</h3>
            <p>
              Every colour resolves through <code>styles/tokens.css</code>. A raw literal anywhere else fails{' '}
              <code>check:theme-tokens</code>.
            </p>
          </article>
          <article className="card">
            <h3>One engine</h3>
            <p>
              This app imports verdicts the Python engine produced. It never recomputes a tonnage or re-walks
              a graph, because a second engine is a second thing to be wrong.
            </p>
          </article>
          <article className="card">
            <h3>Server-rendered first</h3>
            <p>
              The claims, the census and the chain are in the initial HTML. No client-side spinner hiding an
              empty page.
            </p>
          </article>
          <article className="card">
            <h3>Three states, three designs</h3>
            <p>Loading, empty and error are distinct components — never one box reused for all.</p>
          </article>
        </div>
      </section>
    </>
  )
}

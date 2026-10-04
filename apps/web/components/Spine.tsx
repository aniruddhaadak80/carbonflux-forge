import type { SpineNode } from '@/lib/inventory'
import { shortAddress } from '@/lib/inventory'

/**
 * The signature element: a provenance chain drawn as a core sample.
 *
 * A claim's support chain is a depth, not a tree, in the reader's mind — you want to know how far
 * it goes and what it rests on at the bottom. So it is drawn as one: a fixed-pitch rail with tick
 * marks at every metre-equivalent, each node labelled with the actual content address it has.
 *
 * The addresses are the point. A chain drawn with friendly names invites you to trust it; a chain
 * drawn with `sha256:8898bfa0…d52b` asks you to check it.
 */
export function Spine({ nodes, caption }: { nodes: readonly SpineNode[]; caption?: string }) {
  if (nodes.length === 0) {
    return (
      <p className="state" data-kind="empty">
        No provenance chain was recorded for this claim.
      </p>
    )
  }

  return (
    <figure className="spine-figure">
      <ol className="spine" aria-label={caption ?? 'Provenance chain'}>
        {nodes.map((node, index) => (
          <li className="spine-row" key={`${node.id}-${index}`} data-trusted={node.trusted}>
            <span className="spine-rail" aria-hidden="true">
              <span className="spine-tick" data-depth={index} />
            </span>
            <div className="spine-body">
              <div className="spine-line">
                <span className="spine-kind">{node.kind}</span>
                <span className="spine-type" data-type={node.type}>
                  {node.type}
                </span>
                {!node.trusted && (
                  <span className="spine-flag" data-tone="danger">
                    untrusted
                  </span>
                )}
              </div>
              {node.label !== null && <p className="spine-label">{node.label}</p>}
              <p className="spine-addr">
                <span className="spine-addr-prefix">sha256</span>
                {node.address.startsWith('sha256:') ? node.address.slice(7) : node.address}
              </p>
              {index < nodes.length - 1 && (
                <p className="spine-relation">
                  <span aria-hidden="true">↓</span> {node.relation ?? 'derived-from'}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {caption !== undefined && <figcaption className="spine-caption">{caption}</figcaption>}
    </figure>
  )
}

/** A compact inline chain for list rows, so a claim's grounding is visible without a click. */
export function SpineMini({ nodes }: { nodes: readonly SpineNode[] }) {
  return (
    <span className="spine-mini" aria-hidden="true">
      {nodes.map((node, index) => (
        <span className="spine-mini-node" key={`${node.id}-${index}`} data-trusted={node.trusted}>
          <span className="spine-mini-bar" />
        </span>
      ))}
    </span>
  )
}

export { shortAddress }

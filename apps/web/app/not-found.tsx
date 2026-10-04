import Link from 'next/link'

export default function NotFound() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">404</span>
        <h1>Not found</h1>
        <p>That route does not exist in this product.</p>
        <Link href="/">Back to the overview →</Link>
      </section>
    </>
  )
}

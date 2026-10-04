'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="hero">
      <span className="eyebrow">Error</span>
      <h1>Something went wrong</h1>
      <p className="state" data-kind="error">
        {error.message}
      </p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  )
}

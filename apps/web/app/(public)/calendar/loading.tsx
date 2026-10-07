/** Streaming skeleton shown while a public page fetches its data. */
export default function PublicLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading… · جارٍ التحميل…</span>
      <div className="h-8 w-2/3 max-w-md animate-pulse rounded-lg bg-surface-2" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-surface-2" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card h-40 animate-pulse bg-surface-2" />
        ))}
      </div>
    </div>
  );
}

/** A list's outline while it loads. */
export default function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden max-w-3xl animate-pulse" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800/60 last:border-0">
          <div className="w-6 h-3 rounded bg-gray-800" />
          <div className="w-7 h-7 rounded bg-gray-800" />
          <div className="h-3 rounded bg-gray-800" style={{ width: `${30 + ((i * 37) % 40)}%` }} />
        </div>
      ))}
    </div>
  );
}

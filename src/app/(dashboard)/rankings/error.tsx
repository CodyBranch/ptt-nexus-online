'use client';

/**
 * Anything on XC Rankings that fails outside the lists' own handling. The
 * message is Next's; in production it is generic, and the digest is what
 * finds the real error in the Vercel logs.
 */
export default function RankingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-3">XC Rankings</h1>
      <div className="bg-red-950/30 border border-red-900/60 rounded-xl px-4 py-4 text-sm">
        <div className="text-red-300 font-medium">The page could not be shown.</div>
        <div className="text-red-300/70 mt-1 font-mono text-xs break-all">{error.message}</div>
        {error.digest && <div className="text-gray-500 mt-1 text-xs">Reference: {error.digest}</div>}
        <div className="mt-3 flex gap-2">
          <button onClick={reset} className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200">Try again</button>
          <a href="/rankings" className="px-3 py-1.5 rounded border border-gray-700 hover:border-gray-500 text-gray-300">Back to the rankings</a>
        </div>
      </div>
    </div>
  );
}

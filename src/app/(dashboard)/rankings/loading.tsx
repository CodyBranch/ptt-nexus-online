import ListSkeleton from './ListSkeleton';

/** Shown the moment XC Rankings is opened, while the server reads the database. */
export default function Loading() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">XC Rankings</h1>
      <p className="text-sm text-gray-500 mb-6">Loading the rankings…</p>
      <ListSkeleton rows={12} />
    </div>
  );
}

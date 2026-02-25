import { getRecordSets } from './actions';
import RecordSetsList from './RecordSetsList';

export const dynamic = 'force-dynamic';

export default async function RecordsPage() {
  const recordSets = await getRecordSets();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Record Sets</h1>
        <a
          href="/records/new"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          + New Record Set
        </a>
      </div>

      <RecordSetsList recordSets={recordSets} />
    </div>
  );
}

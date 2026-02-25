import { notFound } from 'next/navigation';
import { getRecordSet, getRecords, getEventDefinitions } from '../actions';
import RecordSetDetail from './RecordSetDetail';
import { RECORD_SCOPES } from '@/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

function scopeLabel(scope: string) {
  return RECORD_SCOPES.find((s) => s.value === scope)?.label ?? scope;
}

export default async function RecordSetPage({ params }: PageProps) {
  const { id } = await params;
  const recordSet = await getRecordSet(id);

  if (!recordSet) {
    notFound();
  }

  // Fetch records and event definitions in parallel
  const [records, eventDefs] = await Promise.all([
    getRecords(id),
    getEventDefinitions(
      recordSet.season ? { venueFilter: recordSet.season } : undefined
    ),
  ]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{recordSet.name}</h1>
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-400 border border-gray-700">
              {recordSet.abbreviation}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{scopeLabel(recordSet.scope)}</span>
            <span className="text-gray-700">|</span>
            <span>{recordSet.gender === 'M' ? 'Men' : recordSet.gender === 'F' ? 'Women' : 'Both'}</span>
            <span className="text-gray-700">|</span>
            <span>{recordSet.season === 'indoor' ? 'Indoor' : recordSet.season === 'outdoor' ? 'Outdoor' : 'Both seasons'}</span>
          </div>
          {recordSet.description && (
            <p className="text-sm text-gray-500 mt-2">{recordSet.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <a
            href={`/records/${id}/edit`}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Edit Set
          </a>
        </div>
      </div>

      <RecordSetDetail recordSetId={id} initialRecords={records} eventDefinitions={eventDefs} />
    </div>
  );
}

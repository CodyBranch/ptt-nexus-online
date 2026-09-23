import { getSubmissions, countByStatus } from './actions';
import SubmissionQueue from './SubmissionQueue';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function SubmissionsPage({ searchParams }: PageProps) {
  const { status = 'pending' } = await searchParams;
  const [rows, counts] = await Promise.all([getSubmissions(status), countByStatus()]);

  const tab = (value: string, label: string) => (
    <a
      href={`/submissions?status=${value}`}
      className={`px-3 py-1.5 rounded text-sm transition-colors ${
        status === value ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
      {counts[value] > 0 && (
        <span className="ml-1.5 text-xs text-gray-500">{counts[value]}</span>
      )}
    </a>
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Submissions</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          Schools a meet met that this database does not have, sent up from Org Matching.
          Nothing here is in the organisation database — approving one is what creates it,
          which is why they wait: entry files carry misspellings and one-off names, and
          anything that went straight in would be permanent.
        </p>
      </div>

      <div className="flex items-center gap-1 mb-4">
        {tab('pending', 'Waiting')}
        {tab('approved', 'Approved')}
        {tab('rejected', 'Turned down')}
        {tab('all', 'All')}
      </div>

      <SubmissionQueue rows={rows} status={status} />
    </div>
  );
}

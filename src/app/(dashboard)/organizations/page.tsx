import { getOrganizations } from './actions';
import OrganizationsList from './OrganizationsList';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string; state?: string; conference?: string; page?: string }>;
}

export default async function OrganizationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const { data, total } = await getOrganizations({
    q: params.q,
    type: params.type,
    state: params.state,
    conference: params.conference,
    limit,
    offset,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Organizations</h1>
        <a
          href="/organizations/new"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          + Add Organization
        </a>
      </div>

      <OrganizationsList
        organizations={data}
        total={total}
        page={page}
        limit={limit}
        initialSearch={params.q ?? ''}
        initialType={params.type ?? ''}
        initialState={params.state ?? ''}
      />
    </div>
  );
}

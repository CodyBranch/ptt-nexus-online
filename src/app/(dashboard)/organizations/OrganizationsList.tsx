'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteOrganization } from './actions';
import { ORGANIZATION_TYPES, US_STATES } from '@/types';
import { classifyLogoUrl, LOGO_URL_WARNINGS } from './logo-url';

interface Organization {
  id: string;
  name: string;
  abbreviation: string;
  organizationType: string;
  city: string | null;
  state: string | null;
  conference: string | null;
  ncaaDivision: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  isActive: boolean | null;
}

interface Props {
  organizations: Organization[];
  total: number;
  page: number;
  limit: number;
  initialSearch: string;
  initialType: string;
  initialState: string;
}

export default function OrganizationsList({
  organizations,
  total,
  page,
  limit,
  initialSearch,
  initialType,
  initialState,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(initialSearch);
  const [typeFilter, setTypeFilter] = useState(initialType);
  const [stateFilter, setStateFilter] = useState(initialState);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const totalPages = Math.ceil(total / limit);

  function applyFilters() {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (typeFilter) params.set('type', typeFilter);
    if (stateFilter) params.set('state', stateFilter);
    startTransition(() => {
      router.push(`/organizations?${params.toString()}`);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') applyFilters();
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteOrganization(id);
      setDeleteId(null);
    });
  }

  const typeLabel = (type: string) =>
    ORGANIZATION_TYPES.find((t) => t.value === type)?.label ?? type;

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search by name, abbreviation, city..."
          className="flex-1 min-w-64 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); }}
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500"
        >
          <option value="">All Types</option>
          {ORGANIZATION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => { setStateFilter(e.target.value); }}
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500"
        >
          <option value="">All States</option>
          {US_STATES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button
          onClick={applyFilters}
          disabled={isPending}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? 'Loading...' : 'Search'}
        </button>
      </div>

      {/* Results count */}
      <div className="text-xs text-gray-500 mb-3">
        {total} organization{total !== 1 ? 's' : ''} found
        {totalPages > 1 && ` — page ${page} of ${totalPages}`}
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3 w-10"></th>
              <th className="px-4 py-3 w-14">Logo</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 w-20">Abbr</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Conference</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-600">
                  {total === 0 ? (
                    <div>
                      <p className="text-lg mb-2">No organizations yet</p>
                      <a href="/organizations/new" className="text-blue-400 hover:text-blue-300 text-sm">
                        Add your first organization
                      </a>
                    </div>
                  ) : (
                    'No matching organizations found'
                  )}
                </td>
              </tr>
            ) : (
              organizations.map((org) => (
                <tr
                  key={org.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors"
                  onClick={() => router.push(`/organizations/${org.id}`)}
                >
                  <td className="px-4 py-3">
                    {org.primaryColor ? (
                      <div
                        className="w-6 h-6 rounded-full border border-gray-700"
                        style={{ backgroundColor: org.primaryColor }}
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-700" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <LogoThumb url={org.logoUrl} abbreviation={org.abbreviation} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-200">{org.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-400">{org.abbreviation}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {typeLabel(org.organizationType)}
                    {org.ncaaDivision && (
                      <span className="ml-1 text-xs text-gray-500">({org.ncaaDivision})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {[org.city, org.state].filter(Boolean).join(', ') || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {org.conference || '-'}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <button
                        onClick={() => router.push(`/organizations/${org.id}`)}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteId(org.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          {page > 1 && (
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (search) params.set('q', search);
                if (typeFilter) params.set('type', typeFilter);
                if (stateFilter) params.set('state', stateFilter);
                params.set('page', String(page - 1));
                router.push(`/organizations?${params.toString()}`);
              }}
              className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 transition-colors"
            >
              Previous
            </button>
          )}
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (search) params.set('q', search);
                if (typeFilter) params.set('type', typeFilter);
                if (stateFilter) params.set('state', stateFilter);
                params.set('page', String(page + 1));
                router.push(`/organizations?${params.toString()}`);
              }}
              className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 transition-colors"
            >
              Next
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Delete Organization?</h3>
            <p className="text-sm text-gray-400 mb-6">
              This will deactivate the organization. It can be restored later.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                disabled={isPending}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The row's logo, or a stand-in that says why there isn't one.
 *
 * A missing logo is a blank the eye slides past, so every row gets a box: the
 * image where there is one, the abbreviation where there is not, and a
 * coloured ring where the URL is stored but unusable — relative, placeholder,
 * or simply not loading. Hover gives the reason.
 */
function LogoThumb({ url, abbreviation }: { url: string | null; abbreviation: string }) {
  // Keyed on the URL, not a bare flag: a row keeps its component instance when
  // the logo is edited, and a fixed URL should stop looking broken.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const kind = classifyLogoUrl(url);
  const broken = kind === 'ok' && failedUrl === url;

  if (kind === 'ok' && !broken) {
    return (
      <div
        className="w-9 h-9 rounded border border-gray-700 flex items-center justify-center overflow-hidden"
        style={{
          backgroundColor: '#1f2937',
          backgroundImage:
            'linear-gradient(45deg, #374151 25%, transparent 25%), linear-gradient(-45deg, #374151 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #374151 75%), linear-gradient(-45deg, transparent 75%, #374151 75%)',
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts */}
        <img src={url ?? ''} alt="" className="max-w-full max-h-full object-contain"
          onError={() => setFailedUrl(url)} />
      </div>
    );
  }

  const title =
    kind === 'relative' ? LOGO_URL_WARNINGS.relative
    : kind === 'placeholder' ? LOGO_URL_WARNINGS.placeholder
    : broken ? "Logo URL is set but didn't load"
    : 'No logo';
  const ring =
    kind === 'placeholder' ? 'border-amber-500/50 text-amber-500/70'
    : kind === 'empty' ? 'border-gray-700 text-gray-500'
    : 'border-red-500/50 text-red-400/80';

  return (
    <div
      title={title}
      className={`w-9 h-9 rounded border bg-gray-800 flex items-center justify-center text-[10px] font-semibold uppercase ${ring}`}
    >
      {abbreviation.slice(0, 3) || '—'}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteRecordSet } from './actions';
import { RECORD_SCOPES } from '@/types';

interface RecordSetView {
  id: string;
  name: string;
  abbreviation: string;
  description: string | null;
  scope: string;
  gender: string | null;
  season: string | null;
  isActive: boolean | null;
  recordCount: number;
  organizationName: string | null;
  updatedAt: Date | null;
}

function scopeLabel(scope: string) {
  return RECORD_SCOPES.find((s) => s.value === scope)?.label ?? scope;
}

function genderLabel(g: string | null) {
  if (!g) return 'Both';
  return g === 'M' ? 'Men' : 'Women';
}

function seasonLabel(s: string | null) {
  if (!s) return 'Both';
  return s === 'indoor' ? 'Indoor' : 'Outdoor';
}

function scopeColor(scope: string) {
  switch (scope) {
    case 'world': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'national': return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'collegiate': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'state': return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'conference': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    case 'facility': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}

export default function RecordSetsList({ recordSets }: { recordSets: RecordSetView[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteRecordSet(id);
      setDeleteId(null);
    });
  }

  if (recordSets.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
        <p className="text-lg text-gray-500 mb-2">No record sets yet</p>
        <a href="/records/new" className="text-blue-400 hover:text-blue-300 text-sm">
          Create your first record set
        </a>
      </div>
    );
  }

  return (
    <div>
      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {recordSets.map((rs) => (
          <div
            key={rs.id}
            onClick={() => router.push(`/records/${rs.id}`)}
            className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 cursor-pointer transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-gray-200">{rs.name}</h3>
                <span className="text-xs font-mono text-gray-500">{rs.abbreviation}</span>
              </div>
              <span className={`px-2 py-0.5 text-xs rounded-full border ${scopeColor(rs.scope)}`}>
                {scopeLabel(rs.scope)}
              </span>
            </div>

            {rs.description && (
              <p className="text-xs text-gray-500 mb-3 line-clamp-2">{rs.description}</p>
            )}

            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{rs.recordCount} record{rs.recordCount !== 1 ? 's' : ''}</span>
              <span className="text-gray-700">|</span>
              <span>{genderLabel(rs.gender)}</span>
              <span className="text-gray-700">|</span>
              <span>{seasonLabel(rs.season)}</span>
            </div>

            {rs.organizationName && (
              <div className="text-xs text-gray-600 mt-2">
                Org: {rs.organizationName}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => router.push(`/records/${rs.id}`)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                View
              </button>
              <button
                onClick={() => setDeleteId(rs.id)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Delete Record Set?</h3>
            <p className="text-sm text-gray-400 mb-6">
              This will deactivate the record set and all its records. It can be restored later.
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

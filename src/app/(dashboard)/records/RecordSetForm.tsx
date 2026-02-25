'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createRecordSet, updateRecordSet } from './actions';
import { RECORD_SCOPES } from '@/types';
import type { RecordCondition } from '@/types';

interface RecordSetData {
  id: string;
  name: string;
  abbreviation: string;
  description: string | null;
  scope: string;
  gender: string | null;
  season: string | null;
  organizationId: string | null;
  eligibilityRules: unknown;
  isPublic: boolean | null;
  notes: string | null;
}

interface Props {
  recordSet?: RecordSetData | null;
}

export default function RecordSetForm({ recordSet }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const isEdit = !!recordSet;

  const [name, setName] = useState(recordSet?.name ?? '');
  const [abbreviation, setAbbreviation] = useState(recordSet?.abbreviation ?? '');
  const [description, setDescription] = useState(recordSet?.description ?? '');
  const [scope, setScope] = useState(recordSet?.scope ?? 'facility');
  const [gender, setGender] = useState(recordSet?.gender ?? '');
  const [season, setSeason] = useState(recordSet?.season ?? '');
  const [isPublic, setIsPublic] = useState(recordSet?.isPublic ?? true);
  const [notes, setNotes] = useState(recordSet?.notes ?? '');

  // Eligibility rules — simplified for now (will build visual builder later)
  const existingRules = (recordSet?.eligibilityRules as RecordCondition[]) ?? [];
  const [rulesJson, setRulesJson] = useState(
    existingRules.length > 0 ? JSON.stringify(existingRules, null, 2) : '[{ "type": "any" }]'
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !abbreviation.trim()) {
      setError('Name and abbreviation are required');
      return;
    }

    let parsedRules: unknown[];
    try {
      parsedRules = JSON.parse(rulesJson);
      if (!Array.isArray(parsedRules)) throw new Error('Rules must be an array');
    } catch {
      setError('Invalid eligibility rules JSON');
      return;
    }

    setError('');

    const data = {
      name: name.trim(),
      abbreviation: abbreviation.trim().toUpperCase(),
      description: description.trim() || undefined,
      scope,
      gender: gender || undefined,
      season: season || undefined,
      eligibilityRules: parsedRules,
      isPublic,
      notes: notes.trim() || undefined,
    };

    startTransition(async () => {
      try {
        if (isEdit && recordSet) {
          await updateRecordSet(recordSet.id, data);
        } else {
          await createRecordSet(data);
        }
        router.push('/records');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    });
  }

  const inputClass = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500';
  const labelClass = 'block text-xs text-gray-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Identity */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Identity</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="SEC Indoor Conference Records" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Abbreviation *</label>
            <input type="text" value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)}
              placeholder="SEC-IR" className={inputClass} maxLength={10} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2} className={inputClass} placeholder="Optional description..." />
          </div>
        </div>
      </div>

      {/* Scope & Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Scope & Filters</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Scope *</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputClass}>
              {RECORD_SCOPES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Gender</label>
            <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputClass}>
              <option value="">Both (M & F)</option>
              <option value="M">Men</option>
              <option value="F">Women</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Season</label>
            <select value={season} onChange={(e) => setSeason(e.target.value)} className={inputClass}>
              <option value="">Both</option>
              <option value="indoor">Indoor</option>
              <option value="outdoor">Outdoor</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)}
              className="rounded border-gray-600" />
            Publicly visible
          </label>
        </div>
      </div>

      {/* Eligibility Rules */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">Eligibility Rules</h2>
        <p className="text-xs text-gray-500 mb-4">
          JSON array of conditions. All conditions must match (AND logic).
          Use <code className="text-gray-400">{`[{ "type": "any" }]`}</code> for no restrictions.
        </p>
        <textarea
          value={rulesJson}
          onChange={(e) => setRulesJson(e.target.value)}
          rows={6}
          className={`${inputClass} font-mono text-xs`}
          spellCheck={false}
        />
        <div className="mt-3 text-xs text-gray-600 space-y-1">
          <p>Condition types: <code className="text-gray-500">any</code>, <code className="text-gray-500">team_type</code>, <code className="text-gray-500">organization_id</code>, <code className="text-gray-500">conference</code>, <code className="text-gray-500">ncaa_division</code>, <code className="text-gray-500">nationality</code>, <code className="text-gray-500">is_high_school</code>, <code className="text-gray-500">is_collegiate</code></p>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass}
          placeholder="Internal notes..."
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Record Set'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/records')}
          className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

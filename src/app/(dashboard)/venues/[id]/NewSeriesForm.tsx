'use client';

import { useState, useTransition } from 'react';
import { createMeetSeries } from '../actions';
import { RECORD_LEVELS } from '@/types';

export default function NewSeriesForm({ venueId }: { venueId: string }) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');
  const [error, setError] = useState('');

  const inputClass = 'px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        startTransition(async () => {
          try {
            await createMeetSeries({ name, venueId, level });
            setName(''); setLevel('');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not add the meet series');
          }
        });
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex-1 min-w-48">
        <label className="block text-xs text-gray-400 mb-1">New meet series</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gans Creek Classic College" className={`${inputClass} w-full`} />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Level</label>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputClass}>
          <option value="">Any</option>
          {RECORD_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>
      <button type="submit" disabled={isPending || !name.trim()}
        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50">
        {isPending ? 'Adding…' : 'Add series'}
      </button>
      {error && <div className="w-full text-sm text-red-400">{error}</div>}
    </form>
  );
}

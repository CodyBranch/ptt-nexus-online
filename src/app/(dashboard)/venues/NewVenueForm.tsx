'use client';

import { useState, useTransition } from 'react';
import { createVenue } from './actions';

export default function NewVenueForm() {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState('');

  const inputClass = 'px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        startTransition(async () => {
          try {
            await createVenue({ name, city, state });
            setName(''); setCity(''); setState('');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not add the venue');
          }
        });
      }}
      className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-end gap-3"
    >
      <div className="flex-1 min-w-48">
        <label className="block text-xs text-gray-400 mb-1">New venue</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gans Creek Cross Country Course" className={`${inputClass} w-full`} />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">City</label>
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Columbia" className={`${inputClass} w-40`} />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">State</label>
        <input value={state} onChange={(e) => setState(e.target.value)} placeholder="MO" maxLength={2} className={`${inputClass} w-16 uppercase`} />
      </div>
      <button type="submit" disabled={isPending || !name.trim()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50">
        {isPending ? 'Adding…' : 'Add venue'}
      </button>
      {error && <div className="w-full text-sm text-red-400">{error}</div>}
    </form>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { createRecord, deleteRecord } from '../actions';

interface RecordView {
  id: string;
  eventCode: string;
  gender: string;
  mark: string;
  markSortable: number;
  athleteName: string | null;
  teamName: string | null;
  meetName: string | null;
  recordDate: string | null;
  wind: number | null;
  verified: boolean | null;
  source: string | null;
}

interface Props {
  recordSetId: string;
  initialRecords: RecordView[];
}

export default function RecordSetDetail({ recordSetId, initialRecords }: Props) {
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [genderFilter, setGenderFilter] = useState<string>('');

  // Add record form state
  const [eventCode, setEventCode] = useState('');
  const [gender, setGender] = useState('M');
  const [mark, setMark] = useState('');
  const [markSortable, setMarkSortable] = useState('');
  const [athleteName, setAthleteName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [meetName, setMeetName] = useState('');
  const [recordDate, setRecordDate] = useState('');
  const [wind, setWind] = useState('');
  const [addError, setAddError] = useState('');

  const filtered = genderFilter
    ? initialRecords.filter((r) => r.gender === genderFilter)
    : initialRecords;

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteRecord(id);
      setDeleteId(null);
    });
  }

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!eventCode.trim() || !mark.trim() || !markSortable.trim()) {
      setAddError('Event code, mark, and sortable mark are required');
      return;
    }
    setAddError('');

    startTransition(async () => {
      try {
        await createRecord({
          recordSetId,
          eventCode: eventCode.trim().toUpperCase(),
          gender,
          mark: mark.trim(),
          markSortable: parseFloat(markSortable),
          athleteName: athleteName.trim() || undefined,
          teamName: teamName.trim() || undefined,
          meetName: meetName.trim() || undefined,
          recordDate: recordDate || undefined,
          wind: wind ? parseFloat(wind) : undefined,
        });
        // Reset form
        setEventCode('');
        setMark('');
        setMarkSortable('');
        setAthleteName('');
        setTeamName('');
        setMeetName('');
        setRecordDate('');
        setWind('');
        setShowAddForm(false);
      } catch (err) {
        setAddError(err instanceof Error ? err.message : 'Failed to add record');
      }
    });
  }

  const inputClass = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500';

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </span>
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300"
          >
            <option value="">All Genders</option>
            <option value="M">Men</option>
            <option value="F">Women</option>
          </select>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          {showAddForm ? 'Cancel' : '+ Add Record'}
        </button>
      </div>

      {/* Add record form */}
      {showAddForm && (
        <form onSubmit={handleAddRecord} className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4">
          {addError && (
            <div className="px-3 py-2 mb-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
              {addError}
            </div>
          )}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Event Code *</label>
              <input type="text" value={eventCode} onChange={(e) => setEventCode(e.target.value)}
                placeholder="100" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Gender *</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputClass}>
                <option value="M">Men</option>
                <option value="F">Women</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Mark *</label>
              <input type="text" value={mark} onChange={(e) => setMark(e.target.value)}
                placeholder="9.58" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Sortable (numeric) *</label>
              <input type="number" step="0.001" value={markSortable} onChange={(e) => setMarkSortable(e.target.value)}
                placeholder="9.58" className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Athlete</label>
              <input type="text" value={athleteName} onChange={(e) => setAthleteName(e.target.value)}
                placeholder="Usain Bolt" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Team</label>
              <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)}
                placeholder="Jamaica" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Meet</label>
              <input type="text" value={meetName} onChange={(e) => setMeetName(e.target.value)}
                placeholder="2009 World Championships" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Date</label>
              <input type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)}
                className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Wind (m/s)</label>
              <input type="number" step="0.1" value={wind} onChange={(e) => setWind(e.target.value)}
                placeholder="0.9" className={inputClass} />
            </div>
            <div className="col-span-3 flex items-end">
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {isPending ? 'Adding...' : 'Add Record'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Records table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3 w-10">Sex</th>
              <th className="px-4 py-3">Mark</th>
              <th className="px-4 py-3">Athlete</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Meet</th>
              <th className="px-4 py-3 w-24">Date</th>
              <th className="px-4 py-3 w-16">Wind</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-600">
                  No records yet. Click &quot;Add Record&quot; to get started.
                </td>
              </tr>
            ) : (
              filtered.map((record) => (
                <tr key={record.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm font-medium text-gray-200">{record.eventCode}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">{record.gender}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm font-semibold text-blue-400">{record.mark}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{record.athleteName || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{record.teamName || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{record.meetName || '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{record.recordDate || '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {record.wind !== null ? `${record.wind > 0 ? '+' : ''}${record.wind}` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setDeleteId(record.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Delete Record?</h3>
            <p className="text-sm text-gray-400 mb-6">
              This will permanently remove this record entry.
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

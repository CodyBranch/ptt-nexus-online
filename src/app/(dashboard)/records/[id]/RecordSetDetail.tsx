'use client';

import { useState, useTransition, useMemo, useRef, useEffect } from 'react';
import { createRecord, deleteRecord } from '../actions';

// ═══════════════════════════════════════════════════════════
// Mark-to-sortable conversion utilities
// ═══════════════════════════════════════════════════════════

/**
 * Parse a track & field mark string into a numeric sortable value.
 *
 * Supports these formats:
 *   Time:     "9.58", "45.94", "1:45.67", "2:01:45.3", "14:23.45"
 *   Distance: "8.95m", "8.95", "23' 4.5\"", "23-04.50"
 *   Height:   "2.37m", "2.37", "6' 2.75\"", "6-02.75"
 *   Points:   "8847", "8,847"
 *
 * For time events: returns total seconds (lower is better)
 * For field events: returns meters (higher is better)
 * For combined events: returns points (higher is better)
 */
function parseMarkToSortable(mark: string, markFormat: string | null): number | null {
  const cleaned = mark.trim();
  if (!cleaned) return null;

  switch (markFormat) {
    case 'points':
      return parsePoints(cleaned);
    case 'distance':
    case 'height':
      return parseDistance(cleaned);
    case 'time':
    default:
      return parseTime(cleaned);
  }
}

function parsePoints(mark: string): number | null {
  // Remove commas: "8,847" → "8847"
  const num = parseFloat(mark.replace(/,/g, ''));
  return isNaN(num) ? null : num;
}

function parseDistance(mark: string): number | null {
  // Try metric: "8.95m" or "8.95"
  const metricMatch = mark.match(/^(\d+(?:\.\d+)?)\s*m?$/i);
  if (metricMatch) {
    const val = parseFloat(metricMatch[1]);
    return isNaN(val) ? null : val;
  }

  // Try feet-inches: "23' 4.5\"" or "23-04.50" or "6' 2.75\""
  const feetInchMatch = mark.match(/^(\d+)['\-]\s*(\d+(?:\.\d+)?)"?\s*$/);
  if (feetInchMatch) {
    const feet = parseInt(feetInchMatch[1], 10);
    const inches = parseFloat(feetInchMatch[2]);
    // Convert to meters: 1 foot = 0.3048m, 1 inch = 0.0254m
    return feet * 0.3048 + inches * 0.0254;
  }

  // Try bare number
  const num = parseFloat(mark);
  return isNaN(num) ? null : num;
}

function parseTime(mark: string): number | null {
  // Remove trailing units if any
  const cleaned = mark.replace(/\s*s(ec(onds?)?)?\.?\s*$/i, '');

  // Format: H:MM:SS.ss or H:MM:SS
  const hmsMatch = cleaned.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (hmsMatch) {
    const hours = parseInt(hmsMatch[1], 10);
    const minutes = parseInt(hmsMatch[2], 10);
    const seconds = parseFloat(hmsMatch[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Format: M:SS.ss or MM:SS.ss
  const msMatch = cleaned.match(/^(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (msMatch) {
    const minutes = parseInt(msMatch[1], 10);
    const seconds = parseFloat(msMatch[2]);
    return minutes * 60 + seconds;
  }

  // Format: SS.ss (bare seconds)
  const secMatch = cleaned.match(/^(\d+(?:\.\d+)?)$/);
  if (secMatch) {
    const val = parseFloat(secMatch[1]);
    return isNaN(val) ? null : val;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

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

interface EventDef {
  id: string;
  name: string;
  shortName: string;
  eventType: string;
  category: string;
  venueFilter: string;
  sortOrder: number;
  isWindAffected: boolean | null;
  lowerIsBetter: boolean | null;
  markFormat: string | null;
}

interface Props {
  recordSetId: string;
  initialRecords: RecordView[];
  eventDefinitions: EventDef[];
}

// ═══════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════

export default function RecordSetDetail({ recordSetId, initialRecords, eventDefinitions }: Props) {
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

  // Event search dropdown state
  const [eventSearch, setEventSearch] = useState('');
  const [showEventDropdown, setShowEventDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const eventDropdownRef = useRef<HTMLDivElement>(null);
  const eventInputRef = useRef<HTMLInputElement>(null);

  // Look up the selected event definition
  const selectedEventDef = useMemo(
    () => eventDefinitions.find((e) => e.id === eventCode) ?? null,
    [eventCode, eventDefinitions]
  );

  // Is wind field relevant for the selected event?
  const showWind = selectedEventDef?.isWindAffected ?? false;

  // Filter event definitions by search term
  const filteredEvents = useMemo(() => {
    const q = eventSearch.toLowerCase().trim();
    if (!q) return eventDefinitions;
    return eventDefinitions.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.shortName.toLowerCase().includes(q)
    );
  }, [eventSearch, eventDefinitions]);

  // Build a display name map for event codes (used in the records table)
  const eventNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of eventDefinitions) {
      map.set(e.id, e.name);
    }
    return map;
  }, [eventDefinitions]);

  // Auto-compute markSortable when mark changes
  useEffect(() => {
    if (!mark.trim()) {
      setMarkSortable('');
      return;
    }
    const format = selectedEventDef?.markFormat ?? 'time';
    const computed = parseMarkToSortable(mark, format);
    if (computed !== null) {
      // Round to 3 decimal places for clean display
      setMarkSortable(String(Math.round(computed * 1000) / 1000));
    }
  }, [mark, selectedEventDef]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (eventDropdownRef.current && !eventDropdownRef.current.contains(e.target as Node)) {
        setShowEventDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset highlighted index when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredEvents.length]);

  const filtered = genderFilter
    ? initialRecords.filter((r) => r.gender === genderFilter)
    : initialRecords;

  function handleSelectEvent(eventDef: EventDef) {
    setEventCode(eventDef.id);
    setEventSearch('');
    setShowEventDropdown(false);
    // Clear wind if the new event isn't wind-affected
    if (!eventDef.isWindAffected) {
      setWind('');
    }
  }

  function handleEventKeyDown(e: React.KeyboardEvent) {
    if (!showEventDropdown) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setShowEventDropdown(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, filteredEvents.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredEvents[highlightedIndex]) {
          handleSelectEvent(filteredEvents[highlightedIndex]);
        }
        break;
      case 'Escape':
        setShowEventDropdown(false);
        break;
    }
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteRecord(id);
      setDeleteId(null);
    });
  }

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!eventCode.trim() || !mark.trim()) {
      setAddError('Event and mark are required');
      return;
    }

    // Auto-compute if markSortable is empty
    const sortableValue = markSortable.trim()
      ? parseFloat(markSortable)
      : parseMarkToSortable(mark, selectedEventDef?.markFormat ?? 'time');

    if (sortableValue === null || isNaN(sortableValue)) {
      setAddError('Could not compute a sortable value from the mark. Enter it manually.');
      return;
    }

    setAddError('');

    startTransition(async () => {
      try {
        await createRecord({
          recordSetId,
          eventCode: eventCode.trim(),
          gender,
          mark: mark.trim(),
          markSortable: sortableValue,
          athleteName: athleteName.trim() || undefined,
          teamName: teamName.trim() || undefined,
          meetName: meetName.trim() || undefined,
          recordDate: recordDate || undefined,
          wind: wind ? parseFloat(wind) : undefined,
        });
        // Reset form
        setEventCode('');
        setEventSearch('');
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

  // Category group labels for the dropdown
  function categoryLabel(cat: string): string {
    switch (cat) {
      case 'STRAIGHT': return 'Sprints';
      case 'RUN': return 'Distance / Middle';
      case 'RELAY': return 'Relays';
      case 'FIELD': return 'Field Events';
      case 'COMBINED': return 'Combined Events';
      default: return cat;
    }
  }

  // Group filtered events by category for better UX
  const groupedEvents = useMemo(() => {
    const groups: { category: string; label: string; events: EventDef[] }[] = [];
    const categoryOrder = ['STRAIGHT', 'RUN', 'RELAY', 'FIELD', 'COMBINED'];
    const catMap = new Map<string, EventDef[]>();

    for (const ev of filteredEvents) {
      const list = catMap.get(ev.category) ?? [];
      list.push(ev);
      catMap.set(ev.category, list);
    }

    for (const cat of categoryOrder) {
      const events = catMap.get(cat);
      if (events && events.length > 0) {
        groups.push({ category: cat, label: categoryLabel(cat), events });
      }
    }

    return groups;
  }, [filteredEvents]);

  // Flatten grouped events for keyboard navigation
  const flatGroupedEvents = useMemo(() => {
    return groupedEvents.flatMap((g) => g.events);
  }, [groupedEvents]);

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
            {/* Event selector */}
            <div className="relative" ref={eventDropdownRef}>
              <label className="block text-xs text-gray-400 mb-1">Event *</label>
              {eventCode ? (
                <div className="flex items-center gap-2">
                  <div className={`${inputClass} flex items-center justify-between`}>
                    <span className="font-medium text-gray-200">
                      {selectedEventDef?.shortName ?? eventCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEventCode('');
                        setEventSearch('');
                        setMark('');
                        setMarkSortable('');
                        setWind('');
                        setTimeout(() => eventInputRef.current?.focus(), 0);
                      }}
                      className="text-gray-500 hover:text-gray-300 ml-2"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ) : (
                <input
                  ref={eventInputRef}
                  type="text"
                  value={eventSearch}
                  onChange={(e) => {
                    setEventSearch(e.target.value);
                    setShowEventDropdown(true);
                  }}
                  onFocus={() => setShowEventDropdown(true)}
                  onKeyDown={handleEventKeyDown}
                  placeholder="Search events..."
                  className={inputClass}
                  autoComplete="off"
                />
              )}
              {showEventDropdown && !eventCode && (
                <div className="absolute z-50 mt-1 w-72 max-h-64 overflow-y-auto bg-gray-800 border border-gray-600 rounded-lg shadow-xl">
                  {groupedEvents.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">No events found</div>
                  ) : (
                    groupedEvents.map((group) => (
                      <div key={group.category}>
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-850 border-b border-gray-700 sticky top-0 bg-gray-800">
                          {group.label}
                        </div>
                        {group.events.map((ev) => {
                          const flatIdx = flatGroupedEvents.indexOf(ev);
                          const isHighlighted = flatIdx === highlightedIndex;
                          return (
                            <button
                              key={ev.id}
                              type="button"
                              onClick={() => handleSelectEvent(ev)}
                              onMouseEnter={() => setHighlightedIndex(flatIdx)}
                              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                                isHighlighted ? 'bg-blue-600/30 text-white' : 'text-gray-300 hover:bg-gray-700'
                              }`}
                            >
                              <span>
                                <span className="font-mono font-medium">{ev.shortName}</span>
                                <span className="text-gray-500 ml-2">{ev.name !== ev.shortName ? ev.name : ''}</span>
                              </span>
                              <span className="text-[10px] text-gray-600">
                                {ev.venueFilter === 'indoor' ? 'IN' : ev.venueFilter === 'outdoor' ? 'OUT' : ''}
                                {ev.isWindAffected ? ' W' : ''}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              )}
              {/* Show selected event info */}
              {selectedEventDef && (
                <div className="mt-1 text-[10px] text-gray-600">
                  {selectedEventDef.name}
                  {selectedEventDef.markFormat !== 'time' ? ` (${selectedEventDef.markFormat})` : ''}
                  {selectedEventDef.isWindAffected ? ' | Wind-affected' : ''}
                </div>
              )}
            </div>

            {/* Gender */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Gender *</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputClass}>
                <option value="M">Men</option>
                <option value="F">Women</option>
              </select>
            </div>

            {/* Mark */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Mark *</label>
              <input
                type="text"
                value={mark}
                onChange={(e) => setMark(e.target.value)}
                placeholder={
                  selectedEventDef?.markFormat === 'distance' ? '8.95m'
                    : selectedEventDef?.markFormat === 'height' ? '2.37m'
                    : selectedEventDef?.markFormat === 'points' ? '8847'
                    : '9.58 or 1:45.67'
                }
                className={inputClass}
              />
            </div>

            {/* Sortable (auto-computed) */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Sortable
                {markSortable && mark ? (
                  <span className="text-green-500 ml-1">(auto)</span>
                ) : (
                  <span className="text-gray-600 ml-1">(numeric)</span>
                )}
              </label>
              <input
                type="number"
                step="0.001"
                value={markSortable}
                onChange={(e) => setMarkSortable(e.target.value)}
                placeholder="auto-computed"
                className={`${inputClass} ${markSortable && mark ? 'border-green-800/50' : ''}`}
              />
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
            {showWind ? (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Wind (m/s)</label>
                <input type="number" step="0.1" value={wind} onChange={(e) => setWind(e.target.value)}
                  placeholder="0.9" className={inputClass} />
              </div>
            ) : (
              <div />
            )}
            <div className={`${showWind ? 'col-span-3' : 'col-span-3 col-start-2'} flex items-end`}>
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
                    <div>
                      <span className="font-mono text-sm font-medium text-gray-200">
                        {eventNameMap.get(record.eventCode) ?? record.eventCode}
                      </span>
                      {eventNameMap.has(record.eventCode) && eventNameMap.get(record.eventCode) !== record.eventCode && (
                        <span className="text-[10px] text-gray-600 ml-1.5">{record.eventCode}</span>
                      )}
                    </div>
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

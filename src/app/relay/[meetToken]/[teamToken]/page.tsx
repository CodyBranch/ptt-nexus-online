'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Athlete {
  id: string;
  firstName: string;
  lastName: string;
  bib?: string;
  gender?: string;
}

interface RelayEvent {
  id: string;
  name: string;
  gender: string;
  distance?: number;
  legs?: number;
  scheduledTime?: string;
  deadlineMinutes?: number;
}

interface LegEntry {
  leg: number;
  athleteId: string;
  firstName: string;
  lastName: string;
}

interface EventState {
  legs: LegEntry[];
  finalizedAt: string | null;
}

interface SessionData {
  meetName: string;
  meetDate?: string;
  teamName: string;
  events: RelayEvent[];
  roster: Athlete[];
  existingEntries: Record<string, EventState>;
}

// Leg slot (1-indexed): positions 1–4 are runners, 5–8 are alternates
interface Slot {
  position: number;
  athleteId: string | null;
}

// Entry status tracked in parent (updated optimistically on save)
interface EntryStatus {
  saved: boolean;
  finalizedAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stateToSlots(legs: LegEntry[]): Slot[] {
  const slots: Slot[] = Array.from({ length: 8 }, (_, i) => ({ position: i + 1, athleteId: null }));
  for (const l of legs) {
    if (l.leg >= 1 && l.leg <= 8) slots[l.leg - 1].athleteId = l.athleteId;
  }
  return slots;
}

function slotsToPayload(slots: Slot[], rosterMap: Map<string, Athlete>): LegEntry[] {
  return slots
    .filter(s => s.athleteId !== null)
    .map(s => {
      const a = rosterMap.get(s.athleteId!)!;
      return { leg: s.position, athleteId: s.athleteId!, firstName: a.firstName, lastName: a.lastName };
    });
}

function deadlineISO(event: RelayEvent): string | null {
  if (!event.scheduledTime) return null;
  return new Date(new Date(event.scheduledTime).getTime() - (event.deadlineMinutes ?? 30) * 60_000).toISOString();
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'Deadline passed';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m until deadline`;
  if (m > 0) return `${m}m ${sec}s until deadline`;
  return `${sec}s until deadline`;
}

/** Filter roster to only athletes whose gender matches the event. */
function filterRosterForEvent(roster: Athlete[], event: RelayEvent): Athlete[] {
  const g = event.gender?.toUpperCase();
  if (!g || g === 'X' || g === 'B' || g === 'N') return roster;
  return roster.filter(a => {
    if (!a.gender) return true; // unknown — show it
    const ag = a.gender.toUpperCase();
    if (g === 'M') return ag === 'M';
    if (g === 'F' || g === 'W') return ag === 'F';
    return true;
  });
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function useCountdown(isoDeadline: string | null): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (!isoDeadline) return;
    const dead = new Date(isoDeadline).getTime();
    const tick = () => setMs(dead - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isoDeadline]);
  return ms;
}

// ── Inline Athlete Picker ─────────────────────────────────────────────────────

function AthletePicker({
  roster,
  assignedIds,
  currentId,
  onSelect,
  onClear,
  onClose,
}: {
  roster: Athlete[];
  assignedIds: Set<string>;
  currentId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = roster.filter(a => {
    if (!q.trim()) return true;
    const lower = q.toLowerCase();
    return (
      a.lastName.toLowerCase().includes(lower) ||
      a.firstName.toLowerCase().includes(lower) ||
      (a.bib && a.bib.includes(q))
    );
  });

  return (
    <div className="mt-1 mb-2 bg-gray-850 border border-gray-600 rounded-lg overflow-hidden shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name or bib…"
          className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none"
        />
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 ml-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto">
        {currentId && (
          <button
            onClick={onClear}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/10 border-b border-gray-700/50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
            Clear this leg
          </button>
        )}

        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-600 italic">No athletes match &ldquo;{q}&rdquo;</p>
        ) : (
          filtered.map(a => {
            const isCurrent = a.id === currentId;
            const isTaken = assignedIds.has(a.id) && !isCurrent;
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors
                  ${isCurrent ? 'bg-blue-600/20 text-blue-200' : isTaken ? 'text-gray-500' : 'text-gray-200 hover:bg-gray-700'}
                `}
              >
                <span className="w-10 shrink-0 font-mono text-xs text-gray-500">
                  {a.bib ? `#${a.bib}` : '—'}
                </span>
                <span className="flex-1">{a.lastName}, {a.firstName}</span>
                {isCurrent && <span className="text-xs text-blue-400">current</span>}
                {isTaken && <span className="text-xs text-gray-600 italic">assigned</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Leg Row ───────────────────────────────────────────────────────────────────

function LegRow({
  slot, athlete, isAlt, isPickerOpen, isBeingDragged, isDragTarget,
  isFloating, floatY, rowTranslate, finalized, rosterMap, assignedIds,
  roster, onOpenPicker, onClosePicker, onAssign, onClear, onPointerDown, rowRef,
}: {
  slot: Slot;
  athlete: Athlete | null;
  isAlt: boolean;
  isPickerOpen: boolean;
  isBeingDragged: boolean;
  isDragTarget: boolean;
  isFloating: boolean;
  floatY: number;
  rowTranslate: number;
  finalized: boolean;
  rosterMap: Map<string, Athlete>;
  assignedIds: Set<string>;
  roster: Athlete[];
  onOpenPicker: () => void;
  onClosePicker: () => void;
  onAssign: (id: string) => void;
  onClear: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const label = isAlt ? `Alt ${slot.position - 4}` : `Leg ${slot.position}`;

  const rowContent = (
    <div
      className={`flex items-center gap-2 px-3 py-2.5 min-h-[42px] ${isFloating ? '' : 'transition-transform duration-150'}`}
      style={{ transform: isFloating ? undefined : rowTranslate !== 0 ? `translateY(${rowTranslate}px)` : undefined }}
    >
      {/* Drag handle — select-none prevents text selection during drag */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        {athlete && !finalized ? (
          <div
            onPointerDown={onPointerDown}
            className="touch-none select-none cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 p-0.5"
            title="Drag to reorder"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="5.5" cy="3.5"  r="1.5"/><circle cx="10.5" cy="3.5"  r="1.5"/>
              <circle cx="5.5" cy="8"    r="1.5"/><circle cx="10.5" cy="8"    r="1.5"/>
              <circle cx="5.5" cy="12.5" r="1.5"/><circle cx="10.5" cy="12.5" r="1.5"/>
            </svg>
          </div>
        ) : <div className="w-4 h-4"/>}
      </div>

      {/* Leg label */}
      <div className={`w-10 shrink-0 text-xs font-bold ${isAlt ? 'text-amber-400' : 'text-blue-400'}`}>
        {label}
      </div>

      {/* Athlete name / add button */}
      <div className="flex-1 min-w-0">
        {athlete ? (
          <button
            onClick={!finalized && !isFloating ? onOpenPicker : undefined}
            className={`text-left w-full text-sm flex items-center gap-1.5 group ${
              isFloating ? 'text-blue-200 font-medium' : 'text-gray-200 hover:text-blue-300 transition-colors'
            }`}
            title={finalized ? undefined : 'Click to change'}
          >
            <span className="truncate">{athlete.lastName}, {athlete.firstName}</span>
            {!isFloating && !finalized && (
              <svg className="w-3 h-3 shrink-0 text-gray-600 group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
              </svg>
            )}
          </button>
        ) : !finalized ? (
          <button
            onClick={!isFloating ? onOpenPicker : undefined}
            className="text-sm text-gray-600 hover:text-blue-400 transition-colors flex items-center gap-1.5"
            title="Assign athlete"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
            <span>Add athlete</span>
          </button>
        ) : (
          <span className="text-sm text-gray-700 italic">Empty</span>
        )}
      </div>

      {/* Bib */}
      <div className="w-12 shrink-0 text-right font-mono text-xs text-gray-600">
        {athlete?.bib ? `#${athlete.bib}` : ''}
      </div>
    </div>
  );

  if (isFloating) {
    return (
      <div
        className="fixed left-0 right-0 z-50 pointer-events-none px-4"
        style={{ top: floatY, maxWidth: 512, margin: '0 auto' }}
      >
        <div className="bg-gray-700 border border-blue-500/50 rounded-lg shadow-2xl shadow-black/60">
          {rowContent}
        </div>
      </div>
    );
  }

  return (
    <div ref={rowRef}>
      <div className={`rounded-lg border transition-colors
        ${isBeingDragged ? 'opacity-0' : ''}
        ${isDragTarget ? 'border-blue-500/50 bg-gray-700/60' : 'border-gray-700/50 bg-gray-800/60'}
        ${isPickerOpen ? 'border-blue-500/40' : ''}
      `}>
        {rowContent}
      </div>
      {isPickerOpen && (
        <AthletePicker
          roster={roster}
          assignedIds={assignedIds}
          currentId={slot.athleteId}
          onSelect={id => { onAssign(id); onClosePicker(); }}
          onClear={() => { onClear(); onClosePicker(); }}
          onClose={onClosePicker}
        />
      )}
    </div>
  );
}

// ── Event Card ────────────────────────────────────────────────────────────────

function EventCard({
  event, roster, rosterMap, initialState, meetToken, teamToken, onSaved,
}: {
  event: RelayEvent;
  roster: Athlete[];
  rosterMap: Map<string, Athlete>;
  initialState: EventState;
  meetToken: string;
  teamToken: string;
  onSaved: (finalizedAt: string | null, legs: LegEntry[]) => void;
}) {
  const [slots, setSlots] = useState<Slot[]>(() => stateToSlots(initialState.legs));
  const [finalized, setFinalized] = useState(!!initialState.finalizedAt);
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [floatY, setFloatY] = useState(0);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowHeightRef = useRef(42);
  const isDragging = dragIdx !== null;

  // Deadline countdown
  const countdownMs = useCountdown(deadlineISO(event));
  const pastDeadline = countdownMs !== null && countdownMs <= 0;

  // Gender-filtered roster for the picker
  const filteredRoster = filterRosterForEvent(roster, event);

  // Set of currently assigned athlete IDs
  const assignedIds = new Set(slots.map(s => s.athleteId).filter((id): id is string => id !== null));

  // ── Pointer drag reorder ──
  const handlePointerDown = (e: React.PointerEvent, idx: number) => {
    if (!slots[idx].athleteId || finalized) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const row = rowRefs.current[idx];
    if (row) {
      const rect = row.getBoundingClientRect();
      rowHeightRef.current = rect.height;
      setDragOffsetY(e.clientY - rect.top);
      setFloatY(rect.top);
    }
    setDragIdx(idx);
    setOverIdx(idx);
    setPickerOpen(null);
  };

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragIdx === null) return;
    setFloatY(e.clientY - dragOffsetY);
    let closest = dragIdx, closestDist = Infinity;
    rowRefs.current.forEach((ref, i) => {
      if (!ref) return;
      const rect = ref.getBoundingClientRect();
      const dist = Math.abs(e.clientY - (rect.top + rect.height / 2));
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });
    setOverIdx(closest);
  }, [dragIdx, dragOffsetY]);

  const handlePointerUp = useCallback(() => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      setSlots(prev => {
        const next = [...prev];
        // Sort-style move: shift intermediate slots, don't swap
        const draggedId = next[dragIdx].athleteId;
        if (dragIdx < overIdx) {
          for (let i = dragIdx; i < overIdx; i++) {
            next[i] = { ...next[i], athleteId: next[i + 1].athleteId };
          }
        } else {
          for (let i = dragIdx; i > overIdx; i--) {
            next[i] = { ...next[i], athleteId: next[i - 1].athleteId };
          }
        }
        next[overIdx] = { ...next[overIdx], athleteId: draggedId };
        return next;
      });
      setDirty(true);
      setSaveStatus('idle');
    }
    setDragIdx(null);
    setOverIdx(null);
  }, [dragIdx, overIdx]);

  const getRowTranslate = (idx: number): number => {
    if (dragIdx === null || overIdx === null || idx === dragIdx) return 0;
    const rh = rowHeightRef.current;
    if (dragIdx < overIdx && idx > dragIdx && idx <= overIdx) return -rh;
    if (dragIdx > overIdx && idx >= overIdx && idx < dragIdx) return rh;
    return 0;
  };

  // ── Assign / clear ──
  const handleAssign = (position: number, athleteId: string) => {
    setSlots(prev => prev.map(s => {
      if (s.athleteId === athleteId && s.position !== position) return { ...s, athleteId: null };
      if (s.position === position) return { ...s, athleteId };
      return s;
    }));
    setDirty(true);
    setSaveStatus('idle');
  };

  const handleClear = (position: number) => {
    setSlots(prev => prev.map(s => s.position === position ? { ...s, athleteId: null } : s));
    setDirty(true);
    setSaveStatus('idle');
  };

  // ── Submit ──
  const submit = useCallback(async (finalize: boolean) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const legs = slotsToPayload(slots, rosterMap);
      const res = await fetch(`/api/relay/${meetToken}/${teamToken}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, eventName: event.name, legs, finalized: finalize }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Error ${res.status}`);
      }
      setDirty(false);
      setSaveStatus('saved');
      if (finalize) setFinalized(true);
      onSaved(finalize ? new Date().toISOString() : null, legs);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }, [slots, rosterMap, meetToken, teamToken, event, onSaved]);

  const runnerSlots = slots.slice(0, 4);
  const altSlots = slots.slice(4);
  const filledRunners = runnerSlots.filter(s => s.athleteId).length;

  return (
    <div
      className={`rounded-xl border overflow-visible ${finalized ? 'border-emerald-700/40' : 'border-gray-700'}`}
      style={isDragging ? { userSelect: 'none' } : undefined}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Header */}
      <div className={`px-4 py-3 border-b ${finalized ? 'bg-emerald-900/10 border-emerald-700/30' : 'bg-gray-800 border-gray-700'}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-gray-500 mt-0.5">
              {filledRunners}/4 runners filled
              {dirty && <span className="ml-2 text-amber-400">● unsaved changes</span>}
              {!dirty && saveStatus === 'saved' && !finalized && <span className="ml-2 text-emerald-400">✓ saved</span>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {finalized && (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-900/30 border border-emerald-600/30 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
                FINALIZED
              </span>
            )}
            {deadlineISO(event) && countdownMs !== null && (
              <span className={`text-[11px] ${pastDeadline ? 'text-red-400' : countdownMs < 10 * 60_000 ? 'text-amber-400' : 'text-gray-500'}`}>
                ⏱ {fmtCountdown(countdownMs)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Slot lists */}
      <div className="px-3 py-3 space-y-4 bg-gray-900">
        {/* Runners */}
        <div>
          <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider px-1 mb-1.5">Runners</p>
          <div className="space-y-1">
            {runnerSlots.map((slot, i) => (
              <LegRow
                key={slot.position}
                slot={slot}
                athlete={slot.athleteId ? (rosterMap.get(slot.athleteId) ?? null) : null}
                isAlt={false}
                isPickerOpen={pickerOpen === slot.position}
                isBeingDragged={dragIdx === i}
                isDragTarget={overIdx === i && dragIdx !== null && dragIdx !== i}
                isFloating={false}
                floatY={0}
                rowTranslate={getRowTranslate(i)}
                finalized={finalized}
                rosterMap={rosterMap}
                assignedIds={assignedIds}
                roster={filteredRoster}
                onOpenPicker={() => setPickerOpen(slot.position)}
                onClosePicker={() => setPickerOpen(null)}
                onAssign={id => handleAssign(slot.position, id)}
                onClear={() => handleClear(slot.position)}
                onPointerDown={e => handlePointerDown(e, i)}
                rowRef={el => { rowRefs.current[i] = el; }}
              />
            ))}
          </div>
        </div>

        {/* Alternates */}
        <div>
          <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider px-1 mb-1.5">Alternates</p>
          <div className="space-y-1">
            {altSlots.map((slot, i) => {
              const globalIdx = i + 4;
              return (
                <LegRow
                  key={slot.position}
                  slot={slot}
                  athlete={slot.athleteId ? (rosterMap.get(slot.athleteId) ?? null) : null}
                  isAlt={true}
                  isPickerOpen={pickerOpen === slot.position}
                  isBeingDragged={dragIdx === globalIdx}
                  isDragTarget={overIdx === globalIdx && dragIdx !== null && dragIdx !== globalIdx}
                  isFloating={false}
                  floatY={0}
                  rowTranslate={getRowTranslate(globalIdx)}
                  finalized={finalized}
                  rosterMap={rosterMap}
                  assignedIds={assignedIds}
                  roster={filteredRoster}
                  onOpenPicker={() => setPickerOpen(slot.position)}
                  onClosePicker={() => setPickerOpen(null)}
                  onAssign={id => handleAssign(slot.position, id)}
                  onClear={() => handleClear(slot.position)}
                  onPointerDown={e => handlePointerDown(e, globalIdx)}
                  rowRef={el => { rowRefs.current[globalIdx] = el; }}
                />
              );
            })}
          </div>
        </div>

        {/* Error */}
        {saveStatus === 'error' && errorMsg && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{errorMsg}</p>
        )}

        {/* Actions */}
        {!finalized ? (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => submit(false)}
              disabled={saving || (!dirty && saveStatus === 'saved')}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold border border-gray-600 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              onClick={() => {
                if (window.confirm(
                  `Finalize your ${event.name} lineup?\n\nThis locks your entry. Contact the meet director to make any changes after finalizing.`
                )) submit(true);
              }}
              disabled={saving || filledRunners === 0}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              Finalize & Lock ✓
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-2 px-3 bg-emerald-900/20 border border-emerald-600/20 rounded-lg">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
            </svg>
            <p className="text-xs text-emerald-300">Entry finalized — contact your meet director to make changes.</p>
          </div>
        )}
      </div>

      {/* Floating drag ghost */}
      {isDragging && dragIdx !== null && (
        <LegRow
          slot={slots[dragIdx]}
          athlete={slots[dragIdx].athleteId ? (rosterMap.get(slots[dragIdx].athleteId!) ?? null) : null}
          isAlt={slots[dragIdx].position > 4}
          isPickerOpen={false}
          isBeingDragged={false}
          isDragTarget={false}
          isFloating={true}
          floatY={floatY}
          rowTranslate={0}
          finalized={false}
          rosterMap={rosterMap}
          assignedIds={assignedIds}
          roster={filteredRoster}
          onOpenPicker={() => {}}
          onClosePicker={() => {}}
          onAssign={() => {}}
          onClear={() => {}}
          onPointerDown={() => {}}
          rowRef={() => {}}
        />
      )}
    </div>
  );
}

// ── Event Summary Card (list view) ────────────────────────────────────────────

function EventSummaryCard({
  event,
  status,
  now,
  onClick,
}: {
  event: RelayEvent;
  status: EntryStatus | undefined;
  now: number;
  onClick: () => void;
}) {
  const iso = deadlineISO(event);
  const msLeft = iso ? new Date(iso).getTime() - now : null;
  const pastDeadline = msLeft !== null && msLeft <= 0;

  const isFinalized = !!status?.finalizedAt;
  const isSaved = !!status?.saved && !isFinalized;

  const statusLabel = isFinalized ? 'Finalized' : isSaved ? 'Draft saved' : 'Not started';
  const statusCls = isFinalized
    ? 'text-emerald-400 bg-emerald-900/20 border-emerald-700/30'
    : isSaved
    ? 'text-blue-400 bg-blue-900/20 border-blue-700/30'
    : 'text-gray-500 bg-gray-800/40 border-gray-700/30';

  const genderLabel: Record<string, string> = { M: 'Men', F: 'Women', W: 'Women', X: 'Mixed', B: 'Mixed' };

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-900 border border-gray-700 rounded-xl px-4 py-3.5 hover:border-gray-500 hover:bg-gray-800/60 active:bg-gray-800 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-gray-100 truncate">{event.name}</span>
            {event.gender && (
              <span className="text-[10px] font-bold text-gray-600 uppercase shrink-0">
                {genderLabel[event.gender] ?? event.gender}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusCls}`}>
              {isFinalized && (
                <svg className="w-2.5 h-2.5 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
              )}
              {statusLabel}
            </span>
            {msLeft !== null && !pastDeadline && !isFinalized && (
              <span className={`text-[11px] ${msLeft < 10 * 60_000 ? 'text-amber-400' : 'text-gray-600'}`}>
                ⏱ {fmtCountdown(msLeft)}
              </span>
            )}
            {pastDeadline && !isFinalized && (
              <span className="text-[11px] text-red-400">⏱ Deadline passed</span>
            )}
          </div>
        </div>
        <svg className="w-5 h-5 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
        </svg>
      </div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CoachRelayPage() {
  const params = useParams();
  const meetToken = params.meetToken as string;
  const teamToken = params.teamToken as string;

  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [entryStatuses, setEntryStatuses] = useState<Record<string, EntryStatus>>({});

  // Single clock tick for list-view countdown timers (avoids N separate intervals)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch session data
  useEffect(() => {
    fetch(`/api/relay/${meetToken}/${teamToken}`)
      .then(r => r.ok ? r.json() : r.json().then((d: { error?: string }) => Promise.reject(new Error(d.error ?? 'Failed to load'))))
      .then((data: SessionData) => {
        setSession(data);
        // Initialise status from any existing entries (incl. pre-populated ones from publish)
        const statuses: Record<string, EntryStatus> = {};
        for (const [eventId, entry] of Object.entries(data.existingEntries)) {
          statuses[eventId] = { saved: true, finalizedAt: entry.finalizedAt };
        }
        setEntryStatuses(statuses);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [meetToken, teamToken]);

  // Called by EventCard after each save/finalize
  const handleSaved = useCallback((eventId: string, finalizedAt: string | null, legs: LegEntry[]) => {
    setEntryStatuses(prev => ({ ...prev, [eventId]: { saved: true, finalizedAt } }));
    // Keep session.existingEntries fresh so re-entering the event shows current state
    setSession(prev => !prev ? null : {
      ...prev,
      existingEntries: {
        ...prev.existingEntries,
        [eventId]: { legs, finalizedAt },
      },
    });
    if (finalizedAt) {
      // Navigate back to event list after finalize (a brief moment to see the badge)
      setTimeout(() => setSelectedEventId(null), 400);
    }
  }, []);

  // ── Loading / error states ──

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <div className="text-center">
        <svg className="animate-spin w-7 h-7 text-gray-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <p className="text-sm text-gray-500">Loading relay entry…</p>
      </div>
    </div>
  );

  if (error || !session) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950 p-6">
      <div className="text-center max-w-sm">
        <p className="text-3xl mb-3">⛔</p>
        <p className="text-gray-200 font-semibold mb-1">Unable to load</p>
        <p className="text-sm text-gray-500">{error ?? 'Unknown error'}</p>
      </div>
    </div>
  );

  const rosterMap = new Map(session.roster.map(a => [a.id, a]));
  const selectedEvent = selectedEventId ? session.events.find(e => e.id === selectedEventId) : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* ── Sticky header ── */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          {selectedEvent ? (
            /* Event detail header */
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedEventId(null)}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-100 shrink-0"
                aria-label="Back to event list"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                </svg>
              </button>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 truncate">{session.teamName}</p>
                <h1 className="text-lg font-bold text-white truncate">{selectedEvent.name}</h1>
              </div>
            </div>
          ) : (
            /* Event list header */
            <>
              <p className="text-xs text-gray-500">
                {session.meetName}{session.meetDate ? ` · ${session.meetDate}` : ''}
              </p>
              <h1 className="text-xl font-bold text-white">{session.teamName}</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                {session.events.length} relay event{session.events.length !== 1 ? 's' : ''} · tap to enter your lineup
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-lg mx-auto px-4 py-5">
        {selectedEvent ? (
          /* Event editor */
          <EventCard
            key={selectedEvent.id}
            event={selectedEvent}
            roster={session.roster}
            rosterMap={rosterMap}
            initialState={session.existingEntries[selectedEvent.id] ?? { legs: [], finalizedAt: null }}
            meetToken={meetToken}
            teamToken={teamToken}
            onSaved={(finalizedAt, legs) => handleSaved(selectedEvent.id, finalizedAt, legs)}
          />
        ) : (
          /* Event list */
          <div className="space-y-3">
            {session.events.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-16">No relay events found.</p>
            ) : (
              session.events.map(event => (
                <EventSummaryCard
                  key={event.id}
                  event={event}
                  status={entryStatuses[event.id]}
                  now={now}
                  onClick={() => setSelectedEventId(event.id)}
                />
              ))
            )}
          </div>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 pb-10 text-center">
        <p className="text-xs text-gray-800">Powered by PrimeTime Nexus</p>
      </div>
    </div>
  );
}

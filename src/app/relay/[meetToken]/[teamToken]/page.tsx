'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Athlete {
  id: string;
  firstName: string;
  lastName: string;
  bib?: string;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function athleteLabel(a: Athlete, showBib = true): string {
  const bib = showBib && a.bib ? `#${a.bib} ` : '';
  return `${bib}${a.lastName}, ${a.firstName}`;
}

// slots[0] = leg1, …, slots[7] = alt4
function stateToSlots(legs: LegEntry[]): (string | null)[] {
  const s: (string | null)[] = Array(8).fill(null);
  for (const l of legs) {
    if (l.leg >= 1 && l.leg <= 8) s[l.leg - 1] = l.athleteId;
  }
  return s;
}

function slotsToLegs(slots: (string | null)[], rosterMap: Map<string, Athlete>): LegEntry[] {
  return slots
    .map((id, i) => {
      if (!id) return null;
      const a = rosterMap.get(id);
      if (!a) return null;
      return { leg: i + 1, athleteId: id, firstName: a.firstName, lastName: a.lastName };
    })
    .filter((x): x is LegEntry => x !== null);
}

// ── Countdown hook ────────────────────────────────────────────────────────────

function useCountdown(deadlineISO: string | null): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (!deadlineISO) return;
    const dead = new Date(deadlineISO).getTime();
    const tick = () => setMs(dead - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineISO]);
  return ms;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'DEADLINE PASSED';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m until deadline`;
  if (m > 0) return `${m}m ${s}s until deadline`;
  return `${s}s until deadline`;
}

// ── Slot Row ──────────────────────────────────────────────────────────────────

function SlotRow({
  position,     // 1-8
  athlete,
  selected,
  finalized,
  onSelect,
  onClear,
  onMove,
  canMoveUp,
  canMoveDown,
  onDragOver,
  onDrop,
}: {
  position: number;
  athlete: Athlete | null;
  selected: boolean;
  finalized: boolean;
  onSelect: () => void;
  onClear: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const isAlt = position > 4;
  const label = isAlt ? `Alt ${position - 4}` : `Leg ${position}`;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all
        ${selected
          ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
          : athlete
            ? 'border-gray-600 bg-gray-800 cursor-pointer hover:border-gray-500'
            : 'border-dashed border-gray-700 bg-gray-800/50 cursor-pointer hover:border-gray-500'
        }
      `}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={!finalized ? onSelect : undefined}
    >
      {/* Position label */}
      <span className={`text-xs font-bold w-10 shrink-0 ${isAlt ? 'text-amber-400' : 'text-blue-400'}`}>
        {label}
      </span>

      {/* Athlete name */}
      <div className="flex-1 min-w-0">
        {athlete ? (
          <span className="text-sm text-gray-100 font-medium truncate block">
            {athlete.bib && <span className="text-gray-400 text-xs mr-1">#{athlete.bib}</span>}
            {athlete.lastName}, {athlete.firstName}
          </span>
        ) : (
          <span className="text-sm text-gray-600 italic">
            {selected ? '← tap roster' : 'tap to fill'}
          </span>
        )}
      </div>

      {/* Controls (hidden when finalized) */}
      {!finalized && athlete && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onMove(-1); }}
            disabled={!canMoveUp}
            className="p-1 text-gray-500 hover:text-gray-200 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move up"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMove(1); }}
            disabled={!canMoveDown}
            className="p-1 text-gray-500 hover:text-gray-200 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move down"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="p-1 text-gray-600 hover:text-red-400 transition-colors"
            title="Remove"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Athlete Chip (roster) ─────────────────────────────────────────────────────

function AthleteChip({
  athlete,
  selected,
  inSlot,
  finalized,
  onSelect,
}: {
  athlete: Athlete;
  selected: boolean;
  inSlot: number | null;  // null = available
  finalized: boolean;
  onSelect: () => void;
}) {
  const dragRef = useRef<string>(athlete.id);

  return (
    <button
      draggable={!finalized}
      onDragStart={(e) => {
        e.dataTransfer.setData('athleteId', dragRef.current);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={!finalized ? onSelect : undefined}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-all
        ${selected
          ? 'border-blue-500 bg-blue-600/20 ring-1 ring-blue-500 text-blue-200'
          : inSlot !== null
            ? 'border-gray-600 bg-gray-700/50 text-gray-400 cursor-pointer hover:border-gray-500'
            : 'border-gray-600 bg-gray-700 text-gray-100 cursor-grab hover:border-gray-400 hover:bg-gray-600'
        }
        ${finalized ? 'cursor-default' : ''}
      `}
    >
      {athlete.bib && (
        <span className="text-xs text-gray-400 font-mono">{`#${athlete.bib}`}</span>
      )}
      <span className="font-medium">{athlete.lastName}, {athlete.firstName}</span>
      {inSlot !== null && (
        <span className={`text-[10px] font-bold ml-1 ${inSlot > 4 ? 'text-amber-400' : 'text-blue-400'}`}>
          {inSlot > 4 ? `A${inSlot - 4}` : `L${inSlot}`}
        </span>
      )}
    </button>
  );
}

// ── Event Card ────────────────────────────────────────────────────────────────

function EventCard({
  event,
  roster,
  rosterMap,
  initialState,
  meetToken,
  teamToken,
}: {
  event: RelayEvent;
  roster: Athlete[];
  rosterMap: Map<string, Athlete>;
  initialState: EventState;
  meetToken: string;
  teamToken: string;
}) {
  // 8 slots: indexes 0–3 = legs 1–4, indexes 4–7 = alternates 1–4
  const [slots, setSlots] = useState<(string | null)[]>(() =>
    stateToSlots(initialState.legs)
  );
  const [finalized, setFinalized] = useState(!!initialState.finalizedAt);
  const [selectedId, setSelectedId] = useState<string | null>(null); // tap-to-assign
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Deadline countdown
  const deadlineISO = event.scheduledTime
    ? new Date(new Date(event.scheduledTime).getTime() - (event.deadlineMinutes ?? 30) * 60_000).toISOString()
    : null;
  const countdownMs = useCountdown(deadlineISO);
  const pastDeadline = countdownMs !== null && countdownMs <= 0;

  // Which slot each athlete is in (null = unassigned)
  const slotOf = useCallback((athleteId: string): number | null => {
    const i = slots.indexOf(athleteId);
    return i === -1 ? null : i + 1; // 1-based position
  }, [slots]);

  // ── slot interactions ──
  const handleSlotClick = (slotIndex: number) => {
    if (finalized) return;
    const currentAthlete = slots[slotIndex];

    if (selectedId) {
      // Place or swap
      setSlots(prev => {
        const next = [...prev];
        const selectedSlotIndex = next.indexOf(selectedId);
        if (selectedSlotIndex !== -1) {
          // Moving from one slot to another — swap
          next[selectedSlotIndex] = currentAthlete;
        }
        next[slotIndex] = selectedId;
        return next;
      });
      setSelectedId(null);
      setDirty(true);
      setStatus('idle');
    } else if (currentAthlete) {
      // Select the athlete already in this slot to move them
      setSelectedId(currentAthlete);
    }
    // else: empty slot with no selection — do nothing (wait for roster tap)
  };

  const handleAthleteClick = (athleteId: string) => {
    if (finalized) return;
    if (selectedId === athleteId) {
      setSelectedId(null);
      return;
    }
    // If an empty slot is "selected" (shown by selectedId being null but a slot is highlighted)
    // we just select the athlete
    setSelectedId(athleteId);
  };

  const handleClearSlot = (slotIndex: number) => {
    setSlots(prev => { const n = [...prev]; n[slotIndex] = null; return n; });
    setDirty(true);
    setStatus('idle');
  };

  const handleMove = (slotIndex: number, dir: -1 | 1) => {
    const target = slotIndex + dir;
    if (target < 0 || target > 7) return;
    setSlots(prev => {
      const n = [...prev];
      [n[slotIndex], n[target]] = [n[target], n[slotIndex]];
      return n;
    });
    setDirty(true);
    setStatus('idle');
  };

  // ── drag & drop ──
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (slotIndex: number, e: React.DragEvent) => {
    e.preventDefault();
    const athleteId = e.dataTransfer.getData('athleteId');
    if (!athleteId || finalized) return;
    setSlots(prev => {
      const next = [...prev];
      const fromIndex = next.indexOf(athleteId);
      const displaced = next[slotIndex];
      if (fromIndex !== -1) next[fromIndex] = displaced;
      next[slotIndex] = athleteId;
      return next;
    });
    setSelectedId(null);
    setDirty(true);
    setStatus('idle');
  };

  // ── save / finalize ──
  const submit = useCallback(async (finalize: boolean) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const legs = slotsToLegs(slots, rosterMap);
      const res = await fetch(`/api/relay/${meetToken}/${teamToken}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          eventName: event.name,
          legs,
          finalized,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Server error (${res.status})`);
      }
      setDirty(false);
      setStatus('saved');
      if (finalize) setFinalized(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }, [slots, rosterMap, meetToken, teamToken, event]);

  const filledRunners = slots.slice(0, 4).filter(Boolean).length;
  const filledAlts    = slots.slice(4).filter(Boolean).length;

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${
      finalized ? 'border-emerald-600/40 bg-gray-900' : 'border-gray-700 bg-gray-900'
    }`}>

      {/* ── Header ── */}
      <div className={`px-4 py-3 border-b ${finalized ? 'border-emerald-600/30 bg-emerald-900/10' : 'border-gray-800 bg-gray-800'}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-gray-100 text-base leading-tight">{event.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {filledRunners}/4 runners · {filledAlts}/4 alternates
              {dirty && <span className="ml-2 text-amber-400">● unsaved</span>}
              {!dirty && status === 'saved' && !finalized && (
                <span className="ml-2 text-emerald-400">✓ saved</span>
              )}
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
            {deadlineISO && countdownMs !== null && (
              <span className={`text-[11px] font-medium ${
                pastDeadline ? 'text-red-400' :
                countdownMs < 10 * 60_000 ? 'text-amber-400' : 'text-gray-500'
              }`}>
                ⏱ {formatCountdown(countdownMs)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Slots ── */}
      <div className="px-4 py-3 space-y-4">
        {/* Runners 1-4 */}
        <div>
          <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2">Runners</p>
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map(i => {
              const athleteId = slots[i];
              const athlete = athleteId ? rosterMap.get(athleteId) ?? null : null;
              return (
                <SlotRow
                  key={i}
                  position={i + 1}
                  athlete={athlete}
                  selected={selectedId !== null && slots[i] === selectedId}
                  finalized={finalized}
                  onSelect={() => handleSlotClick(i)}
                  onClear={() => handleClearSlot(i)}
                  onMove={dir => handleMove(i, dir)}
                  canMoveUp={i > 0}
                  canMoveDown={i < 3}
                  onDragOver={handleDragOver}
                  onDrop={e => handleDrop(i, e)}
                />
              );
            })}
          </div>
        </div>

        {/* Alternates 5-8 */}
        <div>
          <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2">Alternates</p>
          <div className="space-y-1.5">
            {[4, 5, 6, 7].map(i => {
              const athleteId = slots[i];
              const athlete = athleteId ? rosterMap.get(athleteId) ?? null : null;
              return (
                <SlotRow
                  key={i}
                  position={i + 1}
                  athlete={athlete}
                  selected={selectedId !== null && slots[i] === selectedId}
                  finalized={finalized}
                  onSelect={() => handleSlotClick(i)}
                  onClear={() => handleClearSlot(i)}
                  onMove={dir => handleMove(i, dir)}
                  canMoveUp={i > 4}
                  canMoveDown={i < 7}
                  onDragOver={handleDragOver}
                  onDrop={e => handleDrop(i, e)}
                />
              );
            })}
          </div>
        </div>

        {/* ── Roster ── */}
        {!finalized && (
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
              Roster — {selectedId ? 'tap a slot above to assign' : 'tap or drag to assign'}
            </p>
            <div className="flex flex-wrap gap-2">
              {roster.map(a => (
                <AthleteChip
                  key={a.id}
                  athlete={a}
                  selected={selectedId === a.id}
                  inSlot={slotOf(a.id)}
                  finalized={finalized}
                  onSelect={() => {
                    if (selectedId === a.id) {
                      setSelectedId(null);
                    } else if (selectedId && selectedId !== a.id) {
                      // Swap selectedId into this athlete's current slot
                      const targetSlot = slotOf(a.id);
                      const fromSlot = slotOf(selectedId);
                      setSlots(prev => {
                        const next = [...prev];
                        if (fromSlot !== null) next[fromSlot - 1] = a.id;
                        if (targetSlot !== null) next[targetSlot - 1] = selectedId;
                        return next;
                      });
                      setSelectedId(null);
                      setDirty(true);
                      setStatus('idle');
                    } else {
                      setSelectedId(a.id);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && errorMsg && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{errorMsg}</p>
        )}

        {/* Actions */}
        {!finalized && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => submit(false)}
              disabled={saving || (!dirty && status === 'saved')}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold border border-gray-600 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 transition-colors"
            >
              {saving && !finalized ? (
                <span className="flex items-center justify-center gap-1.5">
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Saving…
                </span>
              ) : 'Save Draft'}
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Finalize your ${event.name} entry?\n\nThis locks your lineup. Contact your meet director if you need to make changes after finalizing.`)) {
                  submit(true);
                }
              }}
              disabled={saving || filledRunners === 0}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {saving ? '…' : 'Finalize & Lock ✓'}
            </button>
          </div>
        )}

        {finalized && (
          <div className="flex items-center gap-2 py-2 px-3 bg-emerald-900/20 border border-emerald-600/20 rounded-lg">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
            </svg>
            <p className="text-xs text-emerald-300">
              Entry finalized. Contact your meet director if you need to make changes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Coach Page ────────────────────────────────────────────────────────────────

export default function CoachRelayPage() {
  const params = useParams();
  const meetToken = params.meetToken as string;
  const teamToken = params.teamToken as string;

  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/relay/${meetToken}/${teamToken}`);
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(d.error ?? 'Failed to load');
        }
        setSession(await res.json() as SessionData);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [meetToken, teamToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-center">
          <svg className="animate-spin w-8 h-8 text-gray-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <p className="text-gray-500 text-sm">Loading relay entry…</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950 p-6">
        <div className="text-center max-w-sm">
          <p className="text-3xl mb-3">⛔</p>
          <p className="text-gray-200 font-semibold mb-1">Unable to load</p>
          <p className="text-sm text-gray-500">{error ?? 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  const rosterMap = new Map(session.roster.map(a => [a.id, a]));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <p className="text-xs text-gray-500">
            {session.meetName}{session.meetDate ? ` · ${session.meetDate}` : ''}
          </p>
          <h1 className="text-xl font-bold text-white mt-0.5">{session.teamName}</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Relay Entry — tap athletes then tap leg slots to assign, or drag
          </p>
        </div>
      </div>

      {/* Events */}
      <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
        {session.events.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-16">
            No relay events found for this meet.
          </p>
        ) : (
          session.events.map(event => (
            <EventCard
              key={event.id}
              event={event}
              roster={session.roster}
              rosterMap={rosterMap}
              initialState={session.existingEntries[event.id] ?? { legs: [], finalizedAt: null }}
              meetToken={meetToken}
              teamToken={teamToken}
            />
          ))
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 pb-10 text-center">
        <p className="text-xs text-gray-700">Powered by PrimeTime Nexus</p>
      </div>
    </div>
  );
}

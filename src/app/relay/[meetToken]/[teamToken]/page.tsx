'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

// ── Types ────────────────────────────────────────────────────────────────────

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
}

interface LegEntry {
  leg: number;
  athleteId: string;
  firstName: string;
  lastName: string;
}

interface SessionData {
  meetName: string;
  meetDate?: string;
  teamName: string;
  events: RelayEvent[];
  roster: Athlete[];
  existingEntries: Record<string, LegEntry[]>;
}

// ── Leg Picker ───────────────────────────────────────────────────────────────

function LegPicker({
  leg,
  roster,
  value,
  onChange,
}: {
  leg: number;
  roster: Athlete[];
  value: string;
  onChange: (athleteId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-700 last:border-0">
      <span className="text-xs font-bold text-gray-400 w-12 shrink-0">Leg {leg}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      >
        <option value="">— Select athlete —</option>
        {roster.map((a) => (
          <option key={a.id} value={a.id}>
            {a.bib ? `#${a.bib} ` : ''}{a.lastName}, {a.firstName}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Event Card ───────────────────────────────────────────────────────────────

function EventCard({
  event,
  roster,
  initialLegs,
  meetToken,
  teamToken,
}: {
  event: RelayEvent;
  roster: Athlete[];
  initialLegs: LegEntry[];
  meetToken: string;
  teamToken: string;
}) {
  const legCount = event.legs ?? 4;
  const [open, setOpen] = useState(false);
  const [legs, setLegs] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    for (let i = 1; i <= legCount; i++) {
      const existing = initialLegs.find((l) => l.leg === i);
      map[i] = existing?.athleteId ?? '';
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasEntry = initialLegs.length > 0;

  const handleLegChange = (leg: number, athleteId: string) => {
    setLegs((prev) => ({ ...prev, [leg]: athleteId }));
    setSaved(false);
  };

  const handleSubmit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const athleteMap = new Map(roster.map((a) => [a.id, a]));
      const payload = Object.entries(legs)
        .filter(([, athleteId]) => athleteId)
        .map(([legStr, athleteId]) => {
          const a = athleteMap.get(athleteId);
          return {
            leg: Number(legStr),
            athleteId,
            firstName: a?.firstName ?? '',
            lastName: a?.lastName ?? '',
          };
        })
        .sort((a, b) => a.leg - b.leg);

      const res = await fetch(`/api/relay/${meetToken}/${teamToken}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, eventName: event.name, legs: payload }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Submit failed');
      }
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [legs, roster, meetToken, teamToken, event]);

  const filledCount = Object.values(legs).filter(Boolean).length;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <p className="font-semibold text-gray-100 text-sm">{event.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {filledCount}/{legCount} legs filled
            {hasEntry && !saved && (
              <span className="ml-2 text-amber-400">• previously submitted</span>
            )}
            {saved && <span className="ml-2 text-emerald-400">• saved ✓</span>}
          </p>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {open && (
        <div className="px-4 pb-4 border-t border-gray-700">
          <div className="mt-3">
            {Array.from({ length: legCount }, (_, i) => i + 1).map((leg) => (
              <LegPicker
                key={leg}
                leg={leg}
                roster={roster}
                value={legs[leg] ?? ''}
                onChange={(id) => handleLegChange(leg, id)}
              />
            ))}
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving || filledCount === 0}
            className="mt-4 w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Submit Entry'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Coach Page ───────────────────────────────────────────────────────────────

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
          const data = await res.json();
          throw new Error(data.error ?? 'Failed to load');
        }
        setSession(await res.json());
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [meetToken, teamToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 p-6">
        <div className="text-center max-w-sm">
          <p className="text-2xl mb-2">❌</p>
          <p className="text-gray-300 font-medium mb-1">Unable to load relay entries</p>
          <p className="text-sm text-gray-500">{error ?? 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-4">
        <div className="max-w-lg mx-auto">
          <p className="text-xs text-gray-500 mb-0.5">{session.meetName}{session.meetDate ? ` · ${session.meetDate}` : ''}</p>
          <h1 className="text-lg font-bold text-white">{session.teamName}</h1>
          <p className="text-xs text-gray-400 mt-0.5">Relay Entry — tap an event to pick athletes</p>
        </div>
      </div>

      {/* Events */}
      <div className="max-w-lg mx-auto px-4 py-5 space-y-3">
        {session.events.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-12">No relay events found for this meet.</p>
        ) : (
          session.events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              roster={session.roster}
              initialLegs={session.existingEntries[event.id] ?? []}
              meetToken={meetToken}
              teamToken={teamToken}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="max-w-lg mx-auto px-4 pb-8 text-center">
        <p className="text-xs text-gray-600">Powered by PTT Nexus</p>
      </div>
    </div>
  );
}

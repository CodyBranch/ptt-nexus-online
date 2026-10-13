'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';

/**
 * The sign-up form, built for a phone: find your school, then who you are.
 * Checked as it is typed and again by the server, which has the last word.
 */

interface Props {
  token: string;
  meetName: string;
  meetDate: string | null;
  consent: string;
  schools: School[];
  roles: string[];
  initialTeam: string | null;
}

interface School { id: string; name: string; logoUrl: string | null; logoDarkUrl: string | null; primaryColor: string | null }

/** The school's logo, or its initials on its color when it has none (or it will not load). */
function SchoolMark({ school, size = 36 }: { school: School; size?: number }) {
  const src = school.logoDarkUrl || school.logoUrl;
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!src || failed) {
    const initials = school.name.replace(/^(The|University of)\s+/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const bg = school.primaryColor && /^#?[0-9a-f]{6}$/i.test(school.primaryColor) ? (school.primaryColor.startsWith('#') ? school.primaryColor : `#${school.primaryColor}`) : null;
    return (
      <span style={{ ...box, background: bg ?? undefined }}
        className={`inline-flex shrink-0 items-center justify-center rounded-md text-xs font-bold ${bg ? 'text-white' : 'bg-gray-800 text-gray-400'}`}>
        {initials}
      </span>
    );
  }
  return (
    <span style={box} className={`inline-flex shrink-0 items-center justify-center rounded-md overflow-hidden p-1 ${school.logoDarkUrl ? 'bg-gray-800' : 'bg-white'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logos come from storage and school sites */}
      <img src={src} alt="" loading="lazy" className="max-w-full max-h-full object-contain" onError={() => setFailed(true)} />
    </span>
  );
}

/** As the server reads it: ten US digits however typed, or + and a country code. */
function phoneOk(raw: string): boolean {
  const s = raw.trim();
  const d = s.replace(/\D/g, '');
  if (s.startsWith('+')) return d.length >= 8 && d.length <= 15;
  return (d.length === 10 && /^[2-9]\d{2}[2-9]/.test(d)) || (d.length === 11 && /^1[2-9]\d{2}[2-9]/.test(d));
}
const emailOk = (raw: string): boolean => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(raw.trim()) && raw.trim().length <= 254;

function pretty(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

function dateText(d: string | null): string {
  if (!d) return '';
  const t = new Date(`${d.slice(0, 10)}T12:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

const field = 'w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2.5 text-base text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500';
const bad = 'border-red-500/70';

export default function SignupView({ token, meetName, meetDate, consent, schools, roles, initialTeam }: Props) {
  const [teamId, setTeamId] = useState<string | null>(initialTeam);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState(roles[0] ?? '');
  const [otherRole, setOtherRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ confirm: string; teamName: string; phone: string } | null>(null);

  const team = schools.find((s) => s.id === teamId) ?? null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? schools.filter((s) => s.name.toLowerCase().includes(q)) : schools;
  }, [query, schools]);

  const roleValue = role === 'Other' ? otherRole.trim() : role;
  const local: Record<string, string> = {};
  if (!name.trim()) local.name = 'Your name, please.';
  if (!emailOk(email)) local.email = 'That is not an email address.';
  if (!phoneOk(phone)) local.phone = 'A mobile number: ten digits, or + and the country code.';
  if (!agreed) local.consent = 'Tick the box to agree to the texts.';
  const show = (k: string) => (touched[k] ? problems[k] ?? local[k] : problems[k]);

  const submit = async () => {
    setTouched({ name: true, email: true, phone: true, consent: true });
    if (!team || Object.keys(local).length) return;
    setBusy(true); setError(null); setProblems({});
    try {
      const res = await fetch(`/api/declare/coaches/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, name, role: roleValue, email, phone, consent: agreed }),
      });
      const json = await res.json().catch(() => ({})) as { saved?: boolean; confirm?: string; teamName?: string; phone?: string; error?: string; problems?: Record<string, string> };
      if (res.ok && json.saved) {
        // The school's declaration form stops offering the sign-up on this phone.
        try { localStorage.setItem(`coachTexts:/declare/coaches/${token}?team=${team.id}`, 'signed'); } catch { /* the form offers it again */ }
        setDone({ confirm: json.confirm ?? 'sent', teamName: json.teamName ?? team.name, phone: json.phone ?? phone });
        return;
      }
      setProblems(json.problems ?? {});
      setError(json.error ?? 'Could not save that. Try again.');
    } catch {
      setError('No connection. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <p className="text-xs text-gray-500 truncate">{meetName}{meetDate ? ` · ${dateText(meetDate)}` : ''}</p>
            <Image src="/PRIMETIME.png" alt="PrimeTime Timing" width={1586} height={250} priority className="h-4 w-auto shrink-0 opacity-90" />
          </div>
          <h1 className="text-xl font-bold text-white">Coach text updates</h1>
          <p className="text-sm text-gray-400 mt-1">Get the meet&rsquo;s texts on your phone: weather, schedule changes and declaration reminders.</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
        {done ? (
          <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 space-y-2">
            <p className="text-lg font-semibold text-green-300">You&rsquo;re signed up</p>
            <p className="text-sm text-gray-200">
              Texts about {meetName} for {done.teamName} will go to {pretty(done.phone)}.
            </p>
            <p className="text-sm text-gray-400">
              {done.confirm === 'sent' && 'A text confirming it is on its way. Reply STOP to it at any time to stop the texts.'}
              {done.confirm === 'opted_out' && 'This number replied STOP to the meet number before, so no texts can reach it. Text START to that number to turn them back on.'}
              {(done.confirm === 'not_configured' || done.confirm === 'failed') && 'The confirming text could not be sent just now, but you are on the list.'}
            </p>
            <button onClick={() => { setDone(null); setName(''); setEmail(''); setPhone(''); setAgreed(false); setTouched({}); }}
              className="text-sm text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
              Sign up another coach
            </button>
          </div>
        ) : (
          <>
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-2"><span className="text-blue-400">1.</span> Choose your school</h2>
              {team ? (
                <div className="flex items-center gap-3">
                  <SchoolMark school={team} size={44} />
                  <span className="min-w-0 flex-1 text-base font-semibold text-white">{team.name}</span>
                  <button onClick={() => { setTeamId(null); setQuery(''); }} className="shrink-0 text-sm text-blue-400 hover:text-blue-300">Change</button>
                </div>
              ) : (
                <>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for your school" aria-label="Search for your school"
                    className={field} autoComplete="off" />
                  <ul className="mt-2 max-h-72 overflow-auto divide-y divide-gray-800 rounded-lg border border-gray-800">
                    {matches.map((s) => (
                      <li key={s.id}>
                        <button onClick={() => setTeamId(s.id)} className="w-full text-left px-3 py-2 flex items-center gap-3 text-base text-gray-200 hover:bg-gray-800 active:bg-gray-800">
                          <SchoolMark school={s} />
                          <span className="min-w-0 truncate">{s.name}</span>
                        </button>
                      </li>
                    ))}
                    {matches.length === 0 && <li className="px-3 py-2.5 text-sm text-gray-500">No school by that name in this meet. Ask the meet office.</li>}
                  </ul>
                  {problems.teamId && <p className="text-sm text-red-300 mt-1">{problems.teamId}</p>}
                </>
              )}
            </section>

            {!team && (
              <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-4" aria-disabled="true">
                <h2 className="text-sm font-semibold text-gray-500"><span>2.</span> Your details</h2>
                <p className="text-sm text-gray-500 mt-1">Choose your school first.</p>
              </section>
            )}
            {team && (
              <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-4">
                <h2 className="text-sm font-semibold text-gray-300 -mb-1"><span className="text-blue-400">2.</span> Your details</h2>
                <div>
                  <label className="block text-sm text-gray-300 mb-1" htmlFor="name">Name</label>
                  <input id="name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                    autoComplete="name" placeholder="First Last" className={`${field} ${show('name') ? bad : ''}`} />
                  {show('name') && <p className="text-sm text-red-300 mt-1">{show('name')}</p>}
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1" htmlFor="role">Role</label>
                  <select id="role" value={role} onChange={(e) => setRole(e.target.value)} className={field}>
                    {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                    <option value="Other">Other</option>
                  </select>
                  {role === 'Other' && (
                    <input value={otherRole} onChange={(e) => setOtherRole(e.target.value)} placeholder="Your role" aria-label="Your role" className={`${field} mt-2`} />
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1" htmlFor="phone">Mobile phone</label>
                  <input id="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                    autoComplete="tel" placeholder="(555) 123-4567" className={`${field} ${show('phone') ? bad : ''}`} />
                  {show('phone') && <p className="text-sm text-red-300 mt-1">{show('phone')}</p>}
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1" htmlFor="email">Email</label>
                  <input id="email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    autoComplete="email" placeholder="coach@school.org" className={`${field} ${show('email') ? bad : ''}`} />
                  {show('email') && <p className="text-sm text-red-300 mt-1">{show('email')}</p>}
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setTouched((t) => ({ ...t, consent: true })); }}
                    className="mt-1 h-5 w-5 shrink-0 accent-blue-500" aria-label="I agree to the texts" />
                  <span className="text-sm text-gray-300">{consent}</span>
                </label>
                {show('consent') && <p className="text-sm text-red-300 -mt-2">{show('consent')}</p>}
                {error && <p className="text-sm text-red-300">{error}</p>}
                <button onClick={() => void submit()} disabled={busy}
                  className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-3 text-base font-semibold text-white">
                  {busy ? 'Signing up…' : 'Sign up for texts'}
                </button>
              </section>
            )}
            <p className="text-xs text-gray-500">
              Your number is used only for this meet&rsquo;s texts from the timing company, and is not shared.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

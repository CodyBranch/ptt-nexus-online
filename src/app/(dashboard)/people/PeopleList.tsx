'use client';

import { useState, useTransition } from 'react';
import { addPerson, setPersonActive, setPersonRole, resetPassword } from './actions';

interface Person {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  lastSignInAt: Date | null;
  createdAt: Date | null;
}

const field = 'px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200';

function when(d: Date | null): string {
  if (!d) return 'never';
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PeopleList({ people, canManage, meId }: {
  people: Person[];
  /** Only an admin may add or revoke. An editor sees the list and no buttons. */
  canManage: boolean;
  meId: string | null;
}) {
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'editor' });
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const say = (r: { ok: true } | { ok: false; error: string }, good: string) =>
    setNote(r.ok ? { text: good } : { text: r.error, bad: true });

  const submitAdd = () => startTransition(async () => {
    const r = await addPerson(form);
    say(r, `${form.email} can sign in now`);
    if (r.ok) { setAdding(false); setForm({ email: '', name: '', password: '', role: 'editor' }); }
  });

  const submitReset = (id: string) => startTransition(async () => {
    const r = await resetPassword(id, newPassword);
    say(r, 'Password set — tell them what it is');
    if (r.ok) { setResetting(null); setNewPassword(''); }
  });

  return (
    <div>
      {note && (
        <div className={`mb-4 px-3 py-2 rounded text-sm border ${
          note.bad
            ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        }`}>{note.text}</div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
            <th className="text-left py-2">Person</th>
            <th className="text-left py-2 w-28">Can do</th>
            <th className="text-left py-2 w-28">Last signed in</th>
            <th className="text-right py-2 w-56" />
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className={`border-b border-gray-800 ${p.isActive ? '' : 'opacity-50'}`}>
              <td className="py-2.5">
                <div className="text-gray-100">
                  {p.name || p.email}
                  {p.id === meId && <span className="ml-2 text-[10px] text-gray-500">you</span>}
                  {!p.isActive && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 text-[10px]">
                      revoked
                    </span>
                  )}
                </div>
                {p.name && <div className="text-[11px] text-gray-500">{p.email}</div>}
              </td>
              <td className="py-2.5">
                {canManage && p.id !== meId ? (
                  <select
                    value={p.role} disabled={busy}
                    onChange={(e) => startTransition(async () => {
                      say(await setPersonRole(p.id, e.target.value), 'Changed');
                    })}
                    className="px-1.5 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300"
                  >
                    <option value="editor">Edit data</option>
                    <option value="admin">Everything</option>
                  </select>
                ) : (
                  <span className="text-xs text-gray-400">
                    {p.role === 'admin' ? 'Everything' : 'Edit data'}
                  </span>
                )}
              </td>
              <td className="py-2.5 text-xs text-gray-500">{when(p.lastSignInAt)}</td>
              <td className="py-2.5 text-right">
                {canManage && (
                  <div className="flex items-center gap-3 justify-end">
                    {resetting === p.id ? (
                      <>
                        <input
                          autoFocus type="password" value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="New password"
                          className={`${field} w-44 text-xs`}
                        />
                        <button onClick={() => submitReset(p.id)} disabled={busy}
                          className="text-xs text-blue-400 hover:text-blue-300">set</button>
                        <button onClick={() => setResetting(null)}
                          className="text-xs text-gray-500 hover:text-gray-300">cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setResetting(p.id); setNewPassword(''); setNote(null); }}
                          className="text-xs text-gray-500 hover:text-gray-300">
                          reset password
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => startTransition(async () => {
                            say(await setPersonActive(p.id, !p.isActive),
                              p.isActive ? `${p.email} can no longer sign in` : `${p.email} is back`);
                          })}
                          className={`text-xs ${p.isActive
                            ? 'text-gray-500 hover:text-red-400'
                            : 'text-emerald-400 hover:text-emerald-300'}`}
                        >
                          {p.isActive ? 'revoke' : 'restore'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {people.length === 0 && (
        <p className="py-6 text-sm text-gray-500">
          Nobody has an account yet. You are signed in with the server&rsquo;s
          ADMIN_PASSWORD — add yourself here and use that from now on.
        </p>
      )}

      {canManage && (
        <div className="mt-5">
          {adding ? (
            <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
                <input autoFocus value={form.email} onChange={(e) => set('email', e.target.value)}
                  placeholder="Email address" className={field} />
                <input value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder="Name" className={field} />
                <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)}
                  placeholder="Password (12+)" className={field} />
                <select value={form.role} onChange={(e) => set('role', e.target.value)} className={field}>
                  <option value="editor">Edit data</option>
                  <option value="admin">Everything, including people</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={submitAdd} disabled={busy || !form.email || !form.password}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-sm">
                  {busy ? 'Adding…' : 'Add'}
                </button>
                <button onClick={() => setAdding(false)} className="text-sm text-gray-500 hover:text-gray-300">
                  Cancel
                </button>
                <span className="text-[11px] text-gray-600 ml-2">
                  You set the password and tell them; there is no email from here.
                </span>
              </div>
            </div>
          ) : (
            <button onClick={() => { setAdding(true); setNote(null); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm">
              + Add someone
            </button>
          )}
        </div>
      )}
    </div>
  );
}

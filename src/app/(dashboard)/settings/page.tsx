'use client';

import { useState, useEffect, useCallback } from 'react';

interface ApiKey {
  id: string;
  label: string;
  key: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function SettingsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [showNewLabel, setShowNewLabel] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/keys');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { keys: ApiKey[] };
      setKeys(data.keys ?? []);
    } catch (err) {
      setError(`Failed to load keys: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  async function handleGenerate() {
    const label = newLabel.trim();
    if (!label) return;

    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { key: ApiKey };
      setKeys(prev => [...prev, data.key]);
      // Auto-reveal the new key so the user can copy it
      setVisibleKeys(prev => new Set([...prev, data.key.id]));
      setNewLabel('');
      setShowNewLabel(false);
    } catch (err) {
      setError(`Failed to generate key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/admin/keys?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setKeys(prev => prev.filter(k => k.id !== id));
    } catch (err) {
      setError(`Failed to revoke key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopy(key: ApiKey) {
    await navigator.clipboard.writeText(key.key);
    setCopiedId(key.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function toggleVisible(id: string) {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const activeKeys = keys.filter(k => k.isActive);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="max-w-2xl space-y-6">

        {/* ── API Keys ─────────────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">API Keys</h2>
            {!showNewLabel && (
              <button
                onClick={() => setShowNewLabel(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Generate Key
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Generate API keys for PTT Nexus Manager desktop instances to authenticate sync and relay operations.
          </p>

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-600/10 border border-red-500/30 rounded text-xs text-red-400">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}

          {/* New key form */}
          {showNewLabel && (
            <div className="mb-4 flex gap-2 items-center">
              <input
                type="text"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); if (e.key === 'Escape') setShowNewLabel(false); }}
                placeholder="Label (e.g. Main Office, Coach's Laptop)"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                onClick={handleGenerate}
                disabled={!newLabel.trim() || generating}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
              <button
                onClick={() => { setShowNewLabel(false); setNewLabel(''); }}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {loading ? (
            <p className="text-xs text-gray-600 py-4 text-center">Loading keys…</p>
          ) : activeKeys.length === 0 ? (
            <p className="text-xs text-gray-600 py-4 text-center">No API keys yet. Generate one to connect PTT Nexus Manager.</p>
          ) : (
            <div className="space-y-2">
              {activeKeys.map(key => {
                const visible = visibleKeys.has(key.id);
                return (
                  <div key={key.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-200">{key.label}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">
                          Created {formatDate(key.createdAt)}
                          {key.lastUsedAt && ` · Last used ${formatDate(key.lastUsedAt)}`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRevoke(key.id)}
                        disabled={revokingId === key.id}
                        className="shrink-0 px-2 py-1 text-[10px] bg-red-900/30 hover:bg-red-800/50 border border-red-700/30 text-red-400 rounded transition-colors disabled:opacity-50"
                      >
                        {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[11px] font-mono bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-400 truncate">
                        {visible ? key.key : '•'.repeat(32)}
                      </code>
                      <button
                        onClick={() => toggleVisible(key.id)}
                        className="shrink-0 p-1 text-gray-500 hover:text-gray-300 transition-colors"
                        title={visible ? 'Hide key' : 'Reveal key'}
                      >
                        {visible ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={() => handleCopy(key)}
                        className="shrink-0 p-1 text-gray-500 hover:text-gray-300 transition-colors"
                        title="Copy to clipboard"
                      >
                        {copiedId === key.id ? (
                          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.637c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Supabase Connection ───────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Supabase Connection</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Project URL</label>
              <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-500">
                {process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Configured' : 'Not configured'}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Database URL</label>
              <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-500">
                {process.env.DATABASE_URL ? 'Configured' : 'Not configured'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Event Catalog ─────────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Event Catalog</h2>
          <p className="text-sm text-gray-500 mb-4">
            The canonical event definitions used for record mapping. Seeded from the desktop app&apos;s event-catalog.json.
          </p>
          <button
            disabled
            className="px-4 py-2 bg-gray-700/50 text-white/50 text-sm rounded-lg cursor-not-allowed"
          >
            Seed Event Definitions (Coming Soon)
          </button>
        </div>

        {/* ── User Management ───────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">User Management</h2>
          <p className="text-sm text-gray-500">
            Invite users and manage roles. Requires Supabase Auth configuration.
          </p>
        </div>

      </div>
    </div>
  );
}

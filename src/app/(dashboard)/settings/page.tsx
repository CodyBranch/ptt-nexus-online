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
  const [newlyGeneratedId, setNewlyGeneratedId] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/keys');
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Server error (${res.status})`);
      }
      const data = await res.json() as { keys: ApiKey[] };
      setKeys(data.keys ?? []);
    } catch (err) {
      setError(`Could not load API keys: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  async function handleGenerate() {
    const label = newLabel.trim();
    if (!label || generating) return;

    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `Server error (${res.status})`);
      }
      const data = await res.json() as { key: ApiKey };
      const newKey = data.key;
      setKeys(prev => [...prev, newKey]);
      // Always reveal newly generated keys so the user can copy them
      setVisibleKeys(prev => new Set([...prev, newKey.id]));
      setNewlyGeneratedId(newKey.id);
      setNewLabel('');
      setShowNewLabel(false);
    } catch (err) {
      setError(`Failed to generate key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm('Revoke this API key? Any desktop app using it will lose access immediately.')) return;
    setRevokingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      setKeys(prev => prev.filter(k => k.id !== id));
      if (newlyGeneratedId === id) setNewlyGeneratedId(null);
    } catch (err) {
      setError(`Failed to revoke key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopy(key: ApiKey) {
    try {
      await navigator.clipboard.writeText(key.key);
      setCopiedId(key.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setError('Could not copy to clipboard. Select the key text manually.');
    }
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
      <h1 className="text-2xl font-bold mb-2">Settings</h1>
      <p className="text-sm text-gray-500 mb-8">
        Manage API keys for PTT Nexus Manager desktop connections.
      </p>

      <div className="max-w-2xl space-y-6">

        {/* ── API Keys ─────────────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Desktop API Keys</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Authorize PTT Nexus Manager to connect for Org Matching and Online Relay Entry.
              </p>
            </div>
            <button
              onClick={() => { setShowNewLabel(v => !v); setNewLabel(''); setError(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Key
            </button>
          </div>

          {/* Inline new-key form */}
          {showNewLabel && (
            <div className="px-6 py-3 bg-blue-500/5 border-b border-gray-800">
              <p className="text-xs text-gray-400 mb-2">Give this key a label so you know which desktop it belongs to.</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleGenerate();
                    if (e.key === 'Escape') { setShowNewLabel(false); setNewLabel(''); }
                  }}
                  placeholder="e.g. Main Office, Coach's Laptop, Timer Stand"
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 focus:border-blue-500 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none transition-colors"
                  autoFocus
                />
                <button
                  onClick={handleGenerate}
                  disabled={!newLabel.trim() || generating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {generating ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating…
                    </span>
                  ) : 'Generate'}
                </button>
                <button
                  onClick={() => { setShowNewLabel(false); setNewLabel(''); }}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="px-6 py-3 bg-red-500/10 border-b border-red-500/20 flex items-start gap-2">
              <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="text-xs text-red-300 flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-300 text-xs">✕</button>
            </div>
          )}

          {/* Keys list */}
          <div className="divide-y divide-gray-800">
            {loading ? (
              <div className="px-6 py-8 text-center">
                <svg className="animate-spin w-5 h-5 text-gray-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-xs text-gray-600">Loading keys…</p>
              </div>
            ) : activeKeys.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <svg className="w-8 h-8 text-gray-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
                <p className="text-sm text-gray-500 mb-1">No API keys yet</p>
                <p className="text-xs text-gray-600">Click <strong className="text-gray-400">New Key</strong> above to generate one for your desktop.</p>
              </div>
            ) : (
              activeKeys.map(key => {
                const visible = visibleKeys.has(key.id);
                const isNew = key.id === newlyGeneratedId;
                return (
                  <div key={key.id} className={`px-6 py-4 ${isNew ? 'bg-green-500/5' : ''}`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-200">{key.label}</p>
                          {isNew && (
                            <span className="px-1.5 py-0.5 bg-green-500/20 border border-green-500/30 rounded text-[10px] text-green-400 font-medium">
                              New — copy this key now
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-600 mt-0.5">
                          Created {formatDate(key.createdAt)}
                          {key.lastUsedAt && (
                            <span className="ml-2 text-gray-700">· Last used {formatDate(key.lastUsedAt)}</span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRevoke(key.id)}
                        disabled={revokingId === key.id}
                        className="shrink-0 px-2.5 py-1 text-xs bg-red-900/20 hover:bg-red-800/40 border border-red-700/20 text-red-400 hover:text-red-300 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </div>

                    {/* Key value row */}
                    <div className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2">
                      <code className="flex-1 text-[12px] font-mono text-gray-400 tracking-wider truncate select-all">
                        {visible ? key.key : '•'.repeat(32)}
                      </code>
                      {/* Reveal/hide */}
                      <button
                        onClick={() => toggleVisible(key.id)}
                        title={visible ? 'Hide key' : 'Reveal key'}
                        className="shrink-0 p-1 rounded text-gray-600 hover:text-gray-300 transition-colors"
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
                      {/* Copy */}
                      <button
                        onClick={() => handleCopy(key)}
                        title="Copy to clipboard"
                        className="shrink-0 p-1 rounded text-gray-600 hover:text-gray-300 transition-colors"
                      >
                        {copiedId === key.id ? (
                          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.637c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                          </svg>
                        )}
                      </button>
                    </div>

                    {isNew && (
                      <p className="text-[11px] text-amber-400/70 mt-1.5">
                        ⚠ This key won&apos;t be shown again after you leave this page. Copy it now.
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer help */}
          {!loading && (
            <div className="px-6 py-3 bg-gray-800/40 border-t border-gray-800">
              <p className="text-[11px] text-gray-600">
                Paste the key into <span className="text-gray-500">PTT Nexus Manager → Integrations → Cloud → API Key</span>. Keys never expire — revoke if a device is lost or decommissioned.
              </p>
            </div>
          )}
        </div>

        {/* ── Connection info ───────────────────────────────────── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Environment</h2>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Supabase connection</span>
              <span className="font-medium text-green-400">Configured</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Organizations in DB</span>
              <span className="font-medium text-gray-400">—</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

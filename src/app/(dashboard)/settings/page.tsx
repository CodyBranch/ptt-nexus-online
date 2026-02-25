export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="max-w-2xl space-y-6">
        {/* API Keys */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">API Keys</h2>
          <p className="text-sm text-gray-500 mb-4">
            Generate API keys for PTT Nexus Manager desktop instances to authenticate sync operations.
          </p>
          <button
            disabled
            className="px-4 py-2 bg-blue-600/50 text-white/50 text-sm rounded-lg cursor-not-allowed"
          >
            Generate API Key (Coming Soon)
          </button>
        </div>

        {/* Supabase Connection */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Supabase Connection</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Project URL</label>
              <input
                type="text"
                disabled
                value={process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Configured' : 'Not configured'}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Database URL</label>
              <input
                type="text"
                disabled
                value={process.env.DATABASE_URL ? 'Configured' : 'Not configured'}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-500"
              />
            </div>
          </div>
        </div>

        {/* Event Catalog */}
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

        {/* User Management */}
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

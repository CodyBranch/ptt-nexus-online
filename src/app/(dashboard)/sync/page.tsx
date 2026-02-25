export default function SyncPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Sync Dashboard</h1>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.356v4.992" />
        </svg>
        <h2 className="text-lg font-semibold text-gray-400 mb-2">Desktop Sync</h2>
        <p className="text-sm mb-4">
          Sync operations between PTT Nexus Manager desktop instances and this cloud platform.
        </p>
        <p className="text-xs text-gray-600">
          Configure your Supabase connection and API keys in Settings to enable sync.
        </p>
      </div>

      {/* Recent sync logs placeholder */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4 text-gray-300">Recent Sync Operations</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Records</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-sm">
                  No sync operations yet
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

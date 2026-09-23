export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Stats cards */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="text-sm text-gray-500 mb-1">Organizations</div>
          <div className="text-3xl font-bold text-gray-100">0</div>
          <div className="text-xs text-gray-600 mt-2">Teams, schools, clubs</div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="text-sm text-gray-500 mb-1">Record Sets</div>
          <div className="text-3xl font-bold text-gray-100">0</div>
          <div className="text-xs text-gray-600 mt-2">Collections of records</div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="text-sm text-gray-500 mb-1">Total Records</div>
          <div className="text-3xl font-bold text-gray-100">0</div>
          <div className="text-xs text-gray-600 mt-2">Individual record entries</div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4 text-gray-300">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <a
            href="/organizations/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            + Add Organization
          </a>
          <a
            href="/records/new"
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
          >
            + New Record Set
          </a>
        </div>
      </div>

      {/* Recent activity placeholder */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4 text-gray-300">Recent Activity</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-600">
          <p>No recent activity</p>
          <p className="text-sm mt-1">Sync operations and record updates will appear here</p>
        </div>
      </div>
    </div>
  );
}

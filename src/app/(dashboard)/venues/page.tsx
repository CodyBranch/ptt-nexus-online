import { getVenues } from './actions';
import NewVenueForm from './NewVenueForm';

export const dynamic = 'force-dynamic';

export default async function VenuesPage() {
  const list = await getVenues();

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Venues</h1>
          <p className="text-sm text-gray-500 mt-1">
            Courses are saved here from the desk once and pulled into every meet at the venue. Venue records are pinned to a course; meet records belong to a meet series.
          </p>
        </div>
      </div>

      <NewVenueForm />

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mt-4">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3">Venue</th>
              <th className="px-4 py-3">Where</th>
              <th className="px-4 py-3 w-24 text-right">Courses</th>
              <th className="px-4 py-3 w-28 text-right">Meet series</th>
              <th className="px-4 py-3 w-28 text-right">Record sets</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-600">
                  No venues yet. Add one above, or save a course from the desk.
                </td>
              </tr>
            ) : list.map((v) => (
              <tr key={v.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-4 py-3">
                  <a href={`/venues/${v.id}`} className="text-sm font-medium text-blue-400 hover:text-blue-300">{v.name}</a>
                </td>
                <td className="px-4 py-3 text-sm text-gray-400">{[v.city, v.state].filter(Boolean).join(', ') || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-300 text-right tabular-nums">{v.courseCount}</td>
                <td className="px-4 py-3 text-sm text-gray-300 text-right tabular-nums">{v.seriesCount}</td>
                <td className="px-4 py-3 text-sm text-gray-300 text-right tabular-nums">{v.recordSetCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

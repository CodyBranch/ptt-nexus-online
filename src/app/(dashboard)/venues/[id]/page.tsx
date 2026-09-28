import { notFound } from 'next/navigation';
import { getVenue } from '../actions';
import NewSeriesForm from './NewSeriesForm';
import { RECORD_LEVELS } from '@/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

function distanceLabel(m: number): string {
  const miles = m / 1609.344;
  if (Math.abs(miles - Math.round(miles)) < 0.02) return `${Math.round(miles)} mi`;
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 2)} km` : `${Math.round(m)} m`;
}

export default async function VenuePage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getVenue(id);
  if (!detail) notFound();
  const { venue, courses, meetSeries, recordSets } = detail;
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  const levelLabel = (l: string | null) => RECORD_LEVELS.find((x) => x.value === l)?.label ?? 'Any level';

  return (
    <div className="space-y-8">
      <div>
        <a href="/venues" className="text-xs text-gray-500 hover:text-gray-300">← Venues</a>
        <h1 className="text-2xl font-bold mt-1">{venue.name}</h1>
        <p className="text-sm text-gray-500">{[venue.city, venue.state].filter(Boolean).join(', ')}</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Courses</h2>
        <p className="text-xs text-gray-500 mb-3">
          Saved from the desk (Courses → Save to Nexus Online). A reroute adds a new course and retires the one it replaced.
        </p>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3">Course</th>
                <th className="px-4 py-3 w-24">Distance</th>
                <th className="px-4 py-3">What it has</th>
                <th className="px-4 py-3 w-20 text-right">Revision</th>
                <th className="px-4 py-3 w-40">Updated</th>
              </tr>
            </thead>
            <tbody>
              {courses.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-600">No courses yet.</td></tr>
              ) : courses.map((c) => (
                <tr key={c.id} className={`border-b border-gray-800/50 ${c.isActive ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3 text-sm">
                    <span className="font-medium text-gray-200">{c.name}</span>
                    {!c.isActive && <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-400 border border-gray-700">retired</span>}
                    {c.replacesCourseId && (
                      <div className="text-[11px] text-gray-500 mt-0.5">Replaces {courseName.get(c.replacesCourseId) ?? 'an earlier layout'}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300 tabular-nums">{distanceLabel(c.distanceMeters)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {[c.hasMap ? 'map' : null,
                      c.splitPointCount ? `${c.splitPointCount} split point${c.splitPointCount === 1 ? '' : 's'}` : null,
                      c.difficultySegmentCount ? `${c.difficultySegmentCount} difficulty segment${c.difficultySegmentCount === 1 ? '' : 's'}` : null,
                    ].filter(Boolean).join(' · ') || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400 text-right tabular-nums">{c.revision}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{c.updatedAt ? new Date(c.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Meet series</h2>
        <p className="text-xs text-gray-500 mb-3">
          A meet as it comes round each year. Meet records and race records (Gold, Blue, Open) belong to one.
        </p>
        <NewSeriesForm venueId={venue.id} />
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mt-3">
          {meetSeries.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-600">No meet series yet.</div>
          ) : (
            <ul className="divide-y divide-gray-800/60">
              {meetSeries.map((m) => (
                <li key={m.id} className="px-4 py-3 flex items-center justify-between text-sm">
                  <span className="text-gray-200">{m.name}</span>
                  <span className="text-xs text-gray-500">{levelLabel(m.level)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Record sets</h2>
            <p className="text-xs text-gray-500">The venue&apos;s own sets, and those of its meet series.</p>
          </div>
          <a href="/records/new" className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg">+ New record set</a>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {recordSets.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-600">No record sets yet.</div>
          ) : (
            <ul className="divide-y divide-gray-800/60">
              {recordSets.map((s) => (
                <li key={s.id} className="px-4 py-3 flex items-center justify-between text-sm">
                  <a href={`/records/${s.id}`} className="text-blue-400 hover:text-blue-300">{s.name}</a>
                  <span className="text-xs text-gray-500">
                    {s.meetSeriesId ? meetSeries.find((m) => m.id === s.meetSeriesId)?.name ?? 'Meet series' : 'Venue'} · {s.recordCount} record{s.recordCount === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

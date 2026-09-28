import { notFound } from 'next/navigation';
import { getCourseDetail } from '../../../actions';
import RatingLog from './RatingLog';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; courseId: string }>;
}

function distanceLabel(m: number): string {
  const miles = m / 1609.344;
  if (Math.abs(miles - Math.round(miles)) < 0.02) return `${Math.round(miles)} mi`;
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 2)} km` : `${Math.round(m)} m`;
}

const km = (m: number) => (m / 1000).toFixed(m % 1000 === 0 ? 0 : 2);

/** Above 1 is harder than flat ground, below 1 is quicker. */
function difficultyTone(d: number): string {
  if (d >= 1.05) return 'text-red-300';
  if (d > 1.01) return 'text-amber-300';
  if (d < 0.99) return 'text-emerald-300';
  return 'text-gray-300';
}

export default async function CoursePage({ params }: PageProps) {
  const { id, courseId } = await params;
  const detail = await getCourseDetail(courseId);
  if (!detail || detail.course.venueId !== id) notFound();
  const { course, venueName, replaces, replacedBy, ratingLog } = detail;
  const ratings = course.difficulty;

  return (
    <div className="space-y-8">
      <div>
        <a href={`/venues/${id}`} className="text-xs text-gray-500 hover:text-gray-300">← {venueName}</a>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-bold">{course.name}</h1>
          {!course.isActive && <span className="px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-400 border border-gray-700">retired</span>}
        </div>
        <p className="text-sm text-gray-500">
          {distanceLabel(course.distanceMeters)} · revision {course.revision}
          {course.totalGainMeters != null && ` · ${Math.round(course.totalGainMeters)} m of climb`}
          {course.kml ? ' · mapped' : ' · no map'}
        </p>
        {replaces && <p className="text-xs text-gray-500 mt-1">Replaces <a className="text-blue-400 hover:text-blue-300" href={`/venues/${id}/courses/${replaces.id}`}>{replaces.name}</a></p>}
        {replacedBy && <p className="text-xs text-amber-300 mt-1">Replaced by <a className="text-blue-400 hover:text-blue-300" href={`/venues/${id}/courses/${replacedBy.id}`}>{replacedBy.name}</a></p>}
        {course.notes && <p className="text-sm text-gray-400 mt-2">{course.notes}</p>}
      </div>

      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Ratings</h2>
        <p className="text-xs text-gray-500 mb-3">
          How hard each stretch runs: 1.00 is flat ground, above it slower, below it quicker. What the desk turns split times into predictions with.
        </p>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {ratings.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-600">Not rated.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="px-4 py-2">Stretch</th>
                  <th className="px-4 py-2 text-right">Rating</th>
                  <th className="px-4 py-2 text-right">Climb</th>
                  <th className="px-4 py-2 text-right">Drop</th>
                  <th className="px-4 py-2">Surface</th>
                  <th className="px-4 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {ratings.map((r) => (
                  <tr key={r.fromMeters} className="border-b border-gray-800/50">
                    <td className="px-4 py-2 text-gray-300">{km(r.fromMeters)}–{km(r.toMeters)} km</td>
                    <td className={`px-4 py-2 text-right font-mono ${difficultyTone(r.difficulty)}`}>{r.difficulty.toFixed(3)}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{r.gainMeters != null ? `${Math.round(r.gainMeters)} m` : '-'}</td>
                    <td className="px-4 py-2 text-right text-gray-400">{r.lossMeters != null ? `${Math.round(r.lossMeters)} m` : '-'}</td>
                    <td className="px-4 py-2 text-gray-400">{r.surface ?? '-'}</td>
                    <td className="px-4 py-2 text-gray-500">{r.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Split points</h2>
        <p className="text-sm text-gray-400">
          {course.splitPoints.length === 0 ? <span className="text-gray-600">None kept with the course.</span>
            : course.splitPoints.map((p) => `${p.label} (${Math.round(p.distanceMeters)} m)`).join(' · ')}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Rating history</h2>
        <p className="text-xs text-gray-500 mb-3">
          Every set of ratings this course has had, newest first. Restore makes an earlier set the course&apos;s ratings again; desks get it when they next add or update the course.
        </p>
        <RatingLog courseId={course.id} venueId={id} entries={ratingLog} current={ratings} />
      </section>
    </div>
  );
}

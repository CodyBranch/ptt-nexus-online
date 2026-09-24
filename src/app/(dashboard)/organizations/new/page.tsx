import OrganizationForm from '../OrganizationForm';
import { db } from '@/db/client';
import { organizationSubmissions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import type { OrganizationRow } from '@/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ submission?: string }>;
}

/**
 * Add an organisation, optionally starting from a submission.
 *
 * `?submission=<id>` fills the form from a school a meet sent up because
 * nothing in the database matched it. Approving used to run through a separate
 * form that collected twelve of the thirty-one fields, so a school arrived as
 * a stub and somebody had to come back later to give it colours and a badge —
 * which, in practice, nobody did. This is the same form used for every other
 * organisation, opened with what the meet already knew.
 */
export default async function NewOrganizationPage({ searchParams }: PageProps) {
  const { submission: submissionId } = await searchParams;

  let defaults: Partial<OrganizationRow> | null = null;
  let subName: string | null = null;

  if (submissionId) {
    await requireAdmin();
    const rows = await db.select().from(organizationSubmissions)
      .where(eq(organizationSubmissions.id, submissionId)).limit(1);
    const sub = rows[0];
    if (sub && sub.status === 'pending') {
      subName = sub.name;
      // An abbreviation is required and a meet does not always send one.
      // Initials are a guess the reviewer can see and correct, which beats an
      // empty required field they have to invent something for.
      const initials = (sub.name || '')
        .split(/\s+/).map((w) => w[0]).filter(Boolean).join('').slice(0, 5).toUpperCase();
      defaults = {
        name: sub.name,
        abbreviation: sub.abbreviation || initials,
        organizationType: sub.organizationType || 'high_school',
        city: sub.city,
        state: sub.state,
        notes: sub.meetName ? `Submitted from ${sub.meetName}` : null,
      } as Partial<OrganizationRow>;
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">
        {defaults ? 'Add organization from a submission' : 'New Organization'}
      </h1>
      {defaults ? (
        <p className="text-sm text-gray-500 mb-6">
          Filled in from <span className="text-gray-300">{subName}</span>, sent up by a meet that
          found no match. Complete whatever is known — saving creates the school and closes the
          submission.
        </p>
      ) : (
        <div className="mb-6" />
      )}
      <OrganizationForm defaults={defaults} submissionId={defaults ? submissionId : null} />
    </div>
  );
}

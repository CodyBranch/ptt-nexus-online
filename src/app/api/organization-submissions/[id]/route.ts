import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { organizationSubmissions, organizations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

/**
 * Deciding on one submitted school.
 *
 * Approving is what creates the organisation — the submission itself never
 * touches the org database, so a school reaches the data every results page
 * draws from only when somebody has looked at it and filled in what the meet
 * could not know.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const body = await request.json() as {
      status?: 'approved' | 'rejected';
      reviewNote?: string | null;
      /** Anything the reviewer is filling in that the meet did not carry. */
      organization?: Record<string, unknown>;
    };

    const rows = await db.select().from(organizationSubmissions)
      .where(eq(organizationSubmissions.id, id)).limit(1);
    const sub = rows[0];
    if (!sub) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    if (sub.status !== 'pending') {
      return NextResponse.json({ error: `Already ${sub.status}` }, { status: 409 });
    }

    if (body.status === 'rejected') {
      const [updated] = await db.update(organizationSubmissions)
        .set({ status: 'rejected', reviewNote: body.reviewNote ?? null, reviewedAt: new Date() })
        .where(eq(organizationSubmissions.id, id))
        .returning();
      return NextResponse.json({ submission: updated });
    }

    if (body.status !== 'approved') {
      return NextResponse.json({ error: 'status must be approved or rejected' }, { status: 400 });
    }

    // The reviewer's fields win over the meet's — they are the ones who went
    // and looked. What the meet carried stands in for anything left blank.
    const o = body.organization ?? {};
    const pick = (key: string, fallback: string | null = null): string | null => {
      const v = o[key];
      return typeof v === 'string' && v.trim() ? v.trim() : fallback;
    };

    const name = pick('name', sub.name)!;
    const abbreviation = pick('abbreviation', sub.abbreviation)
      // An organisation needs one, and a school's initials beat a blank.
      ?? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 5).toUpperCase();

    const [org] = await db.insert(organizations).values({
      name,
      abbreviation,
      shortName: pick('shortName'),
      mascot: pick('mascot'),
      organizationType: pick('organizationType', sub.organizationType)!,
      conference: pick('conference'),
      stateAssociation: pick('stateAssociation'),
      city: pick('city', sub.city),
      state: pick('state', sub.state),
      primaryColor: pick('primaryColor'),
      secondaryColor: pick('secondaryColor'),
      logoUrl: pick('logoUrl'),
      logoDarkUrl: pick('logoDarkUrl'),
      website: pick('website'),
      notes: pick('notes', `Submitted from ${sub.meetName ?? 'a meet'}`),
    }).returning();

    const [updated] = await db.update(organizationSubmissions)
      .set({
        status: 'approved',
        organizationId: org.id,
        reviewNote: body.reviewNote ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(organizationSubmissions.id, id))
      .returning();

    return NextResponse.json({ submission: updated, organization: org }, { status: 201 });
  } catch (error) {
    console.error('Organization submission review error:', error);
    return NextResponse.json({ error: 'Failed to review submission' }, { status: 500 });
  }
}

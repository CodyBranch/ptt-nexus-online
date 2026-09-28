import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { courses } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';
import { courseOut } from '@/lib/venue-courses';

/** The whole course, for a desk pulling it into a meet. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const [row] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
    if (!row) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    // A retired course says what replaced it, so a desk can offer the new one.
    const [next] = await db.select({ id: courses.id, name: courses.name }).from(courses).where(eq(courses.replacesCourseId, id)).limit(1);
    return NextResponse.json({ course: courseOut(row), replacedBy: next ?? null });
  } catch (error) {
    console.error('Course get error:', error);
    return NextResponse.json({ error: 'Failed to fetch course' }, { status: 500 });
  }
}

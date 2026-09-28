import { NextRequest, NextResponse } from 'next/server';
import { relayAuthKey } from '@/lib/relay-auth';
import { pushCourse, type CourseInput } from '@/lib/venue-courses';

/**
 * A desk saves a course to its venue: new, an edit, or a reroute (a new
 * course replacing the old one, with or without the records carried over).
 * 409 when the course was changed on Nexus Online since the desk pulled it.
 */
export async function POST(request: NextRequest) {
  const auth = await relayAuthKey(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as CourseInput & { meetName?: string };
    const who = body.meetName?.trim() ? `desk: ${body.meetName.trim()}` : 'desk';
    const result = await pushCourse(body, auth.keyId, who);
    if (result.status === 'error') {
      return NextResponse.json({ error: result.message }, { status: result.httpStatus });
    }
    if (result.status === 'conflict') {
      return NextResponse.json({ error: result.message, course: result.course }, { status: 409 });
    }
    return NextResponse.json(result, { status: result.status === 'updated' ? 200 : 201 });
  } catch (error) {
    console.error('Course push error:', error);
    return NextResponse.json({ error: 'Failed to save the course' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { declarationCoachContacts, teamDeclarationAccess } from '@/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  contactsSession, contactsSchools, normalizePhone, validEmail, consentText, confirmText, sendText, MAX_PER_SCHOOL,
} from '@/lib/coach-contacts';

/**
 * The coach sign-up link's API. No login: the link's token is the key, and
 * it opens nothing but this.
 *
 *   GET   the meet and its schools, for the form
 *   POST  { teamId, name, role, email, phone, consent: true }
 *         -> { saved, confirm: 'sent' | 'opted_out' | 'not_configured' | 'failed' }
 *
 * The confirming text goes before the sign-up is kept, so a number that
 * cannot take texts (a landline, a typo) is sent back to the coach to fix
 * rather than kept and never reached.
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await contactsSession((await params).token);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    meetName: session.meetName,
    meetDate: session.meetDate,
    consentText: consentText(session.meetName),
    schools: await contactsSchools(session.id),
  });
}

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await contactsSession((await params).token);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: 'Not a sign-up' }, { status: 400 }); }

  const name = clip(body.name, 100);
  const role = clip(body.role, 60) || null;
  const email = validEmail(clip(body.email, 254));
  const phone = normalizePhone(clip(body.phone, 30));
  const problems: Record<string, string> = {};
  if (!name) problems.name = 'Your name, please.';
  if (!email) problems.email = 'That is not an email address.';
  if (!phone) problems.phone = 'A mobile number: ten digits, or + and the country code.';
  if (body.consent !== true) problems.consent = 'Tick the box to agree to the texts.';

  const teamId = clip(body.teamId, 40);
  const [team] = /^[0-9a-f-]{36}$/i.test(teamId)
    ? await db.select().from(teamDeclarationAccess)
      .where(and(eq(teamDeclarationAccess.id, teamId), eq(teamDeclarationAccess.meetSessionId, session.id))).limit(1)
    : [];
  if (!team) problems.teamId = 'Pick your school.';
  if (Object.keys(problems).length) return NextResponse.json({ error: 'Check the form', problems }, { status: 422 });

  try {
    const [was] = await db.select().from(declarationCoachContacts)
      .where(and(eq(declarationCoachContacts.teamAccessId, team.id), eq(declarationCoachContacts.phone, phone!))).limit(1);
    if (!was) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(declarationCoachContacts)
        .where(and(eq(declarationCoachContacts.teamAccessId, team.id), ne(declarationCoachContacts.phone, phone!)));
      if (n >= MAX_PER_SCHOOL) {
        return NextResponse.json({ error: `${team.teamName} already has ${MAX_PER_SCHOOL} coaches signed up. Ask the meet office to add you.` }, { status: 409 });
      }
    }

    // Confirmed once: signing up again (a new email, a role) does not text again.
    const text = was?.confirmStatus === 'sent'
      ? { status: 'sent' as const, id: was.confirmId, error: null, badNumber: false }
      : await sendText(phone!, confirmText(session.meetName, team.teamName));
    if (text.badNumber) {
      return NextResponse.json({ error: 'Check the form', problems: { phone: 'That number cannot receive texts. Use a mobile number.' } }, { status: 422 });
    }

    const now = new Date();
    const values = {
      name, role, email: email!, consentText: consentText(session.meetName), optedInAt: now,
      confirmStatus: text.status, confirmId: text.id, confirmError: text.error, updatedAt: now,
    };
    await db.insert(declarationCoachContacts)
      .values({ meetSessionId: session.id, teamAccessId: team.id, phone: phone!, ...values })
      .onConflictDoUpdate({ target: [declarationCoachContacts.teamAccessId, declarationCoachContacts.phone], set: values });

    return NextResponse.json({ saved: true, confirm: text.status, teamName: team.teamName, phone });
  } catch (error) {
    console.error('Coach sign-up error:', error);
    return NextResponse.json({ error: 'Could not save that. Try again.' }, { status: 500 });
  }
}

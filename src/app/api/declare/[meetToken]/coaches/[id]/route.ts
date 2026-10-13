import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetDeclarationSessions, declarationCoachContacts } from '@/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';
import { normalizePhone, validEmail } from '@/lib/coach-contacts';

/**
 * One coach's sign-up, from the desk: corrected, or removed.
 *
 *   PATCH  { name?, role?, email?, phone? } -> { contact: { id, name, role, email, phone, updatedAt } }
 *   DELETE -> { removed: true }
 *
 * Removing deletes the sign-up here - their name, email, mobile and what
 * they agreed to - not just the desk's copy. A correction is checked as the
 * sign-up form checks it.
 */

async function find(meetToken: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [session] = await db.select().from(meetDeclarationSessions)
    .where(eq(meetDeclarationSessions.meetToken, meetToken)).limit(1);
  if (!session) return null;
  const [contact] = await db.select().from(declarationCoachContacts)
    .where(and(eq(declarationCoachContacts.id, id), eq(declarationCoachContacts.meetSessionId, session.id))).limit(1);
  return contact ?? null;
}

type Ctx = { params: Promise<{ meetToken: string; id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!await checkRelayAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetToken, id } = await params;
  const contact = await find(meetToken, id);
  if (!contact) return NextResponse.json({ error: 'No such sign-up' }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: 'Not a change' }, { status: 400 }); }
  const set: Partial<typeof declarationCoachContacts.$inferInsert> = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: 'A name is needed.' }, { status: 422 });
    set.name = name;
  }
  if (typeof body.role === 'string' || body.role === null) set.role = typeof body.role === 'string' ? body.role.trim().slice(0, 60) || null : null;
  if (typeof body.email === 'string') {
    const email = validEmail(body.email);
    if (!email) return NextResponse.json({ error: 'That is not an email address.' }, { status: 422 });
    set.email = email;
  }
  if (typeof body.phone === 'string') {
    const phone = normalizePhone(body.phone);
    if (!phone) return NextResponse.json({ error: 'That is not a mobile number: ten digits, or + and the country code.' }, { status: 422 });
    if (phone !== contact.phone) {
      const [taken] = await db.select({ id: declarationCoachContacts.id }).from(declarationCoachContacts)
        .where(and(eq(declarationCoachContacts.teamAccessId, contact.teamAccessId), eq(declarationCoachContacts.phone, phone), ne(declarationCoachContacts.id, contact.id))).limit(1);
      if (taken) return NextResponse.json({ error: 'Another coach at this school signed up with that mobile.' }, { status: 409 });
    }
    set.phone = phone;
  }
  set.updatedAt = new Date();
  const [row] = await db.update(declarationCoachContacts).set(set).where(eq(declarationCoachContacts.id, contact.id)).returning();
  return NextResponse.json({
    contact: { id: row.id, name: row.name, role: row.role, email: row.email, phone: row.phone, updatedAt: new Date(row.updatedAt ?? Date.now()).toISOString() },
  });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  if (!await checkRelayAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetToken, id } = await params;
  const contact = await find(meetToken, id);
  // Already gone is gone: the desk can finish removing its own copy.
  if (!contact) return NextResponse.json({ removed: true, already: true });
  await db.delete(declarationCoachContacts).where(eq(declarationCoachContacts.id, contact.id));
  return NextResponse.json({ removed: true });
}

'use server';

import { db } from '@/db/client';
import { adminUsers } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireOwner, requireAdmin, hashPassword, verifyPassword } from '@/lib/admin-auth';

export async function getPeople() {
  await requireAdmin();
  return db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
      lastSignInAt: adminUsers.lastSignInAt,
      createdAt: adminUsers.createdAt,
    })
    .from(adminUsers)
    .orderBy(asc(adminUsers.email));
}

export async function addPerson(input: {
  email: string; name: string; password: string; role: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireOwner();
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email.includes('@')) return { ok: false, error: 'That does not look like an email address' };
  // Long rather than fiddly. A rule demanding a symbol produces one symbol on
  // the end of a short password; length is what actually costs a guesser.
  if (password.length < 12) return { ok: false, error: 'Twelve characters or more, please' };

  const [clash] = await db.select({ id: adminUsers.id }).from(adminUsers)
    .where(eq(adminUsers.email, email)).limit(1);
  if (clash) return { ok: false, error: 'Somebody already has that address' };

  await db.insert(adminUsers).values({
    email,
    name: input.name.trim() || null,
    passwordHash: hashPassword(password),
    role: input.role === 'admin' ? 'admin' : 'editor',
    createdBy: me.userId,
  });
  revalidatePath('/people');
  return { ok: true };
}

/**
 * Switch somebody off, or back on.
 *
 * Off rather than deleted, so anything recorded against them still reads
 * back. It takes effect immediately, even mid-session: the cookie only
 * carries who somebody is, and whether they are still allowed is looked up
 * on every request.
 */
export async function setPersonActive(
  id: string, active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireOwner();
  if (id === me.userId && !active) {
    return { ok: false, error: 'Switching yourself off would lock you out — ask another admin' };
  }

  if (!active) {
    // The last admin standing keeps the lights on. Without this, one click
    // leaves the dashboard reachable only by whatever is in the environment.
    const admins = await db.select({ id: adminUsers.id }).from(adminUsers)
      .where(eq(adminUsers.role, 'admin'));
    const activeAdmins = await db.select({ id: adminUsers.id, isActive: adminUsers.isActive })
      .from(adminUsers).where(eq(adminUsers.role, 'admin'));
    const stillOn = activeAdmins.filter((a) => a.isActive && a.id !== id);
    const target = admins.find((a) => a.id === id);
    if (target && stillOn.length === 0) {
      return { ok: false, error: 'That is the only admin left — make somebody else one first' };
    }
  }

  await db.update(adminUsers).set({ isActive: active }).where(eq(adminUsers.id, id));
  revalidatePath('/people');
  return { ok: true };
}

export async function setPersonRole(
  id: string, role: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireOwner();
  if (id === me.userId && role !== 'admin') {
    return { ok: false, error: 'Taking your own admin away would leave you unable to give it back' };
  }
  await db.update(adminUsers)
    .set({ role: role === 'admin' ? 'admin' : 'editor' })
    .where(eq(adminUsers.id, id));
  revalidatePath('/people');
  return { ok: true };
}

export async function resetPassword(
  id: string, password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();
  if (password.length < 12) return { ok: false, error: 'Twelve characters or more, please' };
  await db.update(adminUsers)
    .set({ passwordHash: hashPassword(password) })
    .where(eq(adminUsers.id, id));
  revalidatePath('/people');
  return { ok: true };
}

/** Changing your own, which needs the old one rather than admin rights. */
export async function changeMyPassword(
  current: string, next: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAdmin();
  if (!me.userId) return { ok: false, error: 'The bootstrap sign-in has no password to change here' };
  if (next.length < 12) return { ok: false, error: 'Twelve characters or more, please' };

  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, me.userId)).limit(1);
  if (!user || !verifyPassword(current, user.passwordHash)) {
    return { ok: false, error: 'That is not your current password' };
  }
  await db.update(adminUsers)
    .set({ passwordHash: hashPassword(next) })
    .where(eq(adminUsers.id, me.userId));
  return { ok: true };
}

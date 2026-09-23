import { createHmac, timingSafeEqual, randomBytes, scryptSync } from 'crypto';
import { cookies } from 'next/headers';
import { db } from '@/db/client';
import { adminUsers } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Who is allowed to change the shared data.
 *
 * The dashboard had no lock on it at all: Organizations, Records and Settings
 * were reachable by anyone who knew the address, and the delete button on an
 * organisation worked for them too. This is the lock.
 *
 * People have their own accounts, so one can be taken away without changing
 * anything for anybody else — a shared password can only be revoked from
 * everyone at once, which in practice means it never is.
 *
 * ADMIN_PASSWORD stays as a way in when no account can be used: the first
 * deploy before anybody exists, and the day the last account is switched off
 * by mistake. A bootstrap, not an account.
 *
 * It fails closed. With neither an account nor ADMIN_PASSWORD, nobody is an
 * admin and the dashboard refuses — rather than a missing environment
 * variable quietly putting things back how they were.
 */

const COOKIE = 'ptt_admin';
/** A week: long enough not to be a nuisance, short enough to expire. */
const MAX_AGE = 60 * 60 * 24 * 7;

export type AdminRole = 'admin' | 'editor';

export interface Session {
  /** Null for the bootstrap, which is not a row in the table. */
  userId: string | null;
  email: string;
  name: string | null;
  role: AdminRole;
  /** Signed in with ADMIN_PASSWORD rather than an account. */
  bootstrap: boolean;
}

// ── Passwords ────────────────────────────────────────────────────────────────

/**
 * scrypt with a salt of its own per person.
 *
 * Not a plain hash: two people who pick the same password would otherwise
 * store the same string, and anyone reading the table would learn that.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── The cookie ───────────────────────────────────────────────────────────────

function secret(): string | null {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

/** Constant time, so a wrong value does not leak how wrong it was. */
function sameString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sign(payload: string): string {
  const s = secret();
  if (!s) return '';
  return createHmac('sha256', s).update(payload).digest('hex');
}

/** issuedAt.subject.signature — subject is a user id, or "bootstrap". */
function mintToken(subject: string): string {
  const payload = `${Date.now()}.${subject}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): { subject: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [issued, subject, mac] = parts;
  const expected = sign(`${issued}.${subject}`);
  if (!expected || !sameString(mac, expected)) return null;

  const age = (Date.now() - Number(issued)) / 1000;
  if (!Number.isFinite(age) || age < 0 || age >= MAX_AGE) return null;
  return { subject };
}

// ── Who is signed in ─────────────────────────────────────────────────────────

/** Whether there is any way in at all — a way for a page to say so plainly. */
export async function authConfigured(): Promise<boolean> {
  if (process.env.ADMIN_PASSWORD) return true;
  try {
    const [row] = await db.select({ n: sql<number>`count(*)` })
      .from(adminUsers).where(eq(adminUsers.isActive, true));
    return Number(row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = readToken(jar.get(COOKIE)?.value);
  if (!token) return null;

  if (token.subject === 'bootstrap') {
    if (!process.env.ADMIN_PASSWORD) return null;
    return { userId: null, email: 'bootstrap', name: null, role: 'admin', bootstrap: true };
  }

  // Looked up every time rather than trusted from the cookie: revoking
  // somebody has to take effect while they are signed in, which is the whole
  // reason for having accounts.
  try {
    const [user] = await db.select().from(adminUsers)
      .where(and(eq(adminUsers.id, token.subject), eq(adminUsers.isActive, true)))
      .limit(1);
    if (!user) return null;
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role === 'admin' ? 'admin' : 'editor',
      bootstrap: false,
    };
  } catch {
    return null;
  }
}

export async function isAdmin(): Promise<boolean> {
  return (await getSession()) !== null;
}

/**
 * For a server action that changes something.
 *
 * Throws rather than returning a flag: an action that forgets to check the
 * flag still writes, and an action that forgets to call this at all is the
 * thing code review can see.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error('Sign in to change anything here');
  return session;
}

/** For managing people, which an editor may not do. */
export async function requireOwner(): Promise<Session> {
  const session = await requireAdmin();
  if (session.role !== 'admin') throw new Error('Only an admin can manage people');
  return session;
}

// ── In and out ───────────────────────────────────────────────────────────────

export async function signIn(
  email: string, password: string,
): Promise<{ ok: boolean; error?: string }> {
  const jar = await cookies();
  const setCookie = (subject: string) => jar.set(COOKIE, mintToken(subject), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });

  const address = email.trim().toLowerCase();

  if (address) {
    try {
      const [user] = await db.select().from(adminUsers)
        .where(eq(adminUsers.email, address)).limit(1);

      // The same answer whether the address is unknown, the password is wrong
      // or the account is switched off. Which of those it is, is not something
      // somebody guessing should be told.
      if (user && user.isActive && verifyPassword(password, user.passwordHash)) {
        await db.update(adminUsers)
          .set({ lastSignInAt: new Date() })
          .where(eq(adminUsers.id, user.id));
        setCookie(user.id);
        return { ok: true };
      }
    } catch (err) {
      // The database being unreachable is not a wrong password, and saying so
      // is the difference between somebody retyping their password for ten
      // minutes and somebody going to look at the logs. A sign-in page that
      // answers with "a server-side exception has occurred" has told whoever
      // is standing there nothing at all.
      console.error('Sign-in could not reach the database:', err);
      return {
        ok: false,
        error: 'The database did not answer. This is not your password — try again shortly, '
          + 'and if it persists the connection pool or the database itself needs looking at.',
      };
    }
  }

  // The bootstrap: the password on its own, no address.
  const boot = process.env.ADMIN_PASSWORD;
  if (!address && boot && password && sameString(password, boot)) {
    setCookie('bootstrap');
    return { ok: true };
  }

  if (!await authConfigured()) {
    return {
      ok: false,
      error: 'Nobody can sign in yet: there are no accounts and no ADMIN_PASSWORD is set on the server.',
    };
  }
  return { ok: false, error: 'That email address and password do not match an account' };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

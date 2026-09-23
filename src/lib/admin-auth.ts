import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { cookies } from 'next/headers';

/**
 * Who is allowed to change the shared data.
 *
 * The dashboard had no lock on it at all: Organizations, Records and Settings
 * were reachable by anyone who knew the address, and the delete button on an
 * organisation worked for them too. This is the lock.
 *
 * One shared password rather than accounts, because that is what the thing
 * actually is — a handful of people at one timing company maintaining a
 * reference database. Accounts can come later without changing how pages ask
 * the question, which is all `isAdmin()` and `requireAdmin()`.
 *
 * It fails closed. With no ADMIN_PASSWORD set, nobody is an admin and the
 * dashboard refuses — rather than a missing environment variable quietly
 * putting things back how they were.
 */

const COOKIE = 'ptt_admin';
/** A week: long enough not to be a nuisance, short enough to expire. */
const MAX_AGE = 60 * 60 * 24 * 7;

function secret(): string | null {
  // The session secret may be its own value; failing that the password does
  // the job, since anyone holding it can sign in anyway.
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

/** Constant time, so a wrong password does not leak how wrong it was. */
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

/** value = issuedAt.nonce.signature */
function mintToken(): string {
  const payload = `${Date.now()}.${randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

function tokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issued, nonce, mac] = parts;
  const expected = sign(`${issued}.${nonce}`);
  if (!expected || !sameString(mac, expected)) return false;

  const age = (Date.now() - Number(issued)) / 1000;
  return Number.isFinite(age) && age >= 0 && age < MAX_AGE;
}

/** Whether the password is even configured. A page can say so plainly. */
export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const jar = await cookies();
  return tokenValid(jar.get(COOKIE)?.value);
}

/**
 * For a server action that changes something.
 *
 * Throws rather than returning a flag: an action that forgets to check the
 * flag still writes, and an action that forgets to call this at all is the
 * thing code review can see.
 */
export async function requireAdmin(): Promise<void> {
  if (!await isAdmin()) throw new Error('Sign in to change anything here');
}

export async function signIn(password: string): Promise<{ ok: boolean; error?: string }> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { ok: false, error: 'No admin password is set on the server. Set ADMIN_PASSWORD and restart.' };
  }
  if (!password || !sameString(password, expected)) {
    return { ok: false, error: 'That password is not right' };
  }
  const jar = await cookies();
  jar.set(COOKIE, mintToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Coaches signing up for a meet's texts: the sign-up link, checking what they
 * typed, the words they agree to, and the text that confirms it.
 *
 * The texts themselves (weather, schedule changes, declaration reminders) go
 * from the meet desk, through the same Twilio account and number; this only
 * sends the one that says the sign-up worked. Use the same From here as on
 * the desks, so a coach's STOP to it stops the meet's texts too.
 *
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  the account
 *   TWILIO_FROM                            +15551234567, or a Messaging Service (MG...)
 *   TWILIO_API_URL                         tests only: a stand-in for api.twilio.com
 */

import { db } from '@/db/client';
import { meetDeclarationSessions, teamDeclarationAccess, organizations } from '@/db/schema';
import { eq } from 'drizzle-orm';

/** The roles offered; any other can be typed. */
export const COACH_ROLES = ['Head Coach', 'Assistant Coach', 'Athletic Director', 'Team Manager', 'Athletic Trainer'];

/** The most sign-ups one school can have: a cap on a link handed to everybody. */
export const MAX_PER_SCHOOL = 25;

export async function contactsSession(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const [session] = await db.select().from(meetDeclarationSessions)
    .where(eq(meetDeclarationSessions.contactsToken, token)).limit(1);
  return session ?? null;
}

export interface ContactsSchool {
  id: string;
  name: string;
  /** From the school's Nexus Online organization, when the desk matched one. */
  logoUrl: string | null;
  logoDarkUrl: string | null;
  primaryColor: string | null;
}

/** The schools a coach can pick, by name, with their logos. Their access id, never their form's token. */
export async function contactsSchools(sessionId: string): Promise<ContactsSchool[]> {
  const rows = await db.select({
    id: teamDeclarationAccess.id, name: teamDeclarationAccess.teamName,
    logoUrl: organizations.logoUrl, logoDarkUrl: organizations.logoDarkUrl, primaryColor: organizations.primaryColor,
  })
    .from(teamDeclarationAccess)
    .leftJoin(organizations, eq(organizations.id, teamDeclarationAccess.organizationId))
    .where(eq(teamDeclarationAccess.meetSessionId, sessionId));
  return rows.map((r) => ({ ...r, logoUrl: r.logoUrl ?? null, logoDarkUrl: r.logoDarkUrl ?? null, primaryColor: r.primaryColor ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** E.164 for a mobile: ten US digits however typed, or + and a country code. Null when it is not one. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && /^1[2-9]\d{2}[2-9]/.test(digits)) return `+${digits}`;
  return null;
}

/** A plausible email: something@something.tld, no spaces, at most 254 characters. */
export function validEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s || s.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(s) ? s : null;
}

/** What a coach agrees to, word for word as the form shows it. */
export function consentText(meetName: string): string {
  return `I agree to receive text messages from PrimeTime Event & Race Management about ${meetName}: `
    + 'weather, schedule changes and declaration reminders. Message frequency varies. Message and data rates may apply. '
    + 'Reply STOP to opt out at any time, HELP for help.';
}

/** The text that confirms the sign-up. */
export function confirmText(meetName: string, teamName: string): string {
  return `PrimeTime Nexus Messaging: you're signed up for ${meetName} texts for ${teamName}. `
    + 'Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.';
}

export interface TextResult {
  status: 'sent' | 'failed' | 'opted_out' | 'not_configured';
  id: string | null;
  error: string | null;
  /** The number cannot take texts at all: the coach should fix it. */
  badNumber: boolean;
}

/** Send one text through Twilio. Never throws. */
export async function sendText(to: string, body: string): Promise<TextResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { status: 'not_configured', id: null, error: null, badNumber: false };
  const base = (process.env.TWILIO_API_URL || 'https://api.twilio.com/2010-04-01').replace(/\/+$/, '');
  const form = new URLSearchParams({ To: to, Body: body });
  if (from.startsWith('MG')) form.set('MessagingServiceSid', from); else form.set('From', from);
  try {
    const res = await fetch(`${base}/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({})) as { sid?: string; code?: number; message?: string };
    if (res.ok) return { status: 'sent', id: json.sid ?? null, error: null, badNumber: false };
    if (json.code === 21610) return { status: 'opted_out', id: null, error: 'This number replied STOP to the meet number earlier.', badNumber: false };
    // 21211: not a valid number. 21614: not a mobile (a landline cannot take texts).
    const bad = json.code === 21211 || json.code === 21614;
    return { status: 'failed', id: null, error: json.message ? `${json.message} (Twilio ${json.code ?? res.status})` : `Twilio ${res.status}`, badNumber: bad };
  } catch (e) {
    return { status: 'failed', id: null, error: `Could not reach Twilio: ${(e as Error).message}`, badNumber: false };
  }
}

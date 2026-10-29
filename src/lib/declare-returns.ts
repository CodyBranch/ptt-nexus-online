/**
 * Bibs handed back for scratched runners.
 *
 * A coach scratches a runner on the portal; the bib is then handed in at the
 * desk and scanned there - RaceResult's TagTool calls the meet's returns link
 * with ?bib= - or typed in. That confirms the scratch the one way that counts:
 * the bib is back, so nobody else can run with it.
 *
 * A scan never changes a runner on its own. A bib for a runner who has not
 * been scratched is logged as such for staff to decide; a bib on nobody's
 * roster is logged as unknown. Every scan is kept; an undo marks it undone.
 *
 * A runner may wear two bibs: the desk sends a back bib's tag under
 * `extraBibs` (10101 on the back bib of 101). Each bib is scanned in on its
 * own, and the runner's bibs count as back once every one of them is.
 */

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  meetDeclarationSessions, teamDeclarationAccess, declarationSubmissions, declarationBibReturns,
} from '@/db/schema';

type Session = typeof meetDeclarationSessions.$inferSelect;
interface RosterRow {
  id: string; firstName: string; lastName: string; bib?: string | number; tags?: string[];
  /** The tags on the runner's other bibs, each one more bib to hand in. */
  extraBibs?: string[];
  gender?: string; year?: string;
}

export type ReturnStatus = 'returned' | 'not_scratched' | 'unknown_bib' | 'already_returned' | 'ambiguous';

/**
 * A runner's bibs, by the key a scan is filed under: '' for the bib itself
 * (its number, or any tag on it), and the tag of each further bib.
 */
function bibsOf(r: RosterRow): string[] {
  const extra = (r.extraBibs ?? []).map(normalizeCode).filter((c): c is string => !!c);
  return ['', ...new Set(extra)];
}

/** Which of the runner's bibs a scanned code is. */
function bibOfCode(r: RosterRow, code: string): string {
  const c = normalizeCode(code);
  return c && bibsOf(r).includes(c) ? c : '';
}

/** A bib as staff call it: "bib 101", "back bib (10101)". */
function bibName(r: RosterRow, key: string): string {
  if (!key) return `bib ${normalizeBib(r.bib) ?? '-'}`;
  return bibsOf(r).length === 2 ? `back bib (${key})` : `bib ${key}`;
}

export interface ReturnScan {
  id: string;
  at: string;
  /** What was scanned or typed - a bib or one of the runner's tags. */
  code: string;
  /** The runner's bib, when the code found one. */
  bib: string | null;
  status: 'returned' | 'not_scratched' | 'unknown_bib' | 'ambiguous';
  via: string;
  device: string | null;
  undone: boolean;
  runner: { teamAccessId: string; athleteId: string; name: string; teamName: string } | null;
}

export interface OutstandingBib {
  teamAccessId: string;
  teamName: string;
  athleteId: string;
  name: string;
  bib: string | null;
  tags: string[];
  scratchedAt: string | null;
  /** How many bibs the runner wears, and which are still out when some are back. */
  bibCount: number;
  stillOut: string[];
}

export async function returnsSession(token: string): Promise<Session | null> {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const [s] = await db.select().from(meetDeclarationSessions).where(eq(meetDeclarationSessions.returnsToken, token)).limit(1);
  return s ?? null;
}

/** A bib as typed: digits only, no leading zeros ("0214" is 214). */
export function normalizeBib(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  return String(Number(s));
}

/**
 * A scanned or typed code, as it is compared: trimmed and upper-cased, and a
 * numeric one without leading zeros - a reader that pads "10101" to
 * "0000010101" still means 10101. Hex EPCs and lettered tags stay as they are.
 */
export function normalizeCode(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s || s.length > 40 || !/^[0-9A-Z_-]+$/.test(s)) return null;
  return s.replace(/^0+(?=\d)/, '');
}

interface RosterHit { teamAccessId: string; teamName: string; runner: RosterRow }

/**
 * Every runner in the meet, by id, by bib, and by tag. A runner can be on the
 * desk with a bib and a second tag (bib 101, tag 10101); a code is looked up
 * in both, and a code that would name two different runners is kept as such
 * rather than handed to either.
 */
async function rosterIndex(sessionId: string) {
  const teams = await db.select().from(teamDeclarationAccess).where(eq(teamDeclarationAccess.meetSessionId, sessionId));
  const byBib = new Map<string, RosterHit[]>();
  const byTag = new Map<string, RosterHit[]>();
  const byId = new Map<string, RosterHit>();
  const add = (m: Map<string, RosterHit[]>, k: string | null, h: RosterHit) => {
    if (!k) return;
    const list = m.get(k) ?? [];
    if (!list.some((x) => x.teamAccessId === h.teamAccessId && x.runner.id === h.runner.id)) list.push(h);
    m.set(k, list);
  };
  for (const t of teams) {
    for (const r of JSON.parse(t.rosterJson || '[]') as RosterRow[]) {
      const hit = { teamAccessId: t.id, teamName: t.teamName, runner: r };
      byId.set(`${t.id}|${r.id}`, hit);
      add(byBib, normalizeBib(r.bib), hit);
      for (const tag of r.tags ?? []) add(byTag, normalizeCode(tag), hit);
    }
  }
  return { teams, byBib, byTag, byId };
}

/**
 * Who a code is. A scan is read as a tag first - that is what a reader sees -
 * and a typed number as a bib first; either falls back to the other, so
 * TagTool set to send the bib, or staff typing a tag off the back of a bib,
 * still land on the runner.
 */
function lookup(index: Awaited<ReturnType<typeof rosterIndex>>, raw: unknown, via: 'scan' | 'manual'): {
  code: string | null; hits: RosterHit[];
} {
  const code = normalizeCode(raw);
  if (!code) return { code: null, hits: [] };
  const asBib = normalizeBib(code);
  const tagHits = index.byTag.get(code) ?? [];
  const bibHits = asBib ? index.byBib.get(asBib) ?? [] : [];
  const order = via === 'scan' ? [tagHits, bibHits] : [bibHits, tagHits];
  return { code, hits: order.find((h) => h.length > 0) ?? [] };
}

/** Is this runner scratched right now: their latest answer says so. */
async function isScratched(teamAccessId: string, athleteId: string): Promise<boolean> {
  const [row] = await db.select({ status: declarationSubmissions.status }).from(declarationSubmissions)
    .where(and(eq(declarationSubmissions.teamAccessId, teamAccessId), eq(declarationSubmissions.athleteId, athleteId))).limit(1);
  return row?.status === 'scratched';
}

/**
 * Scans that put the runner's bib in our hands: 'returned', and
 * 'not_scratched' - the bib came back before the scratch did. Either way the
 * bib is on the table; whether it counts as a scratched runner's bib back is
 * the runner's status now, not when it was scanned.
 */
const IN_HAND = ['returned', 'not_scratched'];

/** Which of the runner's bibs are in hand. */
async function bibsInHand(teamAccessId: string, runner: RosterRow): Promise<Set<string>> {
  const rows = await db.select({ code: declarationBibReturns.code }).from(declarationBibReturns).where(and(
    eq(declarationBibReturns.teamAccessId, teamAccessId), eq(declarationBibReturns.athleteId, runner.id),
    inArray(declarationBibReturns.status, IN_HAND), isNull(declarationBibReturns.undoneAt),
  ));
  return new Set(rows.map((r) => bibOfCode(runner, r.code)));
}

/** What a scan leaves still out, said after it: nothing for a runner with one bib. */
function afterScan(runner: RosterRow, inHand: Set<string>): { stillOut: string[]; note: string } {
  const all = bibsOf(runner);
  if (all.length < 2) return { stillOut: [], note: '' };
  const out = all.filter((k) => !inHand.has(k)).map((k) => bibName(runner, k));
  return { stillOut: out, note: out.length ? ` - ${out.join(' and ')} still out` : all.length === 2 ? ' - both bibs back' : ` - all ${all.length} bibs back` };
}

const name = (r: RosterRow) => [r.firstName, r.lastName].filter(Boolean).join(' ');

const scanOf = (row: typeof declarationBibReturns.$inferSelect, hit: RosterHit | undefined): ReturnScan => ({
  id: row.id, at: row.createdAt!.toISOString(), code: row.code, bib: row.bib, status: row.status as ReturnScan['status'],
  via: row.via, device: row.device, undone: !!row.undoneAt,
  runner: hit ? { teamAccessId: hit.teamAccessId, athleteId: hit.runner.id, name: name(hit.runner), teamName: hit.teamName } : null,
});

/** One bib handed in. Says what it was, in words staff and the scanner log can show. */
export async function recordReturn(session: Session, raw: unknown, opts: { via: 'scan' | 'manual'; device?: string | null }): Promise<{
  status: ReturnStatus; code: string | null; message: string; scan: ReturnScan | null;
  /** The runner's other bibs not yet back, when they wear more than one. */
  stillOut?: string[];
}> {
  const index = await rosterIndex(session.id);
  const { code, hits } = lookup(index, raw, opts.via);
  if (!code) return { status: 'unknown_bib', code: null, message: `"${String(raw ?? '').slice(0, 40)}" is not a bib or tag`, scan: null };
  const device = opts.device ? String(opts.device).slice(0, 60) : null;
  const hit = hits.length === 1 ? hits[0] : undefined;
  const bib = hit ? normalizeBib(hit.runner.bib) : null;
  const said = bib && bib !== code ? `Tag ${code} (bib ${bib})` : `Bib ${code}`;

  const inHand = hit ? await bibsInHand(hit.teamAccessId, hit.runner) : new Set<string>();
  const which = hit ? bibOfCode(hit.runner, code) : '';
  if (hit && inHand.has(which)) {
    const { stillOut, note } = afterScan(hit.runner, inHand);
    return { status: 'already_returned', code, message: `${said}: ${name(hit.runner)}, ${hit.teamName} - already returned${note}`, scan: null, stillOut };
  }
  const status: ReturnScan['status'] = hits.length > 1 ? 'ambiguous' : !hit ? 'unknown_bib'
    : (await isScratched(hit.teamAccessId, hit.runner.id)) ? 'returned' : 'not_scratched';
  const [row] = await db.insert(declarationBibReturns).values({
    meetSessionId: session.id, teamAccessId: hit?.teamAccessId ?? null, athleteId: hit?.runner.id ?? null,
    code, bib, status, via: opts.via, device,
  }).returning();
  const who = hit ? `${name(hit.runner)}, ${hit.teamName}` : '';
  const { stillOut, note } = hit && (status === 'returned' || status === 'not_scratched')
    ? afterScan(hit.runner, new Set([...inHand, which])) : { stillOut: [], note: '' };
  const message = status === 'returned' ? `${said} returned: ${who}${note}`
    : status === 'not_scratched' ? `${said} is ${who} - not scratched online yet; kept, and counted back once they are${note}`
      : status === 'ambiguous' ? `${code} is on ${hits.length} runners (${hits.map((h) => `${name(h.runner)}, ${h.teamName}`).join('; ')}) - left for staff`
        : `${code} is no bib or tag in this meet`;
  return { status, code, message, scan: scanOf(row, hit), ...(stillOut.length ? { stillOut } : {}) };
}

/** A scan taken back: it stays on file, marked undone. */
export async function undoReturn(session: Session, id: string): Promise<boolean> {
  const r = await db.update(declarationBibReturns).set({ undoneAt: new Date() })
    .where(and(eq(declarationBibReturns.id, id), eq(declarationBibReturns.meetSessionId, session.id), isNull(declarationBibReturns.undoneAt)))
    .returning({ id: declarationBibReturns.id });
  return r.length > 0;
}

/**
 * Staff scratching the runner whose bib was handed in without an online
 * scratch - on the coach's word at the table - and marking it returned.
 */
export async function scratchFromScan(session: Session, id: string): Promise<boolean> {
  const [scan] = await db.select().from(declarationBibReturns)
    .where(and(eq(declarationBibReturns.id, id), eq(declarationBibReturns.meetSessionId, session.id))).limit(1);
  if (!scan || scan.status !== 'not_scratched' || scan.undoneAt || !scan.teamAccessId || !scan.athleteId) return false;
  await db.transaction(async (tx) => {
    await tx.insert(declarationSubmissions).values({
      teamAccessId: scan.teamAccessId!, meetSessionId: session.id, athleteId: scan.athleteId!, status: 'scratched', raceId: null,
    }).onConflictDoUpdate({
      target: [declarationSubmissions.teamAccessId, declarationSubmissions.athleteId],
      set: { status: 'scratched', raceId: null, updatedAt: new Date() },
    });
    await tx.update(declarationBibReturns).set({ status: 'returned' }).where(eq(declarationBibReturns.id, scan.id));
  });
  return true;
}

/**
 * Each scratched runner's bib: back (and when), or still out.
 *
 * `evenIfRunning`: every bib the meet office has, scratched or not - for the
 * coach's own form. A bib handed in before the coach marked the runner Not
 * running is on the table already, and the form told the coach to hand it
 * in; a runner still marked running whose bib was handed in is told to
 * collect it. The dashboard and the desk count returns of scratched runners
 * only, as before.
 */
export async function returnState(sessionId: string, opts: { evenIfRunning?: boolean } = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [key, t] of await returnTally(sessionId, opts)) if (t.complete) out.set(key, t.at);
  return out;
}

export interface ReturnTally {
  /** When the last of the runner's bibs came back (each bib by its first scan). */
  at: string;
  /** Every bib the runner wears is in hand. */
  complete: boolean;
  bibCount: number;
  /** The runner's bibs still out, by name; empty when complete. */
  stillOut: string[];
}

/** Each runner with any bib in hand: which, and whether that is all of them. */
export async function returnTally(sessionId: string, opts: { evenIfRunning?: boolean } = {}): Promise<Map<string, ReturnTally>> {
  // A bib scanned in before the coach scratched the runner was filed as
  // 'not_scratched' and never counted: when the coach then scratched them
  // online - rather than staff pressing "Scratch and accept" - the portal,
  // the dashboard and the desk all said the bib was still out (Nuttycombe,
  // 2026-10-09). It is the same bib on the same table. It counts once the
  // runner is scratched, by whoever.
  const [rows, answers, { byId }] = await Promise.all([
    db.select({ t: declarationBibReturns.teamAccessId, a: declarationBibReturns.athleteId, at: declarationBibReturns.createdAt, status: declarationBibReturns.status, code: declarationBibReturns.code })
      .from(declarationBibReturns)
      .where(and(eq(declarationBibReturns.meetSessionId, sessionId), inArray(declarationBibReturns.status, IN_HAND), isNull(declarationBibReturns.undoneAt))),
    db.select({ t: declarationSubmissions.teamAccessId, a: declarationSubmissions.athleteId, status: declarationSubmissions.status })
      .from(declarationSubmissions).where(eq(declarationSubmissions.meetSessionId, sessionId)),
    rosterIndex(sessionId),
  ]);
  const scratched = new Set(answers.filter((r) => r.status === 'scratched').map((r) => `${r.t}|${r.a}`));
  // Runner -> each bib in hand -> when its first scan was.
  const back = new Map<string, Map<string, string>>();
  for (const r of rows) {
    if (!r.t || !r.a || !r.at) continue;
    const key = `${r.t}|${r.a}`;
    if (r.status === 'not_scratched' && !scratched.has(key) && !opts.evenIfRunning) continue;
    const runner = byId.get(key)?.runner;
    const which = runner ? bibOfCode(runner, r.code) : '';
    const at = r.at.toISOString();
    const bibs = back.get(key) ?? new Map<string, string>();
    if (!bibs.has(which) || at < bibs.get(which)!) bibs.set(which, at);
    back.set(key, bibs);
  }
  const out = new Map<string, ReturnTally>();
  for (const [key, bibs] of back) {
    const runner = byId.get(key)?.runner;
    // A runner gone from the roster since: one bib, as before.
    const all = runner ? bibsOf(runner) : [''];
    const missing = all.filter((k) => !bibs.has(k));
    out.set(key, {
      at: [...bibs.values()].sort().at(-1)!,
      complete: missing.length === 0,
      bibCount: all.length,
      stillOut: runner ? missing.map((k) => bibName(runner, k)) : [],
    });
  }
  return out;
}

/** What the staff page shows: the scans, newest first, and every bib still out. */
export async function returnsView(session: Session) {
  const { byId } = await rosterIndex(session.id);
  const [scans, answers, tally] = await Promise.all([
    db.select().from(declarationBibReturns).where(eq(declarationBibReturns.meetSessionId, session.id))
      .orderBy(desc(declarationBibReturns.createdAt)).limit(200),
    db.select().from(declarationSubmissions).where(eq(declarationSubmissions.meetSessionId, session.id)),
    returnTally(session.id),
  ]);
  const scratched = answers.filter((a) => a.status === 'scratched');
  const scratchedNow = new Set(scratched.map((a) => `${a.teamAccessId}|${a.athleteId}`));
  const scanList: ReturnScan[] = scans.map((s) => {
    const scan = scanOf(s, s.teamAccessId && s.athleteId ? byId.get(`${s.teamAccessId}|${s.athleteId}`) : undefined);
    // Handed in before the scratch, scratched since: it is a return now, and
    // "Scratch and accept" has nothing left to do.
    return s.status === 'not_scratched' && scratchedNow.has(`${s.teamAccessId}|${s.athleteId}`) ? { ...scan, status: 'returned' } : scan;
  });
  const outstanding: OutstandingBib[] = scratched
    .filter((s) => !tally.get(`${s.teamAccessId}|${s.athleteId}`)?.complete)
    .flatMap((s) => {
      const hit = byId.get(`${s.teamAccessId}|${s.athleteId}`);
      if (!hit) return [];
      const all = bibsOf(hit.runner);
      return [{
        teamAccessId: s.teamAccessId, teamName: hit.teamName, athleteId: s.athleteId, name: name(hit.runner),
        bib: normalizeBib(hit.runner.bib), tags: hit.runner.tags ?? [], scratchedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
        bibCount: all.length,
        stillOut: tally.get(`${s.teamAccessId}|${s.athleteId}`)?.stillOut ?? all.map((k) => bibName(hit.runner, k)),
      }];
    })
    .sort((a, b) => a.teamName.localeCompare(b.teamName) || (Number(a.bib) || 0) - (Number(b.bib) || 0));
  // A bib handed in for a runner who has since been put back in a race: they
  // need it back before the gun - the one bib of two as much as both.
  const status = new Map(answers.map((a) => [`${a.teamAccessId}|${a.athleteId}`, a.status]));
  const backButRunning: OutstandingBib[] = [...tally.entries()]
    .filter(([k]) => status.get(k) === 'declared')
    .flatMap(([k, t]) => {
      const hit = byId.get(k);
      if (!hit) return [];
      return [{ teamAccessId: hit.teamAccessId, teamName: hit.teamName, athleteId: hit.runner.id, name: name(hit.runner),
        bib: normalizeBib(hit.runner.bib), tags: hit.runner.tags ?? [], scratchedAt: t.at, bibCount: t.bibCount, stillOut: t.stillOut }];
    });
  return {
    meet: { name: session.meetName, date: session.meetDate },
    scratched: scratched.length,
    returned: scratched.length - outstanding.length,
    outstanding,
    backButRunning,
    scans: scanList,
  };
}

/**
 * Packet pickup: each school's packets handed over at the packet table.
 *
 * Every team label the desk prints carries a code, NXPKT-<desk team id>-<side>,
 * with the side F or M for a label per side of the field, or A for one label
 * for the whole school. Scanning it - a USB scanner on the staff page, the
 * tablet app's camera, or a scanner app calling ?code= - marks that packet
 * picked up. A school with no label to hand is marked from the list.
 *
 * The table can ask who took it and for their signature, on its own screen,
 * or hand the signing to a sign-off tablet facing the coach: then the scan
 * leaves the packet 'waiting' until it is signed there.
 */

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  meetDeclarationSessions, teamDeclarationAccess, declarationPacketPickups, declarationCoachContacts,
} from '@/db/schema';

type Session = typeof meetDeclarationSessions.$inferSelect;
type Access = typeof teamDeclarationAccess.$inferSelect;
interface RosterRow { id: string; bib?: string | number | null; gender?: string | null }

export type Side = 'F' | 'M' | 'X';
export type PickupOutcome = 'picked_up' | 'waiting' | 'already' | 'unknown';

export interface PacketSide {
  side: Side;
  athletes: number;
  bibs: string;
  pickup: { id: string; status: 'picked_up' | 'waiting'; by: string | null; at: string; signed: boolean } | null;
}

export interface PickupSchool {
  teamAccessId: string;
  teamId: string;
  name: string;
  coaches: string[];
  sides: PacketSide[];
}

export interface PickupLogRow {
  id: string;
  teamAccessId: string;
  teamName: string;
  side: Side;
  status: 'picked_up' | 'waiting';
  by: string | null;
  signed: boolean;
  via: string;
  device: string | null;
  at: string;
  undone: boolean;
}

export interface PickupView {
  meet: { name: string; date: string | null };
  packets: number;
  pickedUp: number;
  schools: PickupSchool[];
  log: PickupLogRow[];
  waiting: PickupLogRow[];
}

export interface PickupResult {
  status: PickupOutcome;
  message: string;
  school: string | null;
  sides: Side[];
  ids: string[];
}

export async function pickupSession(token: string): Promise<Session | null> {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const [s] = await db.select().from(meetDeclarationSessions).where(eq(meetDeclarationSessions.pickupToken, token)).limit(1);
  return s ?? null;
}

/** A label's code: NXPKT-<team id>-<F|M|A>. Case and stray spaces from a scanner do not matter. */
export function parseLabelCode(raw: unknown): { teamId: string; side: 'F' | 'M' | 'A' } | null {
  const m = /^NXPKT-([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})-([FMA])$/i.exec(String(raw ?? '').trim());
  return m ? { teamId: m[1].toLowerCase(), side: m[2].toUpperCase() as 'F' | 'M' | 'A' } : null;
}

/** The side of the field a roster gender is on. */
export function sideOf(gender: string | null | undefined): Side {
  const g = String(gender ?? '').trim().toUpperCase();
  if (g === 'F' || g === 'W' || g === 'G') return 'F';
  if (g === 'M' || g === 'B') return 'M';
  return 'X';
}

export function sideName(side: Side, terms: string): string {
  if (side === 'X') return 'packet';
  const men = terms === 'men_women';
  return side === 'F' ? (men ? "women's packet" : "girls' packet") : (men ? "men's packet" : "boys' packet");
}

/** Bibs as runs: "101-109, 112". */
export function bibRuns(bibs: number[]): string {
  const sorted = [...new Set(bibs)].sort((a, b) => a - b);
  const runs: string[] = [];
  let from = sorted[0];
  let prev = sorted[0];
  for (const b of sorted.slice(1)) {
    if (b === prev + 1) { prev = b; continue; }
    runs.push(from === prev ? String(from) : `${from}-${prev}`);
    from = prev = b;
  }
  if (sorted.length) runs.push(from === prev ? String(from) : `${from}-${prev}`);
  return runs.join(', ');
}

/** A school's packets: one per side of the field it has runners on (alternates, bib 20,000 and up, have none). */
export function packetsOf(access: Pick<Access, 'rosterJson'>): Array<{ side: Side; athletes: number; bibs: string }> {
  let roster: RosterRow[] = [];
  try { roster = JSON.parse(access.rosterJson ?? '[]') as RosterRow[]; } catch { /* an unreadable roster is an empty one */ }
  const by = new Map<Side, number[]>();
  const count = new Map<Side, number>();
  for (const r of roster) {
    const bib = Number(r.bib);
    if (Number.isFinite(bib) && bib >= 20000) continue;
    const side = sideOf(r.gender);
    count.set(side, (count.get(side) ?? 0) + 1);
    if (!by.has(side)) by.set(side, []);
    if (Number.isFinite(bib) && bib > 0) by.get(side)!.push(bib);
  }
  const sides = [...count.keys()].sort((a, b) => 'FMX'.indexOf(a) - 'FMX'.indexOf(b));
  if (!sides.length) return [{ side: 'X', athletes: 0, bibs: '' }];
  return sides.map((side) => ({ side, athletes: count.get(side) ?? 0, bibs: bibRuns(by.get(side) ?? []) }));
}

async function activeFor(sessionId: string) {
  return db.select().from(declarationPacketPickups)
    .where(and(eq(declarationPacketPickups.meetSessionId, sessionId), isNull(declarationPacketPickups.undoneAt)));
}

export interface RecordOptions {
  by?: string | null;
  signature?: string | null;
  /** Leave it waiting for the coach to sign on the sign-off tablet. */
  wait?: boolean;
  via: 'scan' | 'manual';
  device?: string | null;
}

const MAX_SIGNATURE = 300_000;

/** Ids from a page or a scanner are checked before Postgres sees them: a bad uuid is an error there, not a miss. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanName(s: unknown): string | null {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return t || null;
}

function cleanSignature(s: unknown): string | null {
  const t = String(s ?? '');
  return t.startsWith('data:image/png;base64,') && t.length <= MAX_SIGNATURE ? t : null;
}

/**
 * Mark a school's packet(s) picked up: one side, or with 'A' every side it
 * has. A side already picked up is left as it was and said so; one waiting
 * for a signature is completed when this one brings it.
 */
export async function recordPickup(
  session: Session,
  target: { teamId?: string; teamAccessId?: string; side: 'F' | 'M' | 'X' | 'A' },
  opts: RecordOptions,
): Promise<PickupResult> {
  if (target.teamAccessId && !UUID.test(target.teamAccessId)) {
    return { status: 'unknown', message: 'That school is not in this meet.', school: null, sides: [], ids: [] };
  }
  const [access] = await db.select().from(teamDeclarationAccess).where(and(
    eq(teamDeclarationAccess.meetSessionId, session.id),
    target.teamAccessId ? eq(teamDeclarationAccess.id, target.teamAccessId) : eq(teamDeclarationAccess.teamId, target.teamId ?? ''),
  )).limit(1);
  if (!access) {
    return { status: 'unknown', message: 'That label is not for a school in this meet.', school: null, sides: [], ids: [] };
  }

  const packets = packetsOf(access).map((p) => p.side);
  const wanted: Side[] = target.side === 'A' ? packets : [target.side];
  const missing = wanted.filter((s) => !packets.includes(s));
  if (missing.length === wanted.length) {
    return {
      status: 'unknown',
      message: `${access.teamName} has no ${sideName(missing[0], session.genderTerms)} in this meet.`,
      school: access.teamName, sides: [], ids: [],
    };
  }
  const sides = wanted.filter((s) => packets.includes(s));

  const by = cleanName(opts.by);
  const signature = cleanSignature(opts.signature);
  const existing = (await activeFor(session.id)).filter((p) => p.teamAccessId === access.id);
  const now = new Date();
  const done: Side[] = [];
  const already: Side[] = [];
  const ids: string[] = [];
  for (const side of sides) {
    const had = existing.find((p) => p.side === side);
    if (had && had.status === 'picked_up') { already.push(side); ids.push(had.id); continue; }
    if (had) {
      // Waiting for a signature: this one completes it, or leaves it waiting.
      if (!opts.wait) {
        await db.update(declarationPacketPickups).set({
          status: 'picked_up', pickedUpBy: by ?? had.pickedUpBy, signature: signature ?? had.signature, signedAt: signature ? now : had.signedAt,
        }).where(eq(declarationPacketPickups.id, had.id));
        done.push(side);
      } else {
        already.push(side);
      }
      ids.push(had.id);
      continue;
    }
    // A second station scanning the same label at the same moment: the
    // unique index lets one in, and the other is told it was picked up.
    const [row] = await db.insert(declarationPacketPickups).values({
      meetSessionId: session.id,
      teamAccessId: access.id,
      side,
      status: opts.wait ? 'waiting' : 'picked_up',
      pickedUpBy: by,
      signature,
      signedAt: signature ? now : null,
      via: opts.via,
      device: cleanName(opts.device),
    }).onConflictDoNothing().returning();
    if (!row) { already.push(side); continue; }
    ids.push(row.id);
    done.push(side);
  }

  const what = (list: Side[]) => list.map((s) => sideName(s, session.genderTerms)).join(' and ');
  if (!done.length) {
    return { status: 'already', message: `${access.teamName}: ${what(already)} already picked up.`, school: access.teamName, sides: already, ids };
  }
  const tail = already.length ? ` (${what(already)} was already picked up)` : '';
  if (opts.wait) {
    return { status: 'waiting', message: `${access.teamName}: ${what(done)} waiting for the coach to sign${tail}.`, school: access.teamName, sides: done, ids };
  }
  return {
    status: 'picked_up',
    message: `${access.teamName}: ${what(done)} picked up${by ? ` by ${by}` : ''}${tail}.`,
    school: access.teamName, sides: done, ids,
  };
}

/** A scanned code: a team label, or nothing this meet knows. */
export async function recordScan(session: Session, code: unknown, opts: RecordOptions): Promise<PickupResult> {
  const label = parseLabelCode(code);
  if (!label) {
    return { status: 'unknown', message: `${String(code ?? '').trim() || 'That'} is not a team label's code.`, school: null, sides: [], ids: [] };
  }
  return recordPickup(session, { teamId: label.teamId, side: label.side }, opts);
}

/** The coach signs for packets waiting on the sign-off tablet. */
export async function signPickups(session: Session, ids: string[], by: unknown, signature: unknown): Promise<boolean> {
  const sig = cleanSignature(signature);
  const name = cleanName(by);
  ids = ids.filter((id) => UUID.test(id));
  if (!ids.length || (!sig && !name)) return false;
  const rows = await db.update(declarationPacketPickups).set({
    status: 'picked_up', pickedUpBy: name, signature: sig, signedAt: sig ? new Date() : null,
  }).where(and(
    eq(declarationPacketPickups.meetSessionId, session.id),
    inArray(declarationPacketPickups.id, ids),
    isNull(declarationPacketPickups.undoneAt),
  )).returning({ id: declarationPacketPickups.id });
  return rows.length > 0;
}

export async function undoPickup(session: Session, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const rows = await db.update(declarationPacketPickups).set({ undoneAt: new Date() }).where(and(
    eq(declarationPacketPickups.meetSessionId, session.id),
    eq(declarationPacketPickups.id, id),
    isNull(declarationPacketPickups.undoneAt),
  )).returning({ id: declarationPacketPickups.id });
  return rows.length > 0;
}

export async function signatureOf(session: Session, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select({ signature: declarationPacketPickups.signature }).from(declarationPacketPickups)
    .where(and(eq(declarationPacketPickups.meetSessionId, session.id), eq(declarationPacketPickups.id, id))).limit(1);
  return row?.signature ?? null;
}

export async function pickupView(session: Session): Promise<PickupView> {
  const teams = await db.select().from(teamDeclarationAccess).where(eq(teamDeclarationAccess.meetSessionId, session.id));
  const rows = await db.select({
    id: declarationPacketPickups.id,
    teamAccessId: declarationPacketPickups.teamAccessId,
    side: declarationPacketPickups.side,
    status: declarationPacketPickups.status,
    by: declarationPacketPickups.pickedUpBy,
    signedAt: declarationPacketPickups.signedAt,
    via: declarationPacketPickups.via,
    device: declarationPacketPickups.device,
    at: declarationPacketPickups.createdAt,
    undoneAt: declarationPacketPickups.undoneAt,
  }).from(declarationPacketPickups)
    .where(eq(declarationPacketPickups.meetSessionId, session.id))
    .orderBy(desc(declarationPacketPickups.createdAt));
  const contacts = await db.select({ teamAccessId: declarationCoachContacts.teamAccessId, name: declarationCoachContacts.name })
    .from(declarationCoachContacts).where(eq(declarationCoachContacts.meetSessionId, session.id));

  const nameOf = new Map(teams.map((t) => [t.id, t.teamName]));
  const log: PickupLogRow[] = rows.map((r) => ({
    id: r.id,
    teamAccessId: r.teamAccessId,
    teamName: nameOf.get(r.teamAccessId) ?? '',
    side: r.side as Side,
    status: r.status as 'picked_up' | 'waiting',
    by: r.by,
    signed: !!r.signedAt,
    via: r.via,
    device: r.device,
    at: (r.at ?? new Date()).toISOString(),
    undone: !!r.undoneAt,
  }));
  const active = log.filter((r) => !r.undone);

  let packets = 0;
  let pickedUp = 0;
  const schools: PickupSchool[] = teams.map((t) => {
    const sides = packetsOf(t).map((p) => {
      const hit = active.find((r) => r.teamAccessId === t.id && r.side === p.side);
      packets++;
      if (hit?.status === 'picked_up') pickedUp++;
      return { ...p, pickup: hit ? { id: hit.id, status: hit.status, by: hit.by, at: hit.at, signed: hit.signed } : null };
    });
    const coaches = [...new Set(contacts.filter((c) => c.teamAccessId === t.id).map((c) => c.name.trim()).filter(Boolean))];
    return { teamAccessId: t.id, teamId: t.teamId, name: t.teamName, coaches, sides };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    meet: { name: session.meetName, date: session.meetDate ?? null },
    packets,
    pickedUp,
    schools,
    log: log.slice(0, 200),
    // Oldest first: the coach at the front of the line signs first.
    waiting: active.filter((r) => r.status === 'waiting').reverse(),
  };
}

/** What the desk pulls with the answers: each school's packets picked up, by desk team id. */
export async function pickupsForDesk(sessionId: string): Promise<Map<string, Array<{ side: Side; by: string | null; at: string; signed: boolean }>>> {
  const rows = await db.select({
    teamAccessId: declarationPacketPickups.teamAccessId,
    side: declarationPacketPickups.side,
    by: declarationPacketPickups.pickedUpBy,
    signedAt: declarationPacketPickups.signedAt,
    at: declarationPacketPickups.createdAt,
  }).from(declarationPacketPickups).where(and(
    eq(declarationPacketPickups.meetSessionId, sessionId),
    isNull(declarationPacketPickups.undoneAt),
    eq(declarationPacketPickups.status, 'picked_up'),
  ));
  const out = new Map<string, Array<{ side: Side; by: string | null; at: string; signed: boolean }>>();
  for (const r of rows) {
    if (!out.has(r.teamAccessId)) out.set(r.teamAccessId, []);
    out.get(r.teamAccessId)!.push({ side: r.side as Side, by: r.by, at: (r.at ?? new Date()).toISOString(), signed: !!r.signedAt });
  }
  return out;
}

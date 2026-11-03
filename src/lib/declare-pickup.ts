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
 *
 * Besides its packets, a school can pick up a count of the meet's other
 * items (session.pickupItemsJson, set on the desk and sent with the portal):
 * hats, water bottles, a banner, so many per team, per runner or per school.
 * The desk totals them the same way (its shared/declarations/pickup-items.ts):
 * keep dueOf in step with it. Each station hands out what it chooses, so
 * one grouped table or a station per item both work off the same label, and
 * each hand-over keeps who took it, when, and where.
 *
 * A practice run (session.pickupPracticeAt set) tests all of it against the
 * real meet: everything recorded meanwhile is marked practice, the table
 * shows only that, the desk never pulls it, and ending the run deletes it.
 */

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  meetDeclarationSessions, teamDeclarationAccess, declarationPacketPickups, declarationCoachContacts, organizations, declarationStaffCheckins,
  declarationItemPickups,
} from '@/db/schema';
import { staffOf, covers, sameName, type StaffMember } from '@/lib/declare-staff';

type Session = typeof meetDeclarationSessions.$inferSelect;
type Access = typeof teamDeclarationAccess.$inferSelect;
interface RosterRow { id: string; bib?: string | number | null; gender?: string | null }

export type Side = 'F' | 'M' | 'X';
export type PickupOutcome = 'picked_up' | 'waiting' | 'already' | 'unknown';

/** How a pickup item is counted: so many per team (each side of the field), per runner, or per school. */
export type ItemPer = 'team' | 'runner' | 'school';
/** One of the meet's pickup items, set on the packet table's page. */
export interface PickupItem { id: string; name: string; count: number; per: ItemPer }
/** A side of the field, or 'S' for an item counted for the whole school. */
export type ItemSide = Side | 'S';

/** One item for one side of a school (or the school): how many are due, and each hand-over so far. */
export interface ItemLine {
  itemId: string;
  side: ItemSide;
  due: number;
  given: number;
  handOvers: Array<{ id: string; count: number; by: string | null; at: string; device: string | null }>;
}

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
  /** Who may take its packets (the desk's staff list), for the table to offer by side. */
  staff: StaffMember[];
  /** Passes handed to its staff so far (live ones, oldest first). */
  checkins: StaffCheckin[];
  /** The school's logo and color from its Nexus Online organization, when the desk matched one. */
  badge: { logoUrl: string | null; logoDarkUrl: string | null; color: string | null } | null;
  coaches: string[];
  sides: PacketSide[];
  /** Its pickup items, in the meet's order: a line per side (or one for the school) with anything due. */
  items: ItemLine[];
}

export interface PickupLogRow {
  id: string;
  teamAccessId: string;
  teamName: string;
  side: ItemSide;
  status: 'picked_up' | 'waiting';
  by: string | null;
  /**
   * Who that is on the school's staff list: their roles for this packet's
   * side ("Head Coach"), '' on the list with no role, or null not on it.
   * Undefined when the school sent no staff list at all.
   */
  byRole?: string | null;
  signed: boolean;
  via: string;
  device: string | null;
  at: string;
  undone: boolean;
  /** A pickup item's hand-over rather than a packet: which item, and how many. */
  item?: { id: string; name: string; count: number };
}

/** A coach pass (or another credential) handed to one of a school's staff. */
export interface StaffCheckin { id: string; teamAccessId: string; staffId: string | null; name: string; item: string; at: string; device: string | null }

export interface PickupView {
  meet: { name: string; date: string | null };
  /** A practice run under way: when it started. Everything shown is practice. */
  practice: { since: string } | null;
  packets: number;
  pickedUp: number;
  /** Coach passes handed out, and how many people the schools' staff lists name. */
  passes: { given: number; staff: number };
  /** The meet's pickup items, each with how many are due and given, and how many schools have all theirs. */
  items: Array<PickupItem & { due: number; given: number; schoolsDone: number; schools: number }>;
  schools: PickupSchool[];
  log: PickupLogRow[];
  waiting: PickupLogRow[];
}

export interface PickupResult {
  status: PickupOutcome;
  message: string;
  school: string | null;
  /** Which school, so the table can show its logo with the answer. */
  teamAccessId: string | null;
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

const PERS = new Set<ItemPer>(['team', 'runner', 'school']);
const MAX_ITEMS = 12;

/** The items as sent from the page, cleaned: at most 12, each named, counted 1-500, with an id of its own. */
export function cleanItems(raw: unknown): PickupItem[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  return raw.slice(0, MAX_ITEMS).flatMap((x): PickupItem[] => {
    const o = (x ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return [];
    const count = Math.min(500, Math.max(1, Math.round(Number(o.count) || 1)));
    const per = PERS.has(o.per as ItemPer) ? (o.per as ItemPer) : 'team';
    let id = typeof o.id === 'string' && /^[a-z0-9]{1,16}$/.test(o.id) ? o.id : '';
    while (!id || ids.has(id)) id = Math.random().toString(36).slice(2, 10);
    ids.add(id);
    return [{ id, name, count, per }];
  });
}

/** The meet's pickup items, as last saved. */
export function itemsOf(session: Pick<Session, 'pickupItemsJson'>): PickupItem[] {
  try { return cleanItems(JSON.parse(session.pickupItemsJson ?? '[]')); } catch { return []; }
}

/** What a school is due of each item: per team for each of its packets, per runner on each side, or once for the school. */
export function dueOf(items: PickupItem[], packets: Array<{ side: Side; athletes: number }>): Array<{ itemId: string; side: ItemSide; due: number }> {
  return items.flatMap((it) => {
    if (it.per === 'school') return [{ itemId: it.id, side: 'S' as const, due: it.count }];
    return packets
      .map((p) => ({ itemId: it.id, side: p.side as ItemSide, due: it.per === 'runner' ? it.count * p.athletes : it.count }))
      .filter((l) => l.due > 0);
  });
}

/** An item line said in a log or an answer: "Hats (women)", or just "Banner" for the school. */
export function itemWhat(name: string, side: ItemSide, terms: string): string {
  if (side === 'S' || side === 'X') return name;
  const men = terms === 'men_women';
  return `${name} (${side === 'F' ? (men ? 'women' : 'girls') : (men ? 'men' : 'boys')})`;
}

/** Whether what is recorded now is practice. */
const practicing = (session: Session) => !!session.pickupPracticeAt;

async function activeFor(session: Session) {
  return db.select().from(declarationPacketPickups).where(and(
    eq(declarationPacketPickups.meetSessionId, session.id), isNull(declarationPacketPickups.undoneAt),
    eq(declarationPacketPickups.practice, practicing(session)),
  ));
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
    return { status: 'unknown', message: 'That school is not in this meet.', school: null, teamAccessId: null, sides: [], ids: [] };
  }
  const [access] = await db.select().from(teamDeclarationAccess).where(and(
    eq(teamDeclarationAccess.meetSessionId, session.id),
    target.teamAccessId ? eq(teamDeclarationAccess.id, target.teamAccessId) : eq(teamDeclarationAccess.teamId, target.teamId ?? ''),
  )).limit(1);
  if (!access) {
    return { status: 'unknown', message: 'That label is not for a school in this meet.', school: null, teamAccessId: null, sides: [], ids: [] };
  }

  const packets = packetsOf(access).map((p) => p.side);
  const wanted: Side[] = target.side === 'A' ? packets : [target.side];
  const missing = wanted.filter((s) => !packets.includes(s));
  if (missing.length === wanted.length) {
    return {
      status: 'unknown',
      message: `${access.teamName} has no ${sideName(missing[0], session.genderTerms)} in this meet.`,
      school: access.teamName, teamAccessId: access.id, sides: [], ids: [],
    };
  }
  const sides = wanted.filter((s) => packets.includes(s));

  const by = cleanName(opts.by);
  const signature = cleanSignature(opts.signature);
  const existing = (await activeFor(session)).filter((p) => p.teamAccessId === access.id);
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
      practice: practicing(session),
    }).onConflictDoNothing().returning();
    if (!row) { already.push(side); continue; }
    ids.push(row.id);
    done.push(side);
  }

  const what = (list: Side[]) => list.map((s) => sideName(s, session.genderTerms)).join(' and ');
  if (!done.length) {
    return { status: 'already', message: `${access.teamName}: ${what(already)} already picked up.`, school: access.teamName, teamAccessId: access.id, sides: already, ids };
  }
  const tail = already.length ? ` (${what(already)} was already picked up)` : '';
  if (opts.wait) {
    return { status: 'waiting', message: `${access.teamName}: ${what(done)} waiting for the coach to sign${tail}.`, school: access.teamName, teamAccessId: access.id, sides: done, ids };
  }
  return {
    status: 'picked_up',
    message: `${access.teamName}: ${what(done)} picked up${by ? ` by ${by}` : ''}${tail}.`,
    school: access.teamName, teamAccessId: access.id, sides: done, ids,
  };
}

/** A scanned code: a team label, or nothing this meet knows. */
export async function recordScan(session: Session, code: unknown, opts: RecordOptions): Promise<PickupResult> {
  const label = parseLabelCode(code);
  if (!label) {
    return { status: 'unknown', message: `${String(code ?? '').trim() || 'That'} is not a team label's code.`, school: null, teamAccessId: null, sides: [], ids: [] };
  }
  return recordPickup(session, { teamId: label.teamId, side: label.side }, opts);
}

export interface ItemResult {
  status: 'picked_up' | 'already' | 'unknown';
  message: string;
  ids: string[];
}

/**
 * Hand over pickup items to a school: so many of an item for a side (or the
 * school), each line its own row with who took it and when. A line with
 * nothing left to give is not given again (two stations, or a scan read
 * twice), and said so; giving more than is left is allowed - extras happen.
 */
export async function recordItems(
  session: Session,
  input: { teamAccessId: unknown; lines: unknown; by?: unknown; device?: unknown },
): Promise<ItemResult> {
  const teamAccessId = String(input.teamAccessId ?? '');
  if (!UUID.test(teamAccessId)) return { status: 'unknown', message: 'That school is not in this meet.', ids: [] };
  const [access] = await db.select().from(teamDeclarationAccess).where(and(
    eq(teamDeclarationAccess.meetSessionId, session.id), eq(teamDeclarationAccess.id, teamAccessId),
  )).limit(1);
  if (!access) return { status: 'unknown', message: 'That school is not in this meet.', ids: [] };

  const items = itemsOf(session);
  const due = dueOf(items, packetsOf(access));
  const given = await db.select({ itemId: declarationItemPickups.itemId, side: declarationItemPickups.side, count: declarationItemPickups.count })
    .from(declarationItemPickups).where(and(
      eq(declarationItemPickups.teamAccessId, access.id), isNull(declarationItemPickups.undoneAt),
      eq(declarationItemPickups.practice, practicing(session)),
    ));
  const by = cleanName(input.by);
  const device = cleanName(input.device);
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, 40) as Array<Record<string, unknown>>;
  const done: string[] = [];
  const already: string[] = [];
  const ids: string[] = [];
  for (const l of lines) {
    const item = items.find((i) => i.id === l?.itemId);
    const line = item && due.find((d) => d.itemId === item.id && d.side === l.side);
    const count = Math.min(999, Math.max(0, Math.round(Number(l?.count) || 0)));
    if (!item || !line || !count) continue;
    const what = itemWhat(item.name, line.side, session.genderTerms);
    const left = line.due - given.filter((g) => g.itemId === item.id && g.side === line.side).reduce((n, g) => n + g.count, 0);
    if (left <= 0) { already.push(what); continue; }
    const [row] = await db.insert(declarationItemPickups).values({
      meetSessionId: session.id, teamAccessId: access.id, itemId: item.id, itemName: item.name, side: line.side,
      count, pickedUpBy: by, device, practice: practicing(session),
    }).returning({ id: declarationItemPickups.id });
    ids.push(row.id);
    done.push(`${count} ${what}`);
  }
  if (!done.length && !already.length) return { status: 'unknown', message: `${access.teamName}: nothing to hand over.`, ids };
  if (!done.length) return { status: 'already', message: `${access.teamName}: ${already.join(', ')} already handed over.`, ids };
  return {
    status: 'picked_up',
    message: `${access.teamName}: ${done.join(', ')}${by ? ` to ${by}` : ''}${already.length ? ` (${already.join(', ')} already handed over)` : ''}.`,
    ids,
  };
}

export async function undoItemPickup(session: Session, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const rows = await db.update(declarationItemPickups).set({ undoneAt: new Date() }).where(and(
    eq(declarationItemPickups.meetSessionId, session.id), eq(declarationItemPickups.id, id), isNull(declarationItemPickups.undoneAt),
  )).returning({ id: declarationItemPickups.id });
  return rows.length === 1;
}

/** Save the meet's pickup items, as the desk sends them. An item removed keeps its hand-overs in the log under its old name. */
export async function setPickupItems(session: Session, raw: unknown): Promise<PickupItem[]> {
  const items = cleanItems(raw);
  await db.update(meetDeclarationSessions).set({ pickupItemsJson: JSON.stringify(items) }).where(eq(meetDeclarationSessions.id, session.id));
  return items;
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
    .where(and(eq(declarationPacketPickups.meetSessionId, session.id), eq(declarationPacketPickups.practice, practicing(session))))
    .orderBy(desc(declarationPacketPickups.createdAt));
  const contacts = await db.select({ teamAccessId: declarationCoachContacts.teamAccessId, name: declarationCoachContacts.name })
    .from(declarationCoachContacts).where(eq(declarationCoachContacts.meetSessionId, session.id));

  const orgIds = [...new Set(teams.map((t) => t.organizationId).filter((x): x is string => !!x))];
  const orgs = orgIds.length
    ? await db.select({ id: organizations.id, logoUrl: organizations.logoUrl, logoDarkUrl: organizations.logoDarkUrl, color: organizations.primaryColor })
      .from(organizations).where(inArray(organizations.id, orgIds))
    : [];
  const orgOf = new Map(orgs.map((o) => [o.id, o]));

  const nameOf = new Map(teams.map((t) => [t.id, t.teamName]));
  const checkins = (await db.select().from(declarationStaffCheckins).where(and(
    eq(declarationStaffCheckins.meetSessionId, session.id), isNull(declarationStaffCheckins.undoneAt),
    eq(declarationStaffCheckins.practice, practicing(session)),
  )).orderBy(declarationStaffCheckins.createdAt)).map((c): StaffCheckin => ({
    id: c.id, teamAccessId: c.teamAccessId, staffId: c.staffId, name: c.name, item: c.item, at: (c.createdAt ?? new Date()).toISOString(), device: c.device,
  }));
  const itemRows = await db.select().from(declarationItemPickups).where(and(
    eq(declarationItemPickups.meetSessionId, session.id), eq(declarationItemPickups.practice, practicing(session)),
  )).orderBy(desc(declarationItemPickups.createdAt));
  const items = itemsOf(session);

  const staffOfTeam = new Map(teams.map((t) => [t.id, staffOf(t.staffJson)]));
  /** Who took it, read against the school's staff list (see PickupLogRow.byRole). */
  const roleOf = (teamAccessId: string, side: ItemSide, by: string | null): string | null | undefined => {
    const staff = staffOfTeam.get(teamAccessId) ?? [];
    if (!staff.length || !by) return undefined;
    const m = staff.find((x) => sameName(x.name, by));
    if (!m) return null;
    const s = side === 'S' ? 'X' : side;
    return m.roles.filter((r) => r.scope === 'all' || r.scope === s).map((r) => r.role).join(', ') || (covers(m, s) ? '' : m.roles.map((r) => r.role).join(', '));
  };
  const log: PickupLogRow[] = rows.map((r) => ({
    id: r.id,
    teamAccessId: r.teamAccessId,
    teamName: nameOf.get(r.teamAccessId) ?? '',
    side: r.side as Side,
    status: r.status as 'picked_up' | 'waiting',
    by: r.by,
    byRole: roleOf(r.teamAccessId, r.side as Side, r.by),
    signed: !!r.signedAt,
    via: r.via,
    device: r.device,
    at: (r.at ?? new Date()).toISOString(),
    undone: !!r.undoneAt,
  }));
  const itemLog: PickupLogRow[] = itemRows.map((r) => ({
    id: r.id,
    teamAccessId: r.teamAccessId,
    teamName: nameOf.get(r.teamAccessId) ?? '',
    side: r.side as ItemSide,
    status: 'picked_up',
    by: r.pickedUpBy,
    byRole: roleOf(r.teamAccessId, r.side as ItemSide, r.pickedUpBy),
    signed: false,
    via: 'manual',
    device: r.device,
    at: (r.createdAt ?? new Date()).toISOString(),
    undone: !!r.undoneAt,
    item: { id: r.itemId, name: items.find((i) => i.id === r.itemId)?.name ?? r.itemName, count: r.count },
  }));
  const active = log.filter((r) => !r.undone);
  const activeItems = itemRows.filter((r) => !r.undoneAt);

  let packets = 0;
  let pickedUp = 0;
  const schools: PickupSchool[] = teams.map((t) => {
    const sides = packetsOf(t).map((p) => {
      const hit = active.find((r) => r.teamAccessId === t.id && r.side === p.side);
      packets++;
      if (hit?.status === 'picked_up') pickedUp++;
      return { ...p, pickup: hit ? { id: hit.id, status: hit.status, by: hit.by, at: hit.at, signed: hit.signed } : null };
    });
    const lines = dueOf(items, sides).map((d): ItemLine => {
      const handOvers = activeItems.filter((r) => r.teamAccessId === t.id && r.itemId === d.itemId && r.side === d.side).reverse()
        .map((r) => ({ id: r.id, count: r.count, by: r.pickedUpBy, at: (r.createdAt ?? new Date()).toISOString(), device: r.device }));
      return { ...d, given: handOvers.reduce((n, h) => n + h.count, 0), handOvers };
    });
    const coaches = [...new Set(contacts.filter((c) => c.teamAccessId === t.id).map((c) => c.name.trim()).filter(Boolean))];
    const o = t.organizationId ? orgOf.get(t.organizationId) : undefined;
    const badge = o ? { logoUrl: o.logoUrl ?? null, logoDarkUrl: o.logoDarkUrl ?? null, color: o.color ?? null } : null;
    return { teamAccessId: t.id, teamId: t.teamId, name: t.teamName, badge, coaches, staff: staffOfTeam.get(t.id) ?? [], checkins: checkins.filter((c) => c.teamAccessId === t.id), sides, items: lines };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const allLog = [...log, ...itemLog].sort((a, b) => b.at.localeCompare(a.at));

  return {
    meet: { name: session.meetName, date: session.meetDate ?? null },
    practice: session.pickupPracticeAt ? { since: session.pickupPracticeAt.toISOString() } : null,
    packets,
    pickedUp,
    passes: { given: checkins.length, staff: [...staffOfTeam.values()].reduce((n, l) => n + l.length, 0) },
    items: items.map((it) => {
      const per = schools.map((s) => s.items.filter((l) => l.itemId === it.id)).filter((l) => l.length);
      return {
        ...it,
        due: per.flat().reduce((n, l) => n + l.due, 0),
        given: per.flat().reduce((n, l) => n + l.given, 0),
        schoolsDone: per.filter((l) => l.every((x) => x.given >= x.due)).length,
        schools: per.length,
      };
    }),
    schools,
    log: allLog.slice(0, 200),
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
    eq(declarationPacketPickups.practice, false),
  ));
  const out = new Map<string, Array<{ side: Side; by: string | null; at: string; signed: boolean }>>();
  for (const r of rows) {
    if (!out.has(r.teamAccessId)) out.set(r.teamAccessId, []);
    out.get(r.teamAccessId)!.push({ side: r.side as Side, by: r.by, at: (r.at ?? new Date()).toISOString(), signed: !!r.signedAt });
  }
  return out;
}

/** What the desk pulls with the answers: each school's pickup items handed over, by desk team id. */
export async function itemPickupsForDesk(sessionId: string): Promise<Map<string, Array<{ itemId: string; item: string; side: ItemSide; count: number; by: string | null; at: string }>>> {
  const rows = await db.select().from(declarationItemPickups).where(and(
    eq(declarationItemPickups.meetSessionId, sessionId), isNull(declarationItemPickups.undoneAt), eq(declarationItemPickups.practice, false),
  )).orderBy(declarationItemPickups.createdAt);
  const out = new Map<string, Array<{ itemId: string; item: string; side: ItemSide; count: number; by: string | null; at: string }>>();
  for (const r of rows) {
    if (!out.has(r.teamAccessId)) out.set(r.teamAccessId, []);
    out.get(r.teamAccessId)!.push({ itemId: r.itemId, item: r.itemName, side: r.side as ItemSide, count: r.count, by: r.pickedUpBy, at: (r.createdAt ?? new Date()).toISOString() });
  }
  return out;
}

/**
 * Hand a coach pass (or another item) to one of a school's staff. A person on
 * its staff list is named by their desk id; a walk-up by name alone. The same
 * person and item twice is one pass: the second is told so.
 */
export async function checkInStaff(
  session: Session,
  input: { teamAccessId: unknown; staffId?: unknown; name?: unknown; item?: unknown; device?: unknown },
): Promise<{ status: 'checked_in' | 'already' | 'unknown'; message: string; checkin: StaffCheckin | null }> {
  const teamAccessId = String(input.teamAccessId ?? '');
  if (!UUID.test(teamAccessId)) return { status: 'unknown', message: 'That school is not in this meet.', checkin: null };
  const [access] = await db.select().from(teamDeclarationAccess).where(and(
    eq(teamDeclarationAccess.meetSessionId, session.id), eq(teamDeclarationAccess.id, teamAccessId),
  )).limit(1);
  if (!access) return { status: 'unknown', message: 'That school is not in this meet.', checkin: null };
  const staff = staffOf(access.staffJson);
  const listed = typeof input.staffId === 'string' ? staff.find((m) => m.id === input.staffId) : undefined;
  const name = listed?.name ?? cleanName(input.name);
  if (!name) return { status: 'unknown', message: 'A name is needed.', checkin: null };
  const item = (typeof input.item === 'string' ? input.item.trim().slice(0, 40) : '') || 'Coach pass';
  const onList = listed ?? staff.find((m) => sameName(m.name, name));
  // Two stations at once: the unique index lets one in, the other is told.
  const [row] = await db.insert(declarationStaffCheckins).values({
    meetSessionId: session.id, teamAccessId: access.id, staffId: onList?.id ?? null, name, item, device: cleanName(input.device),
    practice: practicing(session),
  }).onConflictDoNothing().returning();
  if (!row) return { status: 'already', message: `${name} already has a ${item.toLowerCase()}.`, checkin: null };
  return {
    status: 'checked_in',
    message: `${access.teamName}: ${item.toLowerCase()} for ${name}${onList ? '' : ' (not on the staff list)'}.`,
    checkin: { id: row.id, teamAccessId: access.id, staffId: row.staffId, name, item, at: (row.createdAt ?? new Date()).toISOString(), device: row.device },
  };
}

/** Take a pass back (handed to the wrong person, or returned). */
export async function undoCheckin(session: Session, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const rows = await db.update(declarationStaffCheckins).set({ undoneAt: new Date() }).where(and(
    eq(declarationStaffCheckins.id, id), eq(declarationStaffCheckins.meetSessionId, session.id), isNull(declarationStaffCheckins.undoneAt),
  )).returning({ id: declarationStaffCheckins.id });
  return rows.length === 1;
}

/**
 * Start a practice run, or end one: ending deletes everything recorded as
 * practice (pickups, signatures, coach passes and items) and puts the table back on
 * the real pickups. Says how many of each were removed.
 */
export async function setPractice(session: Session, on: boolean): Promise<{ practice: boolean; removed: { pickups: number; passes: number; items: number } }> {
  if (on) {
    if (!session.pickupPracticeAt) {
      await db.update(meetDeclarationSessions).set({ pickupPracticeAt: new Date() }).where(eq(meetDeclarationSessions.id, session.id));
    }
    return { practice: true, removed: { pickups: 0, passes: 0, items: 0 } };
  }
  const pickups = await db.delete(declarationPacketPickups).where(and(
    eq(declarationPacketPickups.meetSessionId, session.id), eq(declarationPacketPickups.practice, true),
  )).returning({ id: declarationPacketPickups.id });
  const passes = await db.delete(declarationStaffCheckins).where(and(
    eq(declarationStaffCheckins.meetSessionId, session.id), eq(declarationStaffCheckins.practice, true),
  )).returning({ id: declarationStaffCheckins.id });
  const handed = await db.delete(declarationItemPickups).where(and(
    eq(declarationItemPickups.meetSessionId, session.id), eq(declarationItemPickups.practice, true),
  )).returning({ id: declarationItemPickups.id });
  await db.update(meetDeclarationSessions).set({ pickupPracticeAt: null }).where(eq(meetDeclarationSessions.id, session.id));
  return { practice: false, removed: { pickups: pickups.length, passes: passes.length, items: handed.length } };
}

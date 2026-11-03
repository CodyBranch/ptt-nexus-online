/**
 * A school's staff for the packet table: who may take its packets.
 *
 * The desk sends them with the portal (publish and update): each person's
 * name, their roles - each for one side of the field or all of it, so the
 * girls' head coach who assists the boys is both - and whether the state
 * association approved them. Only that is kept: anything else the desk might
 * send (a phone, an email) is dropped here, so contact details never reach
 * the cloud (Cody, 2026-11-02).
 */

export type StaffScope = 'all' | 'F' | 'M';
export interface StaffRole { role: string; scope: StaffScope }
export interface StaffMember { id: string; name: string; roles: StaffRole[]; approved: boolean }

const SCOPES = new Set<StaffScope>(['all', 'F', 'M']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** What the desk sent, cleaned to the shape kept: at most 60 people of 8 roles each. */
export function cleanStaff(raw: unknown): StaffMember[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).flatMap((p): StaffMember[] => {
    const o = (p ?? {}) as Record<string, unknown>;
    const name = str(o.name, 80);
    if (!name) return [];
    const roles = (Array.isArray(o.roles) ? o.roles : []).slice(0, 8).flatMap((r): StaffRole[] => {
      const x = (r ?? {}) as Record<string, unknown>;
      const role = str(x.role, 40);
      return role ? [{ role, scope: SCOPES.has(x.scope as StaffScope) ? (x.scope as StaffScope) : 'all' }] : [];
    });
    return [{ id: str(o.id, 64) || name, name, roles, approved: o.approved !== false }];
  });
}

export const staffJson = (raw: unknown): string => JSON.stringify(cleanStaff(raw));

/** The stored list, read back. */
export function staffOf(json: string | null | undefined): StaffMember[] {
  try { return cleanStaff(JSON.parse(json ?? '[]')); } catch { return []; }
}

/** Covers a packet's side: a role for that side or the whole team. 'A' (every side) is anyone. */
export const covers = (m: StaffMember, side: 'F' | 'M' | 'X' | 'A') =>
  side === 'A' || side === 'X' || m.roles.length === 0 || m.roles.some((r) => r.scope === 'all' || r.scope === side);

/** The same person: names compared without case, spaces or punctuation. */
export const sameName = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '');
  return !!n(a) && n(a) === n(b);
};

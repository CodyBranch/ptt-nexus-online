/**
 * What a code scanned at the packet table names. Safe in the browser and on
 * the server alike.
 *
 * One QR code does both jobs on the desk's prints: on a coach's phone it is
 * the school's link to its declarations, and at the packet table it marks the
 * school's packet picked up. The desk prints it as
 *
 *   https://<this site>/q/<TEAM TOKEN><side>
 *
 * with the side F or M on a label per side of the field, and none on a
 * roster or a whole-school label (every side the school has). The token is
 * in capitals so the code stays coarse enough for a small label.
 *
 * Also read, so nothing already printed stops working:
 *   NXPKT-<desk team id>-<F|M|A>        labels printed before the link
 *   .../declare/<meet token>/<token>     rosters printed before the link
 */

export type LabelSide = 'F' | 'M' | 'A';

export type Scanned =
  | { kind: 'label'; teamId: string; side: LabelSide }
  | { kind: 'link'; token: string; side: LabelSide };

const LABEL = /^NXPKT-([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})-([FMA])$/i;
const SHORT = /\/q\/([0-9a-f]{32})([FMA])?\/?(?:[?#]|$)/i;
const COACH = /\/declare\/[0-9a-f]{32}\/([0-9a-f]{32})\/?(?:[?#]|$)/i;

/** Case and stray spaces from a scanner do not matter. */
export function parseScan(raw: unknown): Scanned | null {
  const c = String(raw ?? '').trim();
  if (!c) return null;
  const label = LABEL.exec(c);
  if (label) return { kind: 'label', teamId: label[1].toLowerCase(), side: label[2].toUpperCase() as LabelSide };
  const short = SHORT.exec(c);
  if (short) return { kind: 'link', token: short[1].toLowerCase(), side: (short[2]?.toUpperCase() as LabelSide | undefined) ?? 'A' };
  const coach = COACH.exec(c);
  if (coach) return { kind: 'link', token: coach[1].toLowerCase(), side: 'A' };
  return null;
}

/**
 * A school's link token, made safe to hand the packet table: the table
 * matches a scanned link against it, and nobody holding the staff link can
 * turn it back into the token that opens the school's declarations.
 */
export async function linkKey(token: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nexus-label:${token.toLowerCase()}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

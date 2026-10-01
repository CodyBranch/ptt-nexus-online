import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { athleteHeadshots, organizations } from '@/db/schema';
import { checkRelayAuth } from '@/lib/relay-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { headshotNameKey } from '@/lib/headshots/name-key';

/**
 * A desk sends up a headshot somebody dropped onto a runner.
 *
 * Body (JSON): `{ organizationId, season, firstName, lastName, gender?,
 * classYear?, image (base64), fileName?, meet? }`.
 *
 * Kept like any other: by school, season and name, in the Headshots bucket at
 * {season}/originals/{school}/... and found by the next meet that asks. It has
 * not been through the cutter - no background taken off, no mold - so it is
 * filed as 'review' with that said, and the same file stands as its cutout
 * until it is cut. It replaces what was there for that runner unless a person
 * hid the old one, in which case that stays hidden and this one is kept too.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BUCKET = 'Headshots';
const MAX_BYTES = 4 * 1024 * 1024;

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';

export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The body is not JSON' }, { status: 400 });
  }
  const organizationId = String(body.organizationId ?? '');
  const season = Number(body.season);
  const firstName = String(body.firstName ?? '').trim();
  const lastName = String(body.lastName ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !Number.isInteger(season) || !firstName || !lastName || typeof body.image !== 'string') {
    return NextResponse.json({ error: 'organizationId, season, firstName, lastName and image are required' }, { status: 400 });
  }
  const bytes = Buffer.from(body.image, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: `The picture must be under ${MAX_BYTES / 1048576} MB` }, { status: 400 });
  }

  // A picture, really: sharp reads it or it is refused. Stored as WebP at its
  // own size - never resized here.
  let webp: Buffer, width: number | null, height: number | null;
  try {
    webp = await sharp(bytes, { failOn: 'none' }).rotate().webp({ quality: 92, alphaQuality: 100 }).toBuffer();
    const meta = await sharp(webp).metadata();
    width = meta.width ?? null; height = meta.height ?? null;
  } catch {
    return NextResponse.json({ error: 'That file is not a picture we can read' }, { status: 400 });
  }

  const [org] = await db.select({ name: organizations.name, shortName: organizations.shortName, type: organizations.organizationType })
    .from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return NextResponse.json({ error: 'No such school' }, { status: 404 });
  // "Unattached" is a placeholder, not a school: everyone filed under it
  // would share one roster, and two people of the same name one photo.
  if (org.type === 'unattached') {
    return NextResponse.json({ error: 'unattached runners are not filed by school; kept in this meet only' }, { status: 422 });
  }

  const hash = createHash('sha256').update(webp).digest('hex');
  const path = `${season}/originals/${slug(org.shortName || org.name)}/${slug(`${lastName}-${firstName}`)}-${hash.slice(0, 8)}.webp`;
  const storage = createAdminClient().storage.from(BUCKET);
  const { error } = await storage.upload(path, webp, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' });
  if (error && !/exists|duplicate/i.test(error.message)) {
    console.error('[headshots] upload:', error.message);
    return NextResponse.json({ error: 'Could not store the picture' }, { status: 502 });
  }

  const meet = typeof body.meet === 'string' ? body.meet.slice(0, 120) : null;
  const row = {
    organizationId, season, firstName, lastName, nameKey: headshotNameKey(firstName, lastName),
    gender: typeof body.gender === 'string' ? body.gender : null,
    classYear: typeof body.classYear === 'string' ? body.classYear : null,
    rosterUrl: null, rosterPlayerId: null,
    photoSourceUrl: `added by hand${meet ? ` at ${meet}` : ''}${typeof body.fileName === 'string' ? `: ${body.fileName.slice(0, 120)}` : ''}`,
    cutoutPath: path, originalPath: path, width, height, bytes: webp.length, sha256: hash,
    status: 'review', review: ['added by hand: not cut out yet'],
    fetchedAt: new Date(),
  };
  try {
    const [saved] = await db.insert(athleteHeadshots).values(row).onConflictDoUpdate({
      target: [athleteHeadshots.organizationId, athleteHeadshots.season, athleteHeadshots.nameKey],
      set: { ...row, status: sql`CASE WHEN ${athleteHeadshots.status} = 'hidden' THEN 'hidden' ELSE 'review' END`, updatedAt: new Date() },
    }).returning({ id: athleteHeadshots.id });
    return NextResponse.json({ id: saved.id, path, width, height, sha256: hash });
  } catch (e) {
    console.error('[headshots] upload row:', e);
    return NextResponse.json({ error: 'Could not record the picture' }, { status: 500 });
  }
}

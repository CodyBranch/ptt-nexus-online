import sharp from 'sharp';

/**
 * A headshot from the Headshots bucket, at a size asked for.
 *
 * /headshots/2026/cutouts/notre-dame/ackley-daelen-1a2b3c4d.webp           as stored
 * /headshots/2026/cutouts/notre-dame/ackley-daelen-1a2b3c4d.webp?w=480     480 wide
 *
 * The stored cutouts are full size (a thousand pixels and more across); a
 * results page or a meet file wants a few hundred. Resized here once and
 * cached at the edge for a year: a file's name carries its own hash, so a
 * replaced photo has a new address and nothing serves the old face. The
 * shape is never changed - a smaller copy of the same crop.
 *
 * Only the Headshots bucket, and only a path within it.
 */

export const runtime = 'nodejs';
export const maxDuration = 20;

const BUCKET = 'Headshots';
const ALLOWED = /^[A-Za-z0-9._\-/ ]+$/;
/** The widths asked for, so the edge cache holds a few copies, not one per pixel. */
const WIDTHS = new Set([96, 160, 240, 320, 480, 640]);

function fail(status: number) {
  return new Response(status === 404 ? 'Not found' : 'Could not read that headshot', {
    status,
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const key = (path ?? []).map((p) => decodeURIComponent(p)).join('/');
  if (!key || key.includes('..') || !ALLOWED.test(key)) return fail(404);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return fail(500);

  const wParam = new URL(req.url).searchParams.get('w');
  const w = wParam ? Number(wParam) : null;
  if (w != null && !WIDTHS.has(w)) return fail(404);

  const upstream = await fetch(
    `${base.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`,
    { cache: 'no-store', signal: AbortSignal.timeout(12000) },
  ).catch(() => null);
  if (!upstream || !upstream.ok) return fail(upstream?.status === 404 || upstream?.status === 400 ? 404 : 502);
  const type = upstream.headers.get('content-type') ?? '';
  if (!/^image\//.test(type)) return fail(404);

  let body: Buffer = Buffer.from(await upstream.arrayBuffer());
  let outType = type;
  if (w != null) {
    try {
      body = await sharp(body, { failOn: 'none' })
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 82, alphaQuality: 95 })
        .toBuffer();
      outType = 'image/webp';
    } catch {
      return fail(502);
    }
  }
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': outType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

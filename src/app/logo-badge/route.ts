/**
 * A school's logo at badge size, for the live results page.
 *
 * Logos come from two places: our own Logos bucket, and MSHSAA's site, where
 * a Missouri meet's teams were imported from. MSHSAA's files run to 3,000
 * pixels and 2 MB for a badge the page draws at 24; a meet has 150 of them,
 * and a phone at the course never finishes loading them.
 *
 * This fetches the file once, shrinks it to fit a square of `w` pixels, and
 * hands it on as WebP with a cache long enough that the CDN answers everybody
 * after the first. Next's own image resizer did this too, but when a big file
 * defeated it, it passed the 2 MB original through and the CDN kept that; here
 * a file that cannot be shrunk is an error, and the page falls back from it.
 *
 * Only those two sources. SVGs are drawn to pixels, so nothing in one runs.
 */
import sharp from 'sharp';

export const runtime = 'nodejs';
export const maxDuration = 20;

const WIDTHS = new Set([64, 128]);

function allowed(src: URL): boolean {
  if (src.protocol !== 'https:') return false;
  if (src.hostname === 'www.mshsaa.org' || src.hostname === 'mshsaa.org') return true;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    return src.hostname === new URL(base).hostname
      && src.pathname.startsWith('/storage/v1/object/public/Logos/');
  } catch {
    return false;
  }
}

function fail(status: number) {
  // Not worth remembering for long: the source may be back in a minute.
  return new Response(status === 404 ? 'Not found' : 'Could not shrink that logo', {
    status,
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' },
  });
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const w = Number(params.get('w') ?? 128);
  let src: URL;
  try {
    src = new URL(params.get('src') ?? '');
  } catch {
    return fail(404);
  }
  if (!WIDTHS.has(w) || !allowed(src)) return fail(404);

  const upstream = await fetch(src, { cache: 'no-store', signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!upstream || !upstream.ok) return fail(upstream?.status === 404 ? 404 : 502);
  const type = upstream.headers.get('content-type') ?? '';
  if (!/^image\//.test(type)) return fail(404);

  let out: Buffer;
  try {
    const input = Buffer.from(await upstream.arrayBuffer());
    out = await sharp(input, { failOn: 'none', animated: false })
      .rotate()
      .resize(w, w, { fit: 'inside', withoutEnlargement: true })
      .toColorspace('srgb')
      .webp({ quality: 80, alphaQuality: 90 })
      .toBuffer();
  } catch {
    return fail(502);
  }

  return new Response(new Uint8Array(out), {
    headers: {
      'Content-Type': 'image/webp',
      // A week in the browser, a year at the CDN: a replaced logo gets a new
      // address, so an old copy is never wrong.
      'Cache-Control': 'public, max-age=604800, s-maxage=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * School logos, served from primetime-nexus.com with caching that holds.
 *
 * The logos live in Supabase storage (the public `Logos` bucket), and most of
 * them were stored with `Cache-Control: no-cache`: every time the live results
 * page redrew a row - every second or two during a race - a phone asked the
 * storage again for each school's logo, and on a car park's signal some of
 * those answers did not come back in time and the logo went blank.
 *
 * This hands the same file on with a long cache, so a phone fetches each logo
 * once and the CDN answers everybody after the first. A logo replaced from the
 * dashboard gets a new path (upload-logo.ts), so a long cache costs nothing.
 *
 * Only the Logos bucket, and only a path within it. SVGs are served with a
 * policy that stops them running anything if opened directly: they come from
 * scrapes of school sites, and this is our own origin.
 */

const BUCKET = 'Logos';
const ALLOWED = /^[A-Za-z0-9._\-/ ]+$/;

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const key = (path ?? []).map((p) => decodeURIComponent(p)).join('/');
  if (!key || key.includes('..') || !ALLOWED.test(key)) {
    return new Response('Not found', { status: 404 });
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return new Response('Not configured', { status: 500 });

  const upstream = await fetch(
    `${base.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`,
    { cache: 'no-store' },
  ).catch(() => null);
  if (!upstream || !upstream.ok) {
    // A missing logo is worth remembering for a while too, but not for a week.
    return new Response('Not found', {
      status: upstream?.status === 404 || upstream?.status === 400 ? 404 : 502,
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    });
  }

  const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (!/^image\//.test(type)) return new Response('Not found', { status: 404 });

  return new Response(upstream.body, {
    headers: {
      'Content-Type': type,
      // A week in the browser, a month at the CDN, and yesterday's copy while
      // a fresh one is fetched.
      'Cache-Control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

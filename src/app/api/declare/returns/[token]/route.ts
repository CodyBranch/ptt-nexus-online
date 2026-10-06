import { NextRequest, NextResponse } from 'next/server';
import { recordReturn, returnsSession, returnsView, scratchFromScan, undoReturn } from '@/lib/declare-returns';

// ── /api/declare/returns/[token] ─────────────────────────────────────────────
//
// The bib-return desk. The token in the path is the only key, as on the
// dashboard.
//
//   GET  ?bib=214                 a scan - what RaceResult's TagTool calls. The
//   GET  ?tag=10101&device=desk1  code may be the bib or any of the runner's
//                                 tags; tag, chip, code, transponder and id
//                                 are read the same as bib. Answers in one
//                                 line of text, for the scanner's log, or
//                                 JSON with &format=json.
//   POST (the same parameters)    the same, for a scanner that posts.
//   GET  (no code)                the staff page's view, as JSON.
//   POST { action, ... }          the staff page: 'manual' (code), 'undo' (id),
//                                 'scratch' (id - scratch the runner whose bib
//                                 came back without an online scratch).

export const dynamic = 'force-dynamic';

const CODE_PARAMS = ['bib', 'tag', 'chip', 'code', 'transponder', 'id', 'b'];
const DEVICE_PARAMS = ['device', 'reader', 'station', 'name'];
const noStore = { 'Cache-Control': 'no-store' };

const first = (get: (k: string) => string | null | undefined, keys: string[]) => {
  for (const k of keys) {
    const v = get(k);
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return null;
};

async function scan(token: string, get: (k: string) => string | null | undefined) {
  const session = await returnsSession(token);
  if (!session) return new NextResponse('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const json = (get('format') ?? '').toLowerCase() === 'json';
  const code = first(get, CODE_PARAMS);
  if (code == null) {
    return NextResponse.json(await returnsView(session), { headers: noStore });
  }
  const result = await recordReturn(session, code, { via: 'scan', device: first(get, DEVICE_PARAMS) });
  if (json) return NextResponse.json(result, { headers: noStore });
  // TagTool keeps the response in its log: the outcome first, in capitals, so
  // a glance down the log finds the ones staff need to look at.
  const word = {
    returned: 'OK', already_returned: 'ALREADY', not_scratched: 'CHECK', unknown_bib: 'UNKNOWN', ambiguous: 'CHECK',
  }[result.status];
  return new NextResponse(`${word} ${result.message}\n`, { headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const q = request.nextUrl.searchParams;
    return await scan(token, (k) => q.get(k));
  } catch (e) {
    console.error('[declare] returns GET:', e);
    return new NextResponse('ERROR the scan was not recorded\n', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const q = request.nextUrl.searchParams;
    const type = request.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) {
      // A scanner posting a form, or nothing but the query string.
      const form = type.includes('form') ? await request.formData() : null;
      return await scan(token, (k) => q.get(k) ?? (form?.get(k) as string | null | undefined));
    }

    const session = await returnsSession(token);
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { action?: string; code?: string; id?: string };
    if (body.action === 'manual') {
      return NextResponse.json(await recordReturn(session, body.code, { via: 'manual', device: 'staff page' }), { headers: noStore });
    }
    if (body.action === 'undo' && body.id) {
      return NextResponse.json({ ok: await undoReturn(session, body.id) }, { headers: noStore });
    }
    if (body.action === 'scratch' && body.id) {
      return NextResponse.json({ ok: await scratchFromScan(session, body.id) }, { headers: noStore });
    }
    return NextResponse.json({ error: 'action must be manual, undo or scratch' }, { status: 400 });
  } catch (e) {
    console.error('[declare] returns POST:', e);
    return NextResponse.json({ error: 'The scan was not recorded' }, { status: 500 });
  }
}

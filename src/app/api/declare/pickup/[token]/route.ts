import { NextRequest, NextResponse } from 'next/server';
import {
  pickupSession, pickupView, recordPickup, recordScan, signatureOf, signPickups, undoPickup, type PickupResult,
} from '@/lib/declare-pickup';

// ── /api/declare/pickup/[token] ──────────────────────────────────────────────
//
// The packet table. The token in the path is the only key, as on the bib
// returns desk.
//
//   GET  ?code=NXPKT-...-F           a scan from a scanner app that calls a URL:
//   GET  ?code=...&device=gun1       marks the packet picked up. Answers in one
//                                    line of text for the scanner's log, or JSON
//                                    with &format=json.
//   GET  ?signature=<id>             a pickup's signature, as a PNG.
//   GET  (nothing)                   the staff page's view, as JSON.
//   POST { action, ... }             the staff and sign-off pages:
//     'scan'   { code, by?, signature?, wait?, device? }
//     'manual' { teamAccessId, side, by?, signature?, wait?, device? }
//     'sign'   { ids, by, signature }  the coach signs on the sign-off tablet
//     'undo'   { id }

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const text = (body: string, status = 200) =>
  new NextResponse(body, { status, headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8' } });

const WORD: Record<PickupResult['status'], string> = { picked_up: 'OK', waiting: 'SIGN', already: 'ALREADY', unknown: 'CHECK' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const session = await pickupSession(token);
    if (!session) return text('Not found\n', 404);
    const q = request.nextUrl.searchParams;

    const sigId = q.get('signature');
    if (sigId) {
      const data = await signatureOf(session, sigId);
      if (!data) return text('No signature\n', 404);
      return new NextResponse(Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'), {
        headers: { ...noStore, 'Content-Type': 'image/png' },
      });
    }

    const code = q.get('code') ?? q.get('bib') ?? q.get('tag');
    if (!code) return NextResponse.json(await pickupView(session), { headers: noStore });
    const result = await recordScan(session, code, { via: 'scan', device: q.get('device') ?? q.get('station') });
    if ((q.get('format') ?? '').toLowerCase() === 'json') return NextResponse.json(result, { headers: noStore });
    return text(`${WORD[result.status]} ${result.message}\n`);
  } catch (e) {
    console.error('[declare] pickup GET:', e);
    return text('ERROR the scan was not recorded\n', 500);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const session = await pickupSession(token);
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = await request.json().catch(() => ({})) as {
      action?: string; code?: string; teamAccessId?: string; side?: string;
      by?: string; signature?: string; wait?: boolean; device?: string; ids?: string[]; id?: string;
    };
    const opts = { by: body.by, signature: body.signature, wait: body.wait === true, device: body.device };

    if (body.action === 'scan') {
      return NextResponse.json(await recordScan(session, body.code, { ...opts, via: 'scan' }), { headers: noStore });
    }
    if (body.action === 'manual' && body.teamAccessId && ['F', 'M', 'X', 'A'].includes(body.side ?? '')) {
      return NextResponse.json(
        await recordPickup(session, { teamAccessId: body.teamAccessId, side: body.side as 'F' | 'M' | 'X' | 'A' }, { ...opts, via: 'manual' }),
        { headers: noStore },
      );
    }
    if (body.action === 'sign' && Array.isArray(body.ids)) {
      const ok = await signPickups(session, body.ids.map(String).slice(0, 10), body.by, body.signature);
      return ok ? NextResponse.json({ ok }, { headers: noStore }) : NextResponse.json({ error: 'A name or a signature is needed' }, { status: 400 });
    }
    if (body.action === 'undo' && body.id) {
      return NextResponse.json({ ok: await undoPickup(session, body.id) }, { headers: noStore });
    }
    return NextResponse.json({ error: 'action must be scan, manual, sign or undo' }, { status: 400 });
  } catch (e) {
    console.error('[declare] pickup POST:', e);
    return NextResponse.json({ error: 'The pickup was not recorded' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { pullRankings } from '@/lib/rankings/pull';

/**
 * The daily read of the USTFCCCA's polls and rankings, run by Vercel Cron.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET set
 * this refuses everyone rather than running for anybody who finds the
 * address: a pull is harmless, but the endpoint is not ours to open. "Pull
 * now" on the dashboard is a server action and does not come through here.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const outcome = await pullRankings('cron');
  return NextResponse.json(outcome, { status: outcome.status === 'failed' ? 502 : 200 });
}

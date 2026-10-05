import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { dashboardSession, loadDashboard } from '@/lib/declare-dashboard';
import DashboardView from './DashboardView';

/**
 * The live declarations dashboard: a meet's declarations as they come in,
 * for the meet director's laptop or a screen at the desk.
 *
 * Outside the login on purpose - it is opened by whoever was given the link,
 * the way a coach opens their form - and reachable only by that link. The
 * first draw happens here, so the page is complete before any script runs;
 * from then on the view keeps itself current (DashboardView).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const session = await dashboardSession((await params).token);
  return { title: session ? `${session.meetName} - Declarations` : 'Declarations', robots: { index: false, follow: false } };
}

export default async function DeclarationsDashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await dashboardSession(token);
  if (!session) notFound();
  const data = await loadDashboard(session);
  return <DashboardView token={token} initial={data} />;
}

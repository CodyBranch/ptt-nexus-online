import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { returnsSession, returnsView } from '@/lib/declare-returns';
import ReturnsView from './ReturnsView';

/**
 * The bib-return desk: every scratched runner's bib, back or still out, and
 * each scan as it lands - from TagTool, or typed in here.
 *
 * Outside the login like the dashboard, and reachable only by its link.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const session = await returnsSession((await params).token);
  return { title: session ? `${session.meetName} - Bib returns` : 'Bib returns', robots: { index: false, follow: false } };
}

export default async function BibReturnsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await returnsSession(token);
  if (!session) notFound();
  const data = await returnsView(session);
  return <ReturnsView token={token} initial={{ ...data, generatedAt: new Date().toISOString() }} />;
}

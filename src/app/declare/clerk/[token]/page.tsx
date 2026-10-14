import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { clerkSession, clerkView } from '@/lib/declare-clerk';
import ClerkView from './ClerkView';

/**
 * The clerks' page: every race, each school's start box, and every runner's
 * bib and status, for clerks and line clerks on a phone or tablet. Read-only;
 * the meet desk keeps it current.
 *
 * Outside the login like the dashboard, and reachable only by its link.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const session = await clerkSession((await params).token);
  return { title: session ? `${session.meetName} - Clerks` : 'Clerks', robots: { index: false, follow: false } };
}

export default async function ClerkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await clerkSession(token);
  if (!session) notFound();
  return <ClerkView token={token} initial={await clerkView(session)} />;
}

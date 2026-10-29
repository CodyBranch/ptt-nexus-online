import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pickupSession, pickupView } from '@/lib/declare-pickup';
import PickupView from './PickupView';

/**
 * The packet table: every school's packets, scanned from the team labels'
 * codes or marked by hand, with who took them and their signature when the
 * table asks.
 *
 * Outside the login like the bib returns desk, and reachable only by its link.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const session = await pickupSession((await params).token);
  return { title: session ? `${session.meetName} - Packet pickup` : 'Packet pickup', robots: { index: false, follow: false } };
}

export default async function PacketPickupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await pickupSession(token);
  if (!session) notFound();
  const terms = session.genderTerms === 'men_women' ? 'men_women' : 'boys_girls';
  return <PickupView token={token} terms={terms} initial={await pickupView(session)} />;
}

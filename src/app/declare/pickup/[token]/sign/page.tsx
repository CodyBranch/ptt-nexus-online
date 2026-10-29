import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pickupSession, pickupView } from '@/lib/declare-pickup';
import SignView from './SignView';

/**
 * The sign-off tablet: faces the coach at the packet table, and shows each
 * packet scanned at a station set to "signed on the sign-off tablet" until
 * the coach signs for it.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const session = await pickupSession((await params).token);
  return { title: session ? `${session.meetName} - Sign for packets` : 'Sign for packets', robots: { index: false, follow: false } };
}

export default async function PacketSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await pickupSession(token);
  if (!session) notFound();
  const terms = session.genderTerms === 'men_women' ? 'men_women' : 'boys_girls';
  return <SignView token={token} terms={terms} initial={await pickupView(session)} />;
}

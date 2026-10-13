import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { contactsSession, contactsSchools, consentText, COACH_ROLES } from '@/lib/coach-contacts';
import SignupView from './SignupView';

/**
 * Coach sign-up for the meet's texts: one link for every coach in the meet.
 * Pick your school, leave your name, role, email and mobile, agree to the
 * texts, and a text back confirms it.
 *
 * Outside the login like the coach form, and reachable only by its link.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const session = await contactsSession((await params).token);
  return { title: session ? `${session.meetName} - Coach texts` : 'Coach texts', robots: { index: false, follow: false } };
}

export default async function CoachSignupPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const { token } = await params;
  const session = await contactsSession(token);
  if (!session) notFound();
  const schools = await contactsSchools(session.id);
  const { team } = await searchParams;
  return (
    <SignupView
      token={token}
      meetName={session.meetName}
      meetDate={session.meetDate}
      consent={consentText(session.meetName)}
      schools={schools}
      roles={COACH_ROLES}
      initialTeam={schools.some((s) => s.id === team) ? team! : null}
    />
  );
}

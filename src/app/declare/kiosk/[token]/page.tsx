import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { kioskSession } from '@/lib/declare-kiosk';

/**
 * Where a meet's tablet code lands when a phone camera opens it instead of
 * the PTT Nexus Tablet app: say what the code is for, and open nothing.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Meet tablet code', robots: { index: false, follow: false } };

export default async function KioskCodePage({ params }: { params: Promise<{ token: string }> }) {
  const session = await kioskSession((await params).token);
  if (!session) notFound();
  return (
    <main className="min-h-screen bg-gray-950 px-6 py-16 text-gray-100">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">{session.meetName}</h1>
        <p className="text-gray-300">
          This code is for the meet&apos;s tablets. Scan it in the PTT Nexus Tablet app, under Declarations, to add the
          meet to a tablet.
        </p>
        <p className="text-sm text-gray-500">Coaches: your school&apos;s own link is in the email or text from the meet.</p>
      </div>
    </main>
  );
}

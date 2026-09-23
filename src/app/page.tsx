import Image from 'next/image';
import type { Metadata } from 'next';

/**
 * What a stranger sees.
 *
 * Deliberately close to nothing: a name, what the company does in one line,
 * and a way to get in touch. No mention of what the system holds, what it is
 * called inside, which meets it runs or that there is an organisation
 * database behind it — an address somebody has guessed should not tell them
 * what is worth guessing next.
 *
 * The way in is a quiet link rather than a form. Anybody who belongs here
 * knows to look for it, and a password box on a public page is an invitation
 * to try passwords in it.
 */
export const metadata: Metadata = {
  title: 'PrimeTime Timing',
  description: 'Race timing and results.',
  robots: { index: false, follow: false },
};

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-lg text-center">
          <Image
            src="/PRIMETIME.png"
            alt="PrimeTime Timing"
            width={1586}
            height={250}
            priority
            className="w-full max-w-xs mx-auto h-auto mb-10"
          />

          <p className="text-gray-400 leading-relaxed">
            Race timing, scoring and live results for cross country and track meets.
          </p>

          <p className="mt-6 text-sm text-gray-500">
            For timing enquiries, get in touch at{' '}
            <a
              href="mailto:info@pttiming.com"
              className="text-gray-300 hover:text-gray-100 underline underline-offset-4 decoration-gray-700 transition-colors"
            >
              info@pttiming.com
            </a>
            .
          </p>
        </div>
      </div>

      <footer className="px-6 py-6 flex items-center justify-center gap-4 text-xs text-gray-700">
        <span>&copy; {new Date().getFullYear()} PrimeTime Timing</span>
        <span aria-hidden>&middot;</span>
        <a href="/login" className="hover:text-gray-500 transition-colors">
          Staff sign in
        </a>
      </footer>
    </main>
  );
}

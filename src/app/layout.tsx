import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PrimeTime Timing',
  description: 'Race timing and results.',
  // Nothing under here wants finding in a search: the public page has nothing
  // worth indexing and everything else is behind a sign-in.
  robots: { index: false, follow: false },
};

/**
 * Stated rather than left to the default, for the coach portal: cover lets the
 * page paint into the notch and the home bar, which the portal then insets
 * itself against. Pinch zoom is deliberately not capped — a coach reading a
 * roster in the sun may well want it.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}

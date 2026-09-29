import Image from 'next/image';
import type { Metadata } from 'next';

/**
 * How the coach portal works: the tutorial video, and the same steps in words.
 *
 * Linked from every coach's form. Public, like the form itself, and dressed
 * the same — same dark ground, same narrow column — because it is read on the
 * same phone. The steps are written out too: a coach in a car park with the
 * sound off should not have to play a video to find the Finalize button.
 */

export const metadata: Metadata = {
  title: 'How the coach portal works — PrimeTime',
  description: 'Declaring and scratching your runners from a phone, and how it reaches the timing tent.',
};

const VIDEO_ID = 'jTF6RMzQErU';

const STEPS: Array<{ title: string; body: string }> = [
  { title: 'Scan the code', body: 'Your link is printed as a QR code on your Team Roster and Declaration Form. Point your phone’s camera at it. There is no app and no login, and the link opens your school and nothing else.' },
  { title: 'Find your squad', body: 'Every runner is listed with the races they can run and when each race closes. The count at the top shows who still needs an answer. Use Men and Women to narrow the list.' },
  { title: 'Tap the race each runner is in', body: 'It saves the moment you tap; there is no Submit button. Tap a different race to move a runner, for example to the Open.' },
  { title: 'Tap Not running to scratch', body: 'You can change any answer until that race closes.' },
  { title: 'Confirm the rest', body: 'Runners already entered by the meet can be confirmed as running all at once with the Confirm button on the race.' },
  { title: 'Finalize each race', body: 'When a race is done, tap Finalize. That locks it in; Reopen it if something changes before it closes.' },
  { title: 'That’s it', body: 'Your answers reach the meet’s timing system within about a minute. After a race closes, changes go through the meet office.' },
];

export default function DeclareHelpPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-white">How the coach portal works</h1>
          <Image src="/PRIMETIME.png" alt="PrimeTime Timing" width={1586} height={250} priority
            className="h-4 w-auto shrink-0 opacity-90" />
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        <div className="relative w-full overflow-hidden rounded-xl border border-gray-800 bg-black" style={{ aspectRatio: '16 / 9' }}>
          {/* youtube-nocookie: no tracking cookies until the coach presses play. */}
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0&modestbranding=1&playsinline=1`}
            title="How the coach portal works"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Step by step</h2>
          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 rounded-lg border border-gray-800 bg-gray-900/60 p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-sm font-bold text-blue-300">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold text-white">{s.title}</p>
                  <p className="mt-0.5 text-sm text-gray-400">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <p className="text-xs text-gray-500">
          This page is the same for every school. Your own form is the link on your roster; if you have lost it,
          ask the meet office for it.
        </p>
      </main>
    </div>
  );
}

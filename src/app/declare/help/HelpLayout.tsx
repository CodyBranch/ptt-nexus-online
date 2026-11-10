import Image from 'next/image';
import type { ReactNode } from 'react';

/**
 * The coach portal's help pages: the tutorial video, and the same steps in
 * words.
 *
 * Public, like the form itself, and dressed the same — same dark ground,
 * same narrow column — because it is read on the same phone. The steps are
 * written out too: a coach in a car park with the sound off should not have
 * to play a video to find the Finalize button.
 *
 * Two of them, one per way a meet declares: every runner chosen by the
 * coach (/declare/help), or entered runners and alternates who come in only
 * by a swap (/declare/help-alternate). The form links to the one its meet
 * uses.
 */
export interface HelpStep {
  title: string;
  body: string;
}

export default function HelpLayout({ title, videoId, steps, aside }: {
  title: string;
  /** YouTube id; no video frame until there is one. */
  videoId: string | null;
  steps: HelpStep[];
  /** A pointer to the other help page, under the video. */
  aside?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-white">{title}</h1>
          <Image src="/PRIMETIME.png" alt="PrimeTime Timing" width={1586} height={250} priority
            className="h-4 w-auto shrink-0 opacity-90" />
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {videoId && (
          <div className="relative w-full overflow-hidden rounded-xl border border-gray-800 bg-black" style={{ aspectRatio: '16 / 9' }}>
            {/* youtube-nocookie: no tracking cookies until the coach presses play. */}
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`}
              title={title}
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        )}

        {aside}

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Step by step</h2>
          <ol className="space-y-3">
            {steps.map((s, i) => (
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

/** "At a meet with alternates? …", a card linking across. */
export function OtherHelp({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href}
      className="block rounded-lg border border-violet-600/40 bg-violet-500/10 px-4 py-3 text-sm text-violet-100 hover:border-violet-500/70">
      {children}
    </a>
  );
}

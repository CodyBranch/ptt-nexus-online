import type { Metadata } from 'next';
import HelpLayout, { OtherHelp, type HelpStep } from '../help/HelpLayout';

/**
 * How the coach portal works at a meet with entered runners and alternates:
 * each school's runners in a race hold real bibs, the rest of the squad are
 * alternates with none, and an alternate comes in only by a swap. The form
 * links here when its school has alternates; /declare/help is the other way.
 */

export const metadata: Metadata = {
  title: 'Alternates on the coach portal — PrimeTime',
  description: 'Confirming your entered runners, swapping an alternate in on a runner’s bib, and how it reaches the timing tent.',
};

/** The alternates tutorial on YouTube; the steps stand on their own until it is up. */
const VIDEO_ID: string | null = null;

const STEPS: HelpStep[] = [
  { title: 'Scan the code', body: 'Your link is printed as a QR code on your Team Roster and Declaration Form. Point your phone’s camera at it. There is no app and no login, and the link opens your school and nothing else.' },
  { title: 'Find your entered runners', body: 'Each runner entered in a race is listed with their bib and when the race closes. The count at the top shows who still needs an answer. Use Men and Women to narrow the list.' },
  { title: 'Tap the race to confirm', body: 'Tap the race on a runner’s card to confirm they are running. It saves the moment you tap; there is no Submit button.' },
  { title: 'Swap in an alternate', body: 'Tap Swap in an alternate on the card of the runner the alternate goes in for, and pick who goes in. The alternate runs on that runner’s bib and in their place, so hand the bib over before the race.' },
  { title: 'Not running? Still swap', body: 'Tap Not running for a runner who won’t run. Their place and bib are free: Swap in an alternate stays on their card. Left alone, hand their bib in at the meet office.' },
  { title: 'Undo a swap', body: 'Undo swap puts the runner back in, until the race closes or you finalize it. A runner swapped out can go in for someone else instead.' },
  { title: 'Your alternates', body: 'Listed at the bottom of the form, with no bib. They come in only by a swap, and a runner swapped out joins them.' },
  { title: 'Confirm the rest', body: 'Everyone still marked as entered can be confirmed as running all at once with the Confirm button on the race.' },
  { title: 'Finalize each race', body: 'When a race is set, tap Finalize. That locks it in; Reopen it if something changes before it closes.' },
  { title: 'That’s it', body: 'Your answers and swaps reach the meet’s timing system within about a minute: the alternate in the race on the runner’s bib, the runner back with the alternates. After a race closes, changes go through the meet office.' },
];

export default function DeclareAlternatesHelpPage() {
  return (
    <HelpLayout
      title="Alternates on the coach portal"
      videoId={VIDEO_ID}
      steps={STEPS}
      aside={(
        <OtherHelp href="/declare/help">
          <span className="font-semibold">No alternates at your meet?</span>{' '}
          If you choose every runner’s race yourself, see how the coach portal works →
        </OtherHelp>
      )}
    />
  );
}

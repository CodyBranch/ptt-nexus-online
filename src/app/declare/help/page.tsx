import type { Metadata } from 'next';
import HelpLayout, { OtherHelp, type HelpStep } from './HelpLayout';

/**
 * How the coach portal works at a meet where the coach chooses every
 * runner's race. A meet with entered runners and alternates has its own page
 * (/declare/help-alternate); the form links to the right one.
 */

export const metadata: Metadata = {
  title: 'How the coach portal works — PrimeTime',
  description: 'Declaring and scratching your runners from a phone, and how it reaches the timing tent.',
};

const VIDEO_ID = 'jTF6RMzQErU';

const STEPS: HelpStep[] = [
  { title: 'Scan the code', body: 'Your link is printed as a QR code on your Team Roster and Declaration Form. Point your phone’s camera at it. There is no app and no login, and the link opens your school and nothing else.' },
  { title: 'Find your squad', body: 'Every runner is listed with the races they can run and when each race closes. The count at the top shows who still needs an answer. Use Men and Women to narrow the list.' },
  { title: 'Tap the race each runner is in', body: 'It saves the moment you tap; there is no Submit button. Tap a different race to move a runner, for example to the Open.' },
  { title: 'Tap Not running to scratch', body: 'You can change any answer until that race closes.' },
  { title: 'Swap in an alternate', body: 'At some meets, runners not in a race are listed as Alternates, with no bib. To run one, tap Swap in an alternate on an entered runner’s card and pick who goes in. The alternate runs on that runner’s bib, so hand it over. See how alternates work, below.' },
  { title: 'Confirm the rest', body: 'Runners already entered by the meet can be confirmed as running all at once with the Confirm button on the race.' },
  { title: 'Finalize each race', body: 'When a race is done, tap Finalize. That locks it in; Reopen it if something changes before it closes.' },
  { title: 'That’s it', body: 'Your answers reach the meet’s timing system within about a minute. After a race closes, changes go through the meet office.' },
];

export default function DeclareHelpPage() {
  return (
    <HelpLayout
      title="How the coach portal works"
      videoId={VIDEO_ID}
      steps={STEPS}
      aside={(
        <OtherHelp href="/declare/help-alternate">
          <span className="font-semibold">At a meet with alternates?</span>{' '}
          Your squad’s runners not in a race come in only by a swap. See how alternates work →
        </OtherHelp>
      )}
    />
  );
}

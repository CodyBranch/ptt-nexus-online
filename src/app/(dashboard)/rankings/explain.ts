/**
 * What to tell a person when an action did not get through.
 *
 * Each deploy renames the server actions, so a tab opened before one calls an
 * action that no longer exists, and the click used to vanish without a word.
 */
export function explainFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/server action/i.test(msg)) return 'This page is out of date: Nexus Online has been updated since it was opened. Reload the page and try again.';
  return `That did not get through (${msg}). Reload the page and try again.`;
}

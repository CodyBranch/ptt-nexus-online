/**
 * What is actually in organizations.logo_url.
 *
 * The column was populated by scrapes, and two kinds of value in it will never
 * be a logo on the timing laptop:
 *
 *  - relative paths ("../Resources/UploadedFiles/Logos/....jpg") with no scheme
 *    or host, which resolve against whatever page happens to load them — i.e.
 *    nowhere, once the desktop app reads the URL out of GET /api/organizations;
 *  - MSHSAA's "NO IMAGE AVAILABLE" placeholder JPEG, which loads fine and draws
 *    a white square. It is a logo-shaped way of saying there is no logo.
 *
 * Both are worth showing as what they are rather than rendering and hoping.
 */
/**
 * MSHSAA's placeholder, matched the way the desktop matches it.
 *
 * This has to be the SAME rule as logo-cache.ts in the desktop app, because
 * that one decides whether a badge is ever downloaded and this one only
 * decides what the admin is told. A looser rule here warns about real logos;
 * a tighter one tells an admin a URL is fine while the laptop quietly refuses
 * it, which is worse — they would see nothing wrong and change nothing.
 *
 * So: the FILENAME, with the hyphen optional, and a query string allowed
 * after it. A plain substring test flagged 'no-logo-academy/badge.png' and
 * cleared 'NoLogo.png', getting it wrong in both directions.
 */
const PLACEHOLDER = /(^|\/)No-?Logo\.[a-z]+($|\?)/i;
export type LogoUrlKind = 'empty' | 'relative' | 'placeholder' | 'ok';

export function classifyLogoUrl(url: string | null | undefined): LogoUrlKind {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return 'empty';
  if (!/^https?:\/\//i.test(trimmed)) return 'relative';
  if (PLACEHOLDER.test(trimmed)) return 'placeholder';
  return 'ok';
}

export const LOGO_URL_WARNINGS: Record<Exclude<LogoUrlKind, 'empty' | 'ok'>, string> = {
  relative: 'Not a full URL — no scheme or host, so this can never load on the timing laptop. Needs https://…',
  placeholder: 'This is the MSHSAA "no image available" placeholder, not a logo. It renders as a white square.',
};

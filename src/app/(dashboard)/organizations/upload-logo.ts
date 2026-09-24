'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/admin-auth';

/**
 * Put a logo file in our own storage and hand back its address.
 *
 * Until now the only way to give a school a badge was to paste a URL to
 * somebody else's web server, which is how 3,700 addresses ended up pointing
 * at mshsaa.org and ncaa.com. That works right up to the day one of them
 * reorganises, and it means a school with no badge anywhere on the internet
 * can never have one at all.
 *
 * Files go to `custom/` in the Logos bucket, beside the `mshsaa/` and `ncaa/`
 * folders the bulk imports landed in. Keeping the source visible in the path
 * is worth more than it looks: when a whole association's badges need
 * replacing, the folder says which ones they are, and a hand-uploaded one is
 * not swept up with them.
 */

const BUCKET = 'Logos';

/** What a browser will draw. A bucket that accepts anything is a bucket that ends up holding anything. */
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
};

/**
 * Two megabytes.
 *
 * Generous for a badge — the cleaned-up PNGs average eight kilobytes — and
 * small enough that nobody uploads a print-resolution crest that every timing
 * laptop then downloads over a venue hotspot.
 */
const MAX_BYTES = 2 * 1024 * 1024;

export type UploadResult =
  | { ok: true; url: string; bytes: number }
  | { ok: false; error: string };

/** A filename that is safe in a URL and still says which school it belongs to. */
function slugify(s: string): string {
  return (s || 'logo')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'logo';
}

export async function uploadOrgLogo(form: FormData): Promise<UploadResult> {
  await requireAdmin();

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'No file was chosen' };

  const ext = ALLOWED[file.type];
  if (!ext) {
    return { ok: false, error: `${file.type || 'That file'} is not an image type we serve. Use PNG, JPEG, WebP, SVG or GIF.` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB — a badge should be far smaller.` };
  }

  const name = slugify(String(form.get('orgName') ?? 'logo'));
  const variant = String(form.get('variant') ?? 'light');
  const safeVariant = variant === 'dark' || variant === 'wordmark' ? variant : 'light';

  // A new name every upload, rather than overwriting.
  //
  // The address is what gets cached — by Supabase's CDN, by every browser, and
  // by each timing laptop's own logo cache. Reusing a path after replacing the
  // image means everything that already has it keeps the old picture and
  // nothing can tell. A fresh name makes a replacement a different address,
  // which misses every one of those caches on purpose.
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const key = `custom/${name}-${safeVariant}-${stamp}.${ext}`;

  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) return { ok: false, error: `Storage refused the upload: ${error.message}` };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  if (!data?.publicUrl) return { ok: false, error: 'The file uploaded but storage returned no public address for it' };

  return { ok: true, url: data.publicUrl, bytes: file.size };
}

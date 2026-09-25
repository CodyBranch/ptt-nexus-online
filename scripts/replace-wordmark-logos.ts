/**
 * Swap five wordmark badges for the mark itself.
 *
 * The first pass took whatever each school published as its primary logo, and
 * for these five that was a lockup: an emblem beside the school's name set in
 * type. At the size a badge is actually drawn — twenty-eight pixels in a list
 * of two hundred — the emblem is a few pixels wide and the name is a grey
 * smear, so the row reads as having no badge at all.
 *
 * Two of them were worse than that. Columbia's monogram and Iowa Western's
 * Reiver are reversed artwork, white on nothing, which on the white tile the
 * desktop draws badges on is invisible.
 *
 * So: the emblem cut out of its own lockup, and a positive made of the two
 * reversed ones. Nothing is redrawn — every mark here is the school's own
 * artwork, cropped, or recoloured to the school's own brand colour.
 *
 * NEW FILENAMES, deliberately. The address is what gets cached — by Supabase's
 * CDN, by every browser, and by each timing laptop's own logo cache, which
 * keys on a hash of the URL. Replacing the file at a path everybody already
 * holds means everybody keeps the old picture and nothing can tell.
 *
 *   npx tsx scripts/replace-wordmark-logos.ts            (dry run)
 *   npx tsx scripts/replace-wordmark-logos.ts --apply
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const DIR = process.env.CLEAN_LOGO_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/logos/clean';

interface Swap {
  org: string;
  /** What was wrong with the one it is replacing. */
  why: string;
  light?: string;
  dark?: string;
}

const SWAPS: Swap[] = [
  {
    org: 'Baker University',
    why: 'crest was a few pixels wide beside BAKER UNIVERSITY in type',
    light: 'baker-crest.svg',
  },
  {
    org: 'Doane University',
    why: 'was the DOANE UNIVERSITY wordmark; the 1872 shield is the mark',
    light: 'doane-shield.svg',
  },
  {
    org: 'Columbia College (Mo.)',
    why: 'monogram was reversed artwork — invisible on a white tile',
    light: 'columbia-cc-light.svg',
  },
  {
    org: 'Colby Community College',
    why: 'eagle was beside COLBY COMMUNITY COLLEGE in type',
    light: 'colby-eagle.png',
  },
  {
    org: 'Iowa Western Community College',
    why: 'Reiver sat above REIVERS in type, and was reversed artwork',
    light: 'iowa-western-face.png',
    dark: 'iowa-western-face-dark.png',
  },
];

const MIME: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg',
};

import('../src/db/client').then(async ({ db }) => {
  const { organizations } = await import('../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { createAdminClient } = await import('../src/lib/supabase/admin');
  const supabase = APPLY ? createAdminClient() : null;

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');
  const problems: string[] = [];
  let swapped = 0;

  for (const s of SWAPS) {
    const rows = await db.select().from(organizations).where(eq(organizations.name, s.org));
    const org = rows[0];
    if (!org) { problems.push(`no organisation named "${s.org}"`); continue; }

    const put = async (file: string) => {
      const path = join(DIR, file);
      if (!existsSync(path)) { problems.push(`missing ${path}`); return null; }
      const key = `naia/${file}`;
      if (!APPLY || !supabase) return `Logos/${key}`;
      const ext = file.split('.').pop()!.toLowerCase();
      const { error } = await supabase.storage.from('Logos')
        .upload(key, readFileSync(path), {
          contentType: MIME[ext], cacheControl: '31536000', upsert: true,
        });
      if (error) { problems.push(`upload failed for ${file}: ${error.message}`); return null; }
      return supabase.storage.from('Logos').getPublicUrl(key).data.publicUrl;
    };

    const patch: Record<string, string> = {};
    if (s.light) { const u = await put(s.light); if (u) patch.logoUrl = u; }
    if (s.dark) { const u = await put(s.dark); if (u) patch.logoDarkUrl = u; }

    const was = (org.logoUrl ?? '').split('/').pop() ?? '(none)';
    console.log(`  ${s.org}`);
    console.log(`     was  ${was}   — ${s.why}`);
    console.log(`     now  ${s.light ?? '(unchanged)'}${s.dark ? ' + ' + s.dark + ' (dark)' : ''}`);

    if (APPLY && Object.keys(patch).length) {
      await db.update(organizations)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(organizations.id, org.id));
    }
    swapped++;
  }

  console.log('');
  console.log(`${swapped} of ${SWAPS.length} swapped`);
  if (problems.length) { console.log('PROBLEMS:'); problems.forEach((p) => console.log('   ' + p)); }
  process.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });

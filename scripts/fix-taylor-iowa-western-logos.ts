/**
 * Two badges that do not survive being drawn small.
 *
 * Taylor had one file and it was reversed artwork — white type beside a gold
 * shield, made for a dark background — sitting in logoDarkUrl with logoUrl
 * empty. The desktop draws badges on a white tile, so there was nothing to
 * see: the school read as having no logo at all. Two things were wrong and
 * both are fixed here. The lockup is 3.4:1, which at 26px is a smear, so the
 * shield is cut out of it — the shield is the mark. And a light version is
 * made by recolouring the reversed white to Taylor's own purple, which is the
 * same treatment the earlier pass used on Columbia and Iowa Western.
 *
 * Iowa Western's Reiver was already a positive, and still came out small: the
 * file is 270x113 and the artwork is only 159 of that width, so 41% of the
 * frame is empty. Badges are drawn in a SQUARE box with object-fit contain,
 * which fits the FRAME's 2.39:1 aspect — the mark landed about 15px across
 * inside a 26px tile. Trimmed to its own artwork it fills the tile.
 *
 * Nothing is redrawn. Every mark here is the school's own artwork, cropped,
 * or recoloured to the school's own brand colour.
 *
 * NEW FILENAMES, deliberately — see replace-wordmark-logos.ts. The address is
 * what gets cached, by Supabase's CDN, by every browser, and by each timing
 * laptop's own logo cache, which keys on a hash of the URL. Replacing the file
 * at a path everybody already holds means everybody keeps the old picture and
 * nothing can tell.
 *
 *   npx tsx scripts/fix-taylor-iowa-western-logos.ts            (dry run)
 *   npx tsx scripts/fix-taylor-iowa-western-logos.ts --apply
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const DIR = process.env.CLEAN_LOGO_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/logos-fix';

interface Swap {
  org: string;
  why: string;
  light?: string;
  dark?: string;
}

const SWAPS: Swap[] = [
  {
    org: 'Taylor University',
    why: 'only file was reversed white type on a dark-made lockup, and it sat in the dark slot with the light one empty — nothing showed on a white tile',
    light: 'taylor-shield.png',
    dark: 'taylor-shield-dark.png',
  },
  {
    org: 'Iowa Western Community College',
    why: '41% of the frame was empty padding, so the Reiver drew at about 15px inside a 26px tile',
    light: 'iowa-western-reiver.png',
    dark: 'iowa-western-reiver-dark.png',
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

    const wasLight = (org.logoUrl ?? '').split('/').pop() || '(none)';
    const wasDark = (org.logoDarkUrl ?? '').split('/').pop() || '(none)';
    console.log(`  ${s.org}`);
    console.log(`     was  light ${wasLight} · dark ${wasDark}`);
    console.log(`          — ${s.why}`);
    console.log(`     now  light ${s.light ?? '(unchanged)'} · dark ${s.dark ?? '(unchanged)'}`);

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

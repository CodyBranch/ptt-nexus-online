// The org tag tree, with each tag's kind and how the schools under it are
// typed. Read-only. Run with:  npx tsx scripts/inspect-org-tags.ts

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import('../src/db/client').then(async ({ db }) => {
  const { orgTags, organizationTags, organizations } = await import('../src/db/schema');
  const { asc, sql, eq } = await import('drizzle-orm');

  const rows = await db.select({
    id: orgTags.id, kind: orgTags.kind, name: orgTags.name,
    slug: orgTags.slug, parentId: orgTags.parentId, sortOrder: orgTags.sortOrder,
  }).from(orgTags).orderBy(asc(orgTags.sortOrder), asc(orgTags.name));

  console.log(`tags: ${rows.length}`);

  // For each tag, which organization_type the schools carrying it actually are.
  const typesFor = async (tagId: string) => {
    const t = await db.select({
      type: organizations.organizationType,
      n: sql<number>`count(*)::int`,
    }).from(organizationTags)
      .innerJoin(organizations, eq(organizations.id, organizationTags.organizationId))
      .where(eq(organizationTags.tagId, tagId))
      .groupBy(organizations.organizationType);
    return t.map((x) => `${x.type}:${x.n}`).join(' ') || '(none)';
  };

  const kids = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const k = r.parentId ?? null;
    if (!kids.has(k)) kids.set(k, [] as unknown as typeof rows);
    kids.get(k)!.push(r);
  }

  const walk = async (parent: string | null, depth: number) => {
    for (const r of kids.get(parent) ?? []) {
      const types = await typesFor(r.id);
      console.log('  ' + '    '.repeat(depth)
        + r.name.padEnd(Math.max(4, 30 - depth * 4))
        + ('slug=' + r.slug).padEnd(28)
        + ('kind=' + r.kind).padEnd(18)
        + types);
      await walk(r.id, depth + 1);
    }
  };
  await walk(null, 0);

  console.log('');
  const kinds = await db.select({ kind: orgTags.kind, n: sql<number>`count(*)::int` })
    .from(orgTags).groupBy(orgTags.kind);
  console.log('kinds: ' + kinds.map((k) => `${k.kind}=${k.n}`).join('  '));

  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });

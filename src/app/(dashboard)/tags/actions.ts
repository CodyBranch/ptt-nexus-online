'use server';

import { db } from '@/db/client';
import { orgTags, organizationTags, organizations } from '@/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';

/**
 * The tags a school can carry, and what holds them.
 *
 * Returned as the tree they form, because the chain is what gives a tag its
 * meaning: Class 1 under MSHSAA under High School. Flat, it would offer a
 * Division I belonging to nobody in particular.
 */
export interface TagNode {
  id: string;
  kind: string;
  name: string;
  slug: string;
  parentId: string | null;
  count: number;
  children: TagNode[];
}

export async function getTagTree(): Promise<TagNode[]> {
  const rows = await db
    .select({
      id: orgTags.id,
      kind: orgTags.kind,
      name: orgTags.name,
      slug: orgTags.slug,
      parentId: orgTags.parentId,
      sortOrder: orgTags.sortOrder,
      count: sql<number>`(
        SELECT count(*) FROM ${organizationTags}
        WHERE ${organizationTags.tagId} = ${orgTags.id}
      )`,
    })
    .from(orgTags)
    .orderBy(asc(orgTags.sortOrder), asc(orgTags.name));

  const byId = new Map<string, TagNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id, kind: r.kind, name: r.name, slug: r.slug,
      parentId: r.parentId, count: Number(r.count ?? 0), children: [],
    });
  }
  const roots: TagNode[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    const parent = r.parentId ? byId.get(r.parentId) : null;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  return roots;
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The slug a tag gets, by kind.
 *
 * Matching what the migration builds, exactly, so a tag added by hand is the
 * same tag rather than a second one beside it. A level and a governing body
 * are unique on their own — there is one NCAA DI. A conference is prefixed
 * because "Independent" is a conference name and could be anything else too.
 * A class is prefixed with its association, because Class 1 means nothing on
 * its own and every state has one.
 */
function slugFor(kind: string, name: string, parentSlug: string | null): string {
  const base = slugify(name);
  if (!base) return '';
  if (kind === 'conference') return `conf-${base}`;
  if (kind === 'class' || kind === 'region') return parentSlug ? `${parentSlug}-${base}` : base;
  return base;
}

export async function createTag(input: {
  kind: string; name: string; parentId?: string | null; sortOrder?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const kind = input.kind.trim();
  const name = input.name.trim();
  if (!kind || !name) return { ok: false, error: 'A tag needs a kind and a name' };

  let parentSlug: string | null = null;
  if (input.parentId) {
    const parent = await db.select({ slug: orgTags.slug }).from(orgTags)
      .where(eq(orgTags.id, input.parentId)).limit(1);
    parentSlug = parent[0]?.slug ?? null;
  }
  const slug = slugFor(kind, name, parentSlug);
  if (!slug) return { ok: false, error: 'Nothing usable to make a slug from' };

  const clash = await db.select({ id: orgTags.id }).from(orgTags)
    .where(eq(orgTags.slug, slug)).limit(1);
  if (clash[0]) return { ok: false, error: `There is already a tag at "${slug}"` };

  await db.insert(orgTags).values({
    kind, name, slug,
    parentId: input.parentId || null,
    sortOrder: input.sortOrder ?? 0,
  });
  revalidatePath('/tags');
  return { ok: true };
}

/**
 * Remove a tag.
 *
 * Refused while schools still carry it — deleting would take the
 * classification off every one of them at once, silently, and there is no
 * getting it back. Take it off the schools first.
 */
export async function deleteTag(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const held = await db.select({ n: sql<number>`count(*)` })
    .from(organizationTags).where(eq(organizationTags.tagId, id));
  const n = Number(held[0]?.n ?? 0);
  if (n > 0) return { ok: false, error: `${n} school${n === 1 ? '' : 's'} still carry it` };

  const kids = await db.select({ n: sql<number>`count(*)` })
    .from(orgTags).where(eq(orgTags.parentId, id));
  if (Number(kids[0]?.n ?? 0) > 0) {
    return { ok: false, error: 'It has tags under it — remove those first' };
  }

  await db.delete(orgTags).where(eq(orgTags.id, id));
  revalidatePath('/tags');
  return { ok: true };
}

/** Which tags one school carries. */
export async function getOrgTags(organizationId: string) {
  return db
    .select({ id: orgTags.id, kind: orgTags.kind, name: orgTags.name, slug: orgTags.slug })
    .from(organizationTags)
    .innerJoin(orgTags, eq(organizationTags.tagId, orgTags.id))
    .where(eq(organizationTags.organizationId, organizationId))
    .orderBy(asc(orgTags.kind), asc(orgTags.name));
}

export async function setOrgTag(
  organizationId: string, tagId: string, on: boolean,
): Promise<{ ok: true }> {
  await requireAdmin();
  if (on) {
    await db.insert(organizationTags)
      .values({ organizationId, tagId })
      .onConflictDoNothing();
  } else {
    await db.delete(organizationTags).where(and(
      eq(organizationTags.organizationId, organizationId),
      eq(organizationTags.tagId, tagId),
    ));
  }
  revalidatePath(`/organizations/${organizationId}`);
  return { ok: true };
}

/**
 * Put a tag on every school matching a filter, in one go.
 *
 * The classes are the case this exists for: there are 1,591 high schools and
 * no column saying which class any of them is in, so they arrive by the
 * handful from a list somebody has. Doing that one school at a time through
 * the org page is not a thing anybody would finish.
 */
export async function tagManyByName(
  tagId: string, names: string[],
): Promise<{ tagged: string[]; missing: string[] }> {
  await requireAdmin();
  const tagged: string[] = [];
  const missing: string[] = [];

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const found = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(sql`lower(regexp_replace(${organizations.name}, '[^a-zA-Z0-9]+', ' ', 'g')) = ${key}`)
      .limit(1);

    if (!found[0]) { missing.push(name); continue; }
    await db.insert(organizationTags)
      .values({ organizationId: found[0].id, tagId })
      .onConflictDoNothing();
    tagged.push(found[0].name);
  }

  revalidatePath('/tags');
  return { tagged, missing };
}

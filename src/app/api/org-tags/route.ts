import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { orgTags, organizationTags } from '@/db/schema';
import { asc, eq, sql } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

/**
 * The tags a school can carry, as the tree they form.
 *
 * Returned nested rather than flat because the chain is what makes them mean
 * anything: "Class 1" under MSHSAA under High School, "SEC" under NCAA DI
 * under College. A picker that showed them flat would offer a Division I
 * belonging to nobody in particular.
 *
 * Each carries how many schools hold it, so a filter can say what it will
 * narrow to before it is used.
 */
export interface TagNode {
  id: string;
  kind: string;
  name: string;
  slug: string;
  count: number;
  children: TagNode[];
}

export async function GET(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
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
        count: Number(r.count ?? 0), children: [],
      });
    }
    const roots: TagNode[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      const parent = r.parentId ? byId.get(r.parentId) : null;
      if (parent) parent.children.push(node); else roots.push(node);
    }

    return NextResponse.json({ data: roots });
  } catch (error) {
    console.error('Org tags list error:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

/**
 * Add a tag, for the classifications nothing in the data implies.
 *
 * A state's classes are the case: no column says which class a school is in,
 * so they arrive this way rather than being derived from anything.
 */
export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const data = await request.json() as {
      kind?: string; name?: string; slug?: string; parentSlug?: string | null; sortOrder?: number;
    };
    const kind = (data.kind ?? '').trim();
    const name = (data.name ?? '').trim();
    if (!kind || !name) {
      return NextResponse.json({ error: 'kind and name are required' }, { status: 400 });
    }

    const slug = (data.slug ?? name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) return NextResponse.json({ error: 'Nothing usable to make a slug from' }, { status: 400 });

    let parentId: string | null = null;
    if (data.parentSlug) {
      const parent = await db.select({ id: orgTags.id }).from(orgTags)
        .where(eq(orgTags.slug, data.parentSlug)).limit(1);
      if (!parent[0]) return NextResponse.json({ error: `No tag "${data.parentSlug}" to sit under` }, { status: 400 });
      parentId = parent[0].id;
    }

    const existing = await db.select().from(orgTags).where(eq(orgTags.slug, slug)).limit(1);
    if (existing[0]) return NextResponse.json(existing[0]);

    const [created] = await db.insert(orgTags)
      .values({ kind, name, slug, parentId, sortOrder: data.sortOrder ?? 0 })
      .returning();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Org tag create error:', error);
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
}

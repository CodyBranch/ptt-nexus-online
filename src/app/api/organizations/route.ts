import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { organizations } from '@/db/schema';
import { eq, ilike, or, and, sql, SQL } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const type = searchParams.get('type');
    const state = searchParams.get('state');
    const conference = searchParams.get('conference');
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
    const offset = Number(searchParams.get('offset') ?? 0);

    const conditions: SQL[] = [eq(organizations.isActive, true)];

    if (q) {
      const search = `%${q}%`;
      conditions.push(
        or(
          ilike(organizations.name, search),
          ilike(organizations.abbreviation, search),
          ilike(organizations.shortName, search),
          ilike(organizations.city, search)
        )!
      );
    }

    if (type) conditions.push(eq(organizations.organizationType, type));
    if (state) conditions.push(eq(organizations.state, state));
    if (conference) conditions.push(ilike(organizations.conference, `%${conference}%`));

    const where = and(...conditions);

    const [rows, countResult] = await Promise.all([
      db.select().from(organizations).where(where).orderBy(organizations.name).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(organizations).where(where),
    ]);

    return NextResponse.json({
      data: rows,
      total: Number(countResult[0]?.count ?? 0),
      limit,
      offset,
    });
  } catch (error) {
    console.error('Organizations list error:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    if (!data.name || !data.abbreviation || !data.organizationType) {
      return NextResponse.json(
        { error: 'name, abbreviation, and organizationType are required' },
        { status: 400 }
      );
    }

    const result = await db
      .insert(organizations)
      .values({
        name: data.name,
        abbreviation: data.abbreviation,
        shortName: data.shortName || null,
        mascot: data.mascot || null,
        organizationType: data.organizationType,
        genderDesignation: data.genderDesignation || null,
        ncaaDivision: data.ncaaDivision || null,
        naiaMember: data.naiaMember ?? false,
        jucoMember: data.jucoMember ?? false,
        conference: data.conference || null,
        subConference: data.subConference || null,
        stateAssociation: data.stateAssociation || null,
        city: data.city || null,
        state: data.state || null,
        country: data.country || 'USA',
        primaryColor: data.primaryColor || null,
        secondaryColor: data.secondaryColor || null,
        headCoach: data.headCoach || null,
        assistantCoach: data.assistantCoach || null,
        athleticDirector: data.athleticDirector || null,
        contactEmail: data.contactEmail || null,
        contactPhone: data.contactPhone || null,
        website: data.website || null,
        tfrrsId: data.tfrrsId || null,
        athleticNetId: data.athleticNetId || null,
        directAthleticsId: data.directAthleticsId || null,
        milesplitId: data.milesplitId || null,
        notes: data.notes || null,
      })
      .returning();

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('Organization create error:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}

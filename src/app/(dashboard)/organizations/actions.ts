'use server';

import { db } from '@/db/client';
import { organizations } from '@/db/schema';
import { eq, ilike, or, sql, and, SQL } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function getOrganizations(params?: {
  q?: string;
  type?: string;
  state?: string;
  conference?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions: SQL[] = [];

  if (params?.q) {
    const search = `%${params.q}%`;
    conditions.push(
      or(
        ilike(organizations.name, search),
        ilike(organizations.abbreviation, search),
        ilike(organizations.shortName, search),
        ilike(organizations.mascot, search),
        ilike(organizations.city, search)
      )!
    );
  }

  if (params?.type) {
    conditions.push(eq(organizations.organizationType, params.type));
  }

  if (params?.state) {
    conditions.push(eq(organizations.state, params.state));
  }

  if (params?.conference) {
    conditions.push(ilike(organizations.conference, `%${params.conference}%`));
  }

  // Only active by default
  conditions.push(eq(organizations.isActive, true));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(organizations)
      .where(where)
      .orderBy(organizations.name)
      .limit(params?.limit ?? 50)
      .offset(params?.offset ?? 0),
    db
      .select({ count: sql<number>`count(*)` })
      .from(organizations)
      .where(where),
  ]);

  return {
    data: rows,
    total: Number(countResult[0]?.count ?? 0),
  };
}

export async function getOrganization(id: string) {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createOrganization(data: {
  name: string;
  abbreviation: string;
  shortName?: string;
  mascot?: string;
  organizationType: string;
  genderDesignation?: string;
  ncaaDivision?: string;
  naiaMember?: boolean;
  jucoMember?: boolean;
  conference?: string;
  subConference?: string;
  stateAssociation?: string;
  city?: string;
  state?: string;
  country?: string;
  primaryColor?: string;
  secondaryColor?: string;
  headCoach?: string;
  assistantCoach?: string;
  athleticDirector?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  tfrrsId?: string;
  athleticNetId?: string;
  directAthleticsId?: string;
  milesplitId?: string;
  notes?: string;
}) {
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
    .returning({ id: organizations.id });

  revalidatePath('/organizations');
  return result[0];
}

export async function updateOrganization(
  id: string,
  data: Partial<{
    name: string;
    abbreviation: string;
    shortName: string;
    mascot: string;
    organizationType: string;
    genderDesignation: string;
    ncaaDivision: string;
    naiaMember: boolean;
    jucoMember: boolean;
    conference: string;
    subConference: string;
    stateAssociation: string;
    city: string;
    state: string;
    country: string;
    primaryColor: string;
    secondaryColor: string;
    headCoach: string;
    assistantCoach: string;
    athleticDirector: string;
    contactEmail: string;
    contactPhone: string;
    website: string;
    tfrrsId: string;
    athleticNetId: string;
    directAthleticsId: string;
    milesplitId: string;
    notes: string;
  }>
) {
  await db
    .update(organizations)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, id));

  revalidatePath('/organizations');
  revalidatePath(`/organizations/${id}`);
}

export async function deleteOrganization(id: string) {
  // Soft delete
  await db
    .update(organizations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(organizations.id, id));

  revalidatePath('/organizations');
}

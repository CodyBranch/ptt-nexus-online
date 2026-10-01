/**
 * Whether the daily read of the USTFCCCA runs.
 *
 * On unless someone has switched it off: the season runs August to November,
 * and after the final polls there is nothing to read until the preseason
 * poll. Reading before the table exists (the migration not yet run) answers
 * on, so the cron keeps working as it did.
 */

import { db } from '@/db/client';
import { rankingSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

const AUTO_PULL = 'auto_pull';

export interface AutoPull { on: boolean; updatedAt: Date | null; updatedBy: string | null }

export async function getAutoPull(): Promise<AutoPull> {
  try {
    const [row] = await db.select().from(rankingSettings).where(eq(rankingSettings.key, AUTO_PULL));
    return { on: row ? row.value !== 'off' : true, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  } catch {
    return { on: true, updatedAt: null, updatedBy: null };
  }
}

export async function setAutoPull(on: boolean, by: string): Promise<void> {
  const value = on ? 'on' : 'off';
  await db.insert(rankingSettings).values({ key: AUTO_PULL, value, updatedBy: by, updatedAt: new Date() })
    .onConflictDoUpdate({ target: rankingSettings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

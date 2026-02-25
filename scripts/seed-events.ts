// Seed the event_definitions table from the desktop app's event catalog
// Run with: npx tsx scripts/seed-events.ts

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

interface CatalogEvent {
  id: string;
  name: string;
  shortName: string;
  eventType: string;
  category: string;
  indRel: string;
  distance: number | null;
  units: string;
  venueFilter: string;
  sortOrder: number;
}

// Wind-affected events: sprints ≤200m, horizontal jumps, hurdles ≤110m
function isWindAffected(event: CatalogEvent): boolean {
  if (event.eventType === 'field_jump_h') return true; // LJ, TJ
  if (event.eventType === 'track_sprint' && event.distance !== null && event.distance <= 200) return true;
  if (event.eventType === 'track_hurdles' && event.distance !== null && event.distance <= 110) return true;
  return false;
}

// Lower-is-better for timed events, higher-is-better for field & combined
function lowerIsBetter(event: CatalogEvent): boolean {
  if (event.category === 'FIELD') return false;
  if (event.category === 'COMBINED') return false;
  return true; // track events: lower time is better
}

// Mark format
function markFormat(event: CatalogEvent): string {
  if (event.category === 'COMBINED') return 'points';
  if (event.eventType === 'field_throw') return 'distance';
  if (event.eventType === 'field_jump_h') return 'distance';
  if (event.eventType === 'field_jump_v') return 'height';
  return 'time';
}

const EVENTS: CatalogEvent[] = [
  { id: "100m", name: "100 Meters", shortName: "100m", eventType: "track_sprint", category: "STRAIGHT", indRel: "I", distance: 100, units: "M", venueFilter: "outdoor", sortOrder: 800 },
  { id: "100mH", name: "100 Meter Hurdles", shortName: "100mH", eventType: "track_hurdles", category: "STRAIGHT", indRel: "I", distance: 100, units: "M", venueFilter: "outdoor", sortOrder: 1400 },
  { id: "110mH", name: "110 Meter Hurdles", shortName: "110mH", eventType: "track_hurdles", category: "STRAIGHT", indRel: "I", distance: 110, units: "M", venueFilter: "outdoor", sortOrder: 1400 },
  { id: "400mH", name: "400 Meter Hurdles", shortName: "400mH", eventType: "track_hurdles", category: "RUN", indRel: "I", distance: 400, units: "M", venueFilter: "outdoor", sortOrder: 1500 },
  { id: "10000m", name: "10,000 Meters", shortName: "10,000m", eventType: "track_distance", category: "RUN", indRel: "I", distance: 10000, units: "M", venueFilter: "outdoor", sortOrder: 1200 },
  { id: "10KRW", name: "10K Racewalk", shortName: "10K RW", eventType: "race_walk", category: "RUN", indRel: "I", distance: 10000, units: "M", venueFilter: "outdoor", sortOrder: 2550 },
  { id: "20KRW", name: "20K Racewalk", shortName: "20K RW", eventType: "race_walk", category: "RUN", indRel: "I", distance: 20000, units: "M", venueFilter: "outdoor", sortOrder: 1200 },
  { id: "3000mSC", name: "3000m Steeplechase", shortName: "3000m SC", eventType: "track_steeplechase", category: "RUN", indRel: "I", distance: 3000, units: "M", venueFilter: "outdoor", sortOrder: 1550 },
  { id: "60m", name: "60 Meters", shortName: "60m", eventType: "track_sprint", category: "STRAIGHT", indRel: "I", distance: 60, units: "M", venueFilter: "indoor", sortOrder: 800 },
  { id: "60mH", name: "60 Meter Hurdles", shortName: "60mH", eventType: "track_hurdles", category: "STRAIGHT", indRel: "I", distance: 60, units: "M", venueFilter: "indoor", sortOrder: 1385 },
  { id: "300m", name: "300 Meters", shortName: "300m", eventType: "track_sprint", category: "RUN", indRel: "I", distance: 300, units: "M", venueFilter: "indoor", sortOrder: 870 },
  { id: "500m", name: "500 Meters", shortName: "500m", eventType: "track_middle", category: "RUN", indRel: "I", distance: 500, units: "M", venueFilter: "indoor", sortOrder: 850 },
  { id: "600m", name: "600 Meters", shortName: "600m", eventType: "track_middle", category: "RUN", indRel: "I", distance: 600, units: "M", venueFilter: "indoor", sortOrder: 870 },
  { id: "1000m", name: "1000 Meters", shortName: "1000m", eventType: "track_middle", category: "RUN", indRel: "I", distance: 1000, units: "M", venueFilter: "indoor", sortOrder: 870 },
  { id: "2000m", name: "2000 Meters", shortName: "2000m", eventType: "track_distance", category: "RUN", indRel: "I", distance: 2000, units: "M", venueFilter: "indoor", sortOrder: 1200 },
  { id: "2Mile", name: "2 Mile", shortName: "2 Mile", eventType: "track_distance", category: "RUN", indRel: "I", distance: 3218, units: "E", venueFilter: "indoor", sortOrder: 1015 },
  { id: "MileRW", name: "Mile Racewalk", shortName: "Mile RW", eventType: "race_walk", category: "RUN", indRel: "I", distance: 1609, units: "E", venueFilter: "indoor", sortOrder: 9980 },
  { id: "3000mRW", name: "3000m Racewalk", shortName: "3000m RW", eventType: "race_walk", category: "RUN", indRel: "I", distance: 3000, units: "M", venueFilter: "indoor", sortOrder: 1200 },
  { id: "200m", name: "200 Meters", shortName: "200m", eventType: "track_sprint", category: "STRAIGHT", indRel: "I", distance: 200, units: "M", venueFilter: "both", sortOrder: 830 },
  { id: "400m", name: "400 Meters", shortName: "400m", eventType: "track_middle", category: "RUN", indRel: "I", distance: 400, units: "M", venueFilter: "both", sortOrder: 850 },
  { id: "800m", name: "800 Meters", shortName: "800m", eventType: "track_middle", category: "RUN", indRel: "I", distance: 800, units: "M", venueFilter: "both", sortOrder: 870 },
  { id: "1500m", name: "1500 Meters", shortName: "1500m", eventType: "track_distance", category: "RUN", indRel: "I", distance: 1500, units: "M", venueFilter: "both", sortOrder: 890 },
  { id: "Mile", name: "Mile", shortName: "Mile", eventType: "track_distance", category: "RUN", indRel: "I", distance: 1609, units: "E", venueFilter: "both", sortOrder: 900 },
  { id: "3000m", name: "3000 Meters", shortName: "3000m", eventType: "track_distance", category: "RUN", indRel: "I", distance: 3000, units: "M", venueFilter: "both", sortOrder: 1100 },
  { id: "5000m", name: "5000 Meters", shortName: "5000m", eventType: "track_distance", category: "RUN", indRel: "I", distance: 5000, units: "M", venueFilter: "both", sortOrder: 1100 },
  { id: "2000mSC", name: "2000m Steeplechase", shortName: "2000m SC", eventType: "track_steeplechase", category: "RUN", indRel: "I", distance: 2000, units: "M", venueFilter: "both", sortOrder: 1550 },
  { id: "4x100", name: "4x100 Relay", shortName: "4x1", eventType: "track_relay", category: "RELAY", indRel: "R", distance: 400, units: "M", venueFilter: "both", sortOrder: 300 },
  { id: "4x200", name: "4x200 Relay", shortName: "4x2", eventType: "track_relay", category: "RELAY", indRel: "R", distance: 800, units: "M", venueFilter: "both", sortOrder: 200 },
  { id: "4x400", name: "4x400 Relay", shortName: "4x4", eventType: "track_relay", category: "RELAY", indRel: "R", distance: 1600, units: "M", venueFilter: "both", sortOrder: 300 },
  { id: "4x800", name: "4x800 Relay", shortName: "4x8", eventType: "track_relay", category: "RELAY", indRel: "R", distance: 3200, units: "M", venueFilter: "both", sortOrder: 400 },
  { id: "SMR", name: "Sprint Medley Relay", shortName: "SMR", eventType: "track_relay", category: "RELAY", indRel: "R", distance: 1600, units: "M", venueFilter: "both", sortOrder: 300 },
  { id: "DMR", name: "Distance Medley Relay", shortName: "DMR", eventType: "track_relay", category: "RELAY", indRel: "R", distance: 4000, units: "M", venueFilter: "both", sortOrder: 650 },
  { id: "4xMile", name: "4xMile Relay", shortName: "4xMile", eventType: "track_relay", category: "RUN", indRel: "I", distance: 6438, units: "E", venueFilter: "both", sortOrder: 1015 },
  { id: "SP", name: "Shot Put", shortName: "SP", eventType: "field_throw", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "both", sortOrder: 3000 },
  { id: "DT", name: "Discus Throw", shortName: "Discus", eventType: "field_throw", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "outdoor", sortOrder: 3100 },
  { id: "HT", name: "Hammer Throw", shortName: "Hammer", eventType: "field_throw", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "outdoor", sortOrder: 3200 },
  { id: "JT", name: "Javelin Throw", shortName: "Javelin", eventType: "field_throw", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "outdoor", sortOrder: 3300 },
  { id: "WT", name: "Weight Throw", shortName: "Weight", eventType: "field_throw", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "indoor", sortOrder: 3050 },
  { id: "LJ", name: "Long Jump", shortName: "LJ", eventType: "field_jump_h", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "both", sortOrder: 3400 },
  { id: "TJ", name: "Triple Jump", shortName: "TJ", eventType: "field_jump_h", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "both", sortOrder: 3500 },
  { id: "HJ", name: "High Jump", shortName: "HJ", eventType: "field_jump_v", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "both", sortOrder: 3600 },
  { id: "PV", name: "Pole Vault", shortName: "PV", eventType: "field_jump_v", category: "FIELD", indRel: "I", distance: null, units: "M", venueFilter: "both", sortOrder: 3700 },
  { id: "Dec", name: "Decathlon", shortName: "Dec", eventType: "combined", category: "COMBINED", indRel: "I", distance: null, units: "M", venueFilter: "outdoor", sortOrder: 4000 },
  { id: "Hep", name: "Heptathlon", shortName: "Hep", eventType: "combined", category: "COMBINED", indRel: "I", distance: null, units: "M", venueFilter: "both", sortOrder: 4100 },
  { id: "Pen", name: "Pentathlon", shortName: "Pen", eventType: "combined", category: "COMBINED", indRel: "I", distance: null, units: "M", venueFilter: "indoor", sortOrder: 4200 },
];

async function main() {
  console.log('\nSeeding event_definitions table...\n');

  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, connect_timeout: 10 });

  // Clear existing events
  await sql`DELETE FROM event_definitions`;
  console.log('Cleared existing event definitions.');

  // Insert all events
  let inserted = 0;
  for (const event of EVENTS) {
    const windAffected = isWindAffected(event);
    const lower = lowerIsBetter(event);
    const format = markFormat(event);

    await sql`
      INSERT INTO event_definitions (id, name, short_name, event_type, category, ind_rel, distance, units, venue_filter, sort_order, is_wind_affected, lower_is_better, mark_format, event_code, gender_neutral_name)
      VALUES (${event.id}, ${event.name}, ${event.shortName}, ${event.eventType}, ${event.category}, ${event.indRel}, ${event.distance}, ${event.units}, ${event.venueFilter}, ${event.sortOrder}, ${windAffected}, ${lower}, ${format}, ${event.id}, ${event.name})
    `;
    inserted++;
    console.log(`  [${inserted}] ${event.id} — ${event.name} (${event.venueFilter}, ${format}${windAffected ? ', wind' : ''})`);
  }

  console.log(`\nInserted ${inserted} event definitions.`);

  await sql.end();
  console.log('Done!\n');
}

main().catch(console.error);

# PTT Nexus Cloud — Platform Specification

## Overview

PTT Nexus Cloud is the centralized web platform that manages **teams/organizations** and **records** for the PTT Nexus Manager ecosystem. It serves as the single source of truth that multiple desktop app installations can sync against — ensuring every machine running PTT Nexus Manager at a venue (or across venues) shares consistent team branding, logos, and record data.

**Deployment target:** Vercel (Next.js) + Supabase (PostgreSQL + Auth + Storage)

**Primary users:**
- Meet directors managing teams and records before events
- Series/conference administrators maintaining organization databases
- Timer operators syncing record sets down to desktop app instances

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PTT Nexus Cloud                       │
│               (Vercel + Supabase)                        │
│                                                          │
│   Next.js App Router ──── Supabase PostgreSQL            │
│   • Organization/team CRUD + search                      │
│   • Record set management + bulk import                  │
│   • Image/logo storage (Supabase Storage)                │
│   • REST API for desktop app sync                        │
│   • Admin dashboard                                      │
│   • Supabase Auth (email + magic link)                   │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────┴──────────────┐
         │  SYNC DOWN: Record sets,   │
         │  team/org data, logos       │
         │  SYNC UP: Broken records   │
         └─────────────┬──────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│   PTT Nexus Manager Desktop (multiple installations)     │
│                                                          │
│   Machine A (Host)       Machine B         Machine C     │
│   └── SQLite             └── SQLite        └── SQLite    │
│       local_record_sets      (same data)       (same)    │
│       local_records                                      │
│       teams (linked to org_id)                           │
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Framework** | Next.js 15 (App Router) | Server components + API routes |
| **Language** | TypeScript (strict) | Shared types with desktop app where possible |
| **Database** | Supabase PostgreSQL | Row-level security, real-time subscriptions |
| **Auth** | Supabase Auth | Email/password + magic link, role-based |
| **Storage** | Supabase Storage | Team logos, organization images |
| **UI** | React 19 + Tailwind CSS | Match desktop app aesthetic |
| **Deployment** | Vercel | Auto-deploy from GitHub |
| **ORM** | Drizzle ORM | Type-safe, lightweight, PostgreSQL-native |

---

## Data Model

### Entity Relationship Overview

```
Organization (1) ──→ (M) OrganizationImage
Organization (1) ──→ (M) Team (via meet sync)
Organization (1) ──→ (M) Conference memberships

RecordSet (1) ──→ (M) Record
RecordSet (1) ──→ (M) RecordSetEligibilityRule
Record (1) ──→ (M) RecordHistory

EventDefinition (reference table, ~130 events)
  └── used by Record.event_code for mapping
```

### PostgreSQL Schema

#### `organizations`

The master team/school/club database. Every team that appears in a PTT Nexus meet can optionally link back to an organization here.

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  short_name TEXT,                           -- "Vandy" for "Vanderbilt University"
  mascot TEXT,                               -- "Commodores"

  -- Classification
  organization_type TEXT NOT NULL,           -- see OrganizationType enum
  gender_designation TEXT,                   -- 'men', 'women', 'coed', null
  ncaa_division TEXT,                        -- 'D1', 'D2', 'D3', null
  naia_member BOOLEAN DEFAULT false,
  juco_member BOOLEAN DEFAULT false,
  conference TEXT,                           -- "SEC", "Big Ten", "GHSA Region 7-AAAAAAA"
  sub_conference TEXT,                       -- region/district within conference
  state_association TEXT,                    -- "TSSAA", "GHSA", etc.

  -- Location
  city TEXT,
  state TEXT,                               -- 2-letter code
  country TEXT DEFAULT 'USA',

  -- Branding
  primary_color TEXT,                        -- hex "#C8102E"
  secondary_color TEXT,                      -- hex "#000000"
  logo_url TEXT,                             -- Supabase Storage URL (light bg version)
  logo_dark_url TEXT,                        -- dark background version
  wordmark_url TEXT,                         -- text-based logo variant

  -- Contact
  head_coach TEXT,
  assistant_coach TEXT,
  athletic_director TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  website TEXT,

  -- External IDs (for cross-referencing)
  tfrrs_id TEXT,                             -- TFRRS team ID
  athletic_net_id TEXT,                      -- Athletic.net team ID
  direct_athletics_id TEXT,                  -- DirectAthletics team ID
  milesplit_id TEXT,                         -- MileSplit team ID

  -- Metadata
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_orgs_name ON organizations(name);
CREATE INDEX idx_orgs_abbreviation ON organizations(abbreviation);
CREATE INDEX idx_orgs_type ON organizations(organization_type);
CREATE INDEX idx_orgs_state ON organizations(state);
CREATE INDEX idx_orgs_conference ON organizations(conference);
CREATE UNIQUE INDEX idx_orgs_tfrrs ON organizations(tfrrs_id) WHERE tfrrs_id IS NOT NULL;
```

**OrganizationType enum values:**
```typescript
type OrganizationType =
  | 'professional'       // Pro teams/clubs
  | 'college'            // Generic college (use ncaa_division for specifics)
  | 'high_school'        // NFHS member schools
  | 'middle_school'      // Middle/junior high
  | 'club'               // USATF clubs, running clubs, AAU
  | 'national_federation' // Country teams ("Jamaica", "Great Britain")
  | 'unattached'         // Unattached athletes
  | 'other';
```

#### `organization_images`

Additional images beyond the primary logo (action shots, facilities, banners).

```sql
CREATE TABLE organization_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,                   -- Supabase Storage URL
  image_type TEXT NOT NULL,                  -- 'logo', 'logo_dark', 'wordmark', 'banner', 'photo'
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_org_images_org ON organization_images(organization_id);
```

#### `event_definitions`

The canonical event catalog. This is the reference table that records use for `event_code` mapping. Seeded from the desktop app's `event-catalog.json` but enriched with additional metadata for the cloud.

```sql
CREATE TABLE event_definitions (
  id TEXT PRIMARY KEY,                       -- matches CatalogEvent.id from desktop
  name TEXT NOT NULL,                        -- "100 Meters"
  short_name TEXT NOT NULL,                  -- "100"
  event_type TEXT NOT NULL,                  -- track_sprint, field_throw, etc.
  category TEXT NOT NULL,                    -- STRAIGHT, RUN, RELAY, FIELD, COMBINED
  ind_rel TEXT NOT NULL DEFAULT 'I',         -- I=individual, R=relay
  distance REAL,                             -- distance in meters (null for field)
  units TEXT NOT NULL DEFAULT 'M',           -- M=metric, E=imperial
  venue_filter TEXT NOT NULL DEFAULT 'both', -- outdoor, indoor, both
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Record-specific
  is_wind_affected BOOLEAN DEFAULT false,    -- true for 100, 200, LJ, TJ, 100H, 110H
  lower_is_better BOOLEAN DEFAULT true,      -- true for track, false for field
  mark_format TEXT DEFAULT 'time',           -- 'time', 'distance', 'height'

  -- Display helpers
  event_code TEXT NOT NULL,                  -- "100", "200", "110H", "LJ", "SP", etc.
  gender_neutral_name TEXT,                  -- "100 Meters" (no "Men's"/"Women's" prefix)

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_event_defs_code ON event_definitions(event_code);
CREATE INDEX idx_event_defs_type ON event_definitions(event_type);
CREATE INDEX idx_event_defs_venue ON event_definitions(venue_filter);
```

#### `record_sets`

A collection of records grouped by scope and eligibility rules. Examples: "NCAA D1 Indoor Records", "TSSAA Class AAA State Records", "Vanderbilt Facility Records".

```sql
CREATE TABLE record_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name TEXT NOT NULL,                        -- "SEC Indoor Conference Records"
  abbreviation TEXT NOT NULL,                -- "SEC-IR"
  description TEXT,

  -- Scope
  scope TEXT NOT NULL,                       -- 'world', 'national', 'collegiate', 'state',
                                             -- 'conference', 'facility', 'meet', 'school', 'custom'

  -- Filters (narrow which athletes/events qualify)
  gender TEXT,                               -- 'M', 'F', null (both)
  season TEXT,                               -- 'indoor', 'outdoor', null (both)

  -- Owning organization (optional — e.g., "Vanderbilt" owns their facility records)
  organization_id UUID REFERENCES organizations(id),

  -- Eligibility rules (JSON array of conditions, AND logic)
  -- See RecordCondition type below
  eligibility_rules JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  is_public BOOLEAN DEFAULT true,            -- visible to all users vs. private
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_record_sets_scope ON record_sets(scope);
CREATE INDEX idx_record_sets_org ON record_sets(organization_id);
CREATE INDEX idx_record_sets_active ON record_sets(is_active);
```

#### `records`

Individual record entries within a record set. One row per event_code + gender combination.

```sql
CREATE TABLE records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_set_id UUID NOT NULL REFERENCES record_sets(id) ON DELETE CASCADE,

  -- What event
  event_code TEXT NOT NULL,                  -- "100", "110H", "LJ", "SP", "4x100", etc.
  gender TEXT NOT NULL,                      -- 'M' or 'F'

  -- The record itself
  mark TEXT NOT NULL,                        -- display string: "9.58", "2:01.45", "8.95m"
  mark_sortable REAL NOT NULL,              -- numeric for comparison (seconds or meters)

  -- Who / when / where
  athlete_name TEXT,                         -- "Usain Bolt"
  athlete_id UUID,                           -- link to athlete registry (future)
  team_name TEXT,                            -- "Jamaica" / "Tennessee"
  organization_id UUID REFERENCES organizations(id),
  meet_name TEXT,                            -- "2009 World Championships"
  record_date DATE,
  location TEXT,                             -- "Berlin, Germany"

  -- Conditions
  wind REAL,                                 -- wind reading (null if N/A)
  altitude_adjusted BOOLEAN DEFAULT false,
  auto_timed BOOLEAN DEFAULT true,           -- FAT vs hand-timed

  -- Audit
  notes TEXT,
  source TEXT,                               -- "IAAF", "NCAA Records Book", "manual entry"
  verified BOOLEAN DEFAULT false,            -- manually verified by admin
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,

  -- Sync tracking
  last_synced_at TIMESTAMPTZ,               -- when last pushed to a desktop app
  broken_at_meet TEXT,                       -- meet name where broken (filled on sync-up)

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(record_set_id, event_code, gender)
);

CREATE INDEX idx_records_set ON records(record_set_id);
CREATE INDEX idx_records_event ON records(event_code);
CREATE INDEX idx_records_gender ON records(gender);
CREATE INDEX idx_records_org ON records(organization_id);
```

#### `record_history`

Audit trail of record changes over time. Every time a record is broken, the previous value is archived here.

```sql
CREATE TABLE record_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,

  -- Previous values (snapshot before update)
  previous_mark TEXT NOT NULL,
  previous_mark_sortable REAL NOT NULL,
  previous_athlete_name TEXT,
  previous_team_name TEXT,
  previous_meet_name TEXT,
  previous_record_date DATE,
  previous_wind REAL,

  -- What replaced it
  new_mark TEXT NOT NULL,
  new_athlete_name TEXT,
  broken_at_meet TEXT,                       -- meet where it was broken
  broken_date DATE,

  -- Source
  source TEXT,                               -- 'desktop_sync', 'manual_edit', 'bulk_import'
  synced_from_meet_id TEXT,                  -- desktop meet UUID if from sync

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_record_history_record ON record_history(record_id);
CREATE INDEX idx_record_history_date ON record_history(broken_date);
```

#### `sync_logs`

Tracks every sync operation between desktop apps and the cloud.

```sql
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  direction TEXT NOT NULL,                   -- 'down' (cloud→desktop), 'up' (desktop→cloud)
  sync_type TEXT NOT NULL,                   -- 'record_sets', 'organizations', 'full'

  -- What was synced
  record_sets_synced INTEGER DEFAULT 0,
  records_synced INTEGER DEFAULT 0,
  records_broken INTEGER DEFAULT 0,          -- new records uploaded from desktop
  organizations_synced INTEGER DEFAULT 0,

  -- Source
  desktop_meet_name TEXT,                    -- name of the meet on the desktop
  desktop_meet_id TEXT,                      -- UUID from the desktop SQLite
  client_ip TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'completed',  -- 'completed', 'partial', 'failed'
  error_message TEXT,

  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  initiated_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_sync_logs_date ON sync_logs(started_at);
CREATE INDEX idx_sync_logs_type ON sync_logs(sync_type);
```

---

## Eligibility Rules System

Record sets use a JSON array of conditions to determine which athletes are eligible. All conditions must be satisfied (AND logic). This system maps directly to the desktop app's `RecordCondition` type.

### Condition Types

```typescript
type RecordCondition =
  | { type: 'any' }                          // No restrictions — open to all
  | { type: 'team_type'; value: TeamType }   // Team classification match
  | { type: 'organization_id'; value: string }  // Specific organization
  | { type: 'organization_type'; value: OrganizationType[] } // Org type(s)
  | { type: 'conference'; value: string }    // Conference name match
  | { type: 'state_association'; value: string } // State association match
  | { type: 'ncaa_division'; value: string } // NCAA division match
  | { type: 'nationality'; value: string }   // Country code
  | { type: 'age_group'; value: string }     // Age group category
  | { type: 'age_max'; value: number }       // Maximum age
  | { type: 'is_high_school'; value: true }  // Must be HS athlete
  | { type: 'is_collegiate'; value: true }   // Must be collegiate athlete
  | { type: 'team_id'; value: string }       // Specific team (per-meet)
  | { type: 'custom_flag'; value: string };  // Custom metadata match

// TeamType matches the desktop app's team_type field
type TeamType = 'professional' | 'club' | 'college' | 'high_school' | 'middle_school' | 'other';
```

### Eligibility Examples

| Record Set | Eligibility Rules |
|-----------|------------------|
| World Records | `[{ "type": "any" }]` |
| NCAA D1 Indoor Records | `[{ "type": "is_collegiate", "value": true }, { "type": "ncaa_division", "value": "D1" }]` |
| TSSAA Class AAA State Records | `[{ "type": "team_type", "value": "high_school" }, { "type": "state_association", "value": "TSSAA" }]` |
| Vanderbilt Facility Records | `[{ "type": "any" }]` (facility records are open to anyone competing at the facility) |
| SEC Conference Records | `[{ "type": "conference", "value": "SEC" }]` |
| U20 National Records | `[{ "type": "nationality", "value": "USA" }, { "type": "age_max", "value": 19 }]` |
| School Records (specific org) | `[{ "type": "organization_id", "value": "uuid-of-vanderbilt" }]` |
| HS Records (by team_type) | `[{ "type": "team_type", "value": "high_school" }]` |

### How `team_type` Integrates with Record Eligibility

The desktop app's `teams.team_type` field (added in migration 017) maps to the cloud's `organizations.organization_type`. When checking record eligibility:

1. **Desktop side:** The `checkRecords()` function already checks `is_high_school`, `is_collegiate`, etc. on the athlete. The new `team_type` field provides a team-level classification that can be used for additional eligibility conditions.

2. **Cloud side:** When syncing record sets down, the `eligibility_rules` JSON can include `{ "type": "team_type", "value": "college" }` conditions. The desktop app should map `team_type` to the athlete's team during eligibility checking.

3. **Practical example:** A large invitational has both college and high school teams. A record set for "High School Records" with rule `[{ "type": "team_type", "value": "high_school" }]` will only check results from athletes on teams classified as `high_school`. An athlete on a `college` team running 10.45 in the 100m won't trigger a high school record check even if their personal data says `is_high_school: true` (they're competing for a college team at this meet).

---

## Event Code Mapping

Records reference events by `event_code`, which must be consistent between the cloud database and every desktop app installation. The event catalog (`event-catalog.json`) is the source of truth.

### Standard Event Codes

| Code | Event | Wind-Affected | Lower is Better | Venue |
|------|-------|--------------|-----------------|-------|
| `55` | 55 Meters | No | Yes | Indoor |
| `60` | 60 Meters | No | Yes | Indoor |
| `100` | 100 Meters | Yes | Yes | Outdoor |
| `200` | 200 Meters | Yes | Yes | Both |
| `300` | 300 Meters | No | Yes | Both |
| `400` | 400 Meters | No | Yes | Both |
| `500` | 500 Meters | No | Yes | Indoor |
| `600` | 600 Meters | No | Yes | Both |
| `800` | 800 Meters | No | Yes | Both |
| `1000` | 1000 Meters | No | Yes | Both |
| `1500` | 1500 Meters | No | Yes | Both |
| `1600` | 1600 Meters | No | Yes | Both |
| `MILE` | Mile | No | Yes | Both |
| `3000` | 3000 Meters | No | Yes | Both |
| `3200` | 3200 Meters | No | Yes | Both |
| `2MILE` | 2 Miles | No | Yes | Both |
| `5000` | 5000 Meters | No | Yes | Both |
| `10000` | 10,000 Meters | No | Yes | Outdoor |
| `55H` | 55m Hurdles | No | Yes | Indoor |
| `60H` | 60m Hurdles | No | Yes | Indoor |
| `100H` | 100m Hurdles | Yes | Yes | Outdoor |
| `110H` | 110m Hurdles | Yes | Yes | Outdoor |
| `300H` | 300m Hurdles | No | Yes | Both |
| `400H` | 400m Hurdles | No | Yes | Outdoor |
| `2000SC` | 2000m Steeplechase | No | Yes | Outdoor |
| `3000SC` | 3000m Steeplechase | No | Yes | Outdoor |
| `4x100` | 4x100 Relay | No | Yes | Both |
| `4x200` | 4x200 Relay | No | Yes | Both |
| `4x400` | 4x400 Relay | No | Yes | Both |
| `4x800` | 4x800 Relay | No | Yes | Both |
| `DMR` | Distance Medley Relay | No | Yes | Both |
| `SMR` | Sprint Medley Relay | No | Yes | Both |
| `HJ` | High Jump | No | No | Both |
| `PV` | Pole Vault | No | No | Both |
| `LJ` | Long Jump | Yes | No | Both |
| `TJ` | Triple Jump | Yes | No | Both |
| `SP` | Shot Put | No | No | Both |
| `DT` | Discus | No | No | Outdoor |
| `HT` | Hammer Throw | No | No | Outdoor |
| `JT` | Javelin | No | No | Outdoor |
| `WT` | Weight Throw | No | No | Indoor |
| `DEC` | Decathlon | No | No | Outdoor |
| `HEP` | Heptathlon (women, outdoor) | No | No | Outdoor |
| `PENT` | Pentathlon (indoor) | No | No | Indoor |

### Mapping Records to Meet Events

When the desktop app imports record sets from the cloud, it needs to match records against meet events. The matching logic:

```typescript
function findMatchingRecord(event: MeetEvent, record: CloudRecord): boolean {
  // 1. Event code must match
  if (event.distance_code !== record.event_code) return false;

  // 2. Gender must match
  if (event.gender !== record.gender) return false;

  // 3. Season/venue must match (if record set specifies)
  //    - Indoor record sets only match indoor meets
  //    - Outdoor record sets only match outdoor meets
  //    - null/unspecified matches both

  return true;
}
```

---

## REST API

All endpoints require authentication via Supabase JWT (passed as `Authorization: Bearer <token>`). The desktop app authenticates with an API key that maps to a service-role user.

### Authentication

```
POST   /api/auth/api-key          → Exchange API key for JWT token
                                     Body: { apiKey: string }
                                     Returns: { token: string, expiresAt: string }
```

The desktop app stores an API key (configured in Settings). On sync, it exchanges this for a short-lived JWT used for subsequent requests.

### Organizations

```
GET    /api/organizations                         → List/search organizations
         ?q=vanderbilt                             → Fuzzy search by name/abbreviation
         &type=college                             → Filter by organization_type
         &state=TN                                 → Filter by state
         &conference=SEC                           → Filter by conference
         &limit=50&offset=0                        → Pagination

GET    /api/organizations/:id                     → Get single organization with images

POST   /api/organizations                         → Create organization
         Body: { name, abbreviation, organization_type, ... }

PUT    /api/organizations/:id                     → Update organization

DELETE /api/organizations/:id                     → Soft-delete (set is_active=false)

POST   /api/organizations/:id/images              → Upload image
         Multipart form: file + image_type + caption

DELETE /api/organizations/:id/images/:imageId     → Remove image

POST   /api/organizations/import                  → Bulk CSV import
         Multipart form: file (CSV)
         Returns: { imported: number, skipped: number, errors: ImportError[] }

GET    /api/organizations/export                  → Export as JSON
         ?format=csv|json
         &type=high_school                         → Optional filter
```

### Record Sets

```
GET    /api/record-sets                           → List all record sets
         ?scope=national                           → Filter by scope
         &season=indoor                            → Filter by season
         &active=true                              → Only active sets

GET    /api/record-sets/:id                       → Get record set with metadata

POST   /api/record-sets                           → Create record set
         Body: { name, abbreviation, scope, gender?, season?,
                 organizationId?, eligibilityRules?, description? }

PUT    /api/record-sets/:id                       → Update record set

DELETE /api/record-sets/:id                       → Soft-delete (set is_active=false)
```

### Records (within a set)

```
GET    /api/record-sets/:id/records               → List all records in a set
         ?event_code=100                           → Filter by event
         &gender=M                                 → Filter by gender

POST   /api/record-sets/:id/records               → Add a record
         Body: { eventCode, gender, mark, markSortable, athleteName?,
                 teamName?, organizationId?, meetName?, recordDate?, wind? }

PUT    /api/records/:id                           → Update a record

DELETE /api/records/:id                           → Delete a record

GET    /api/records/:id/history                   → Get history for a record

POST   /api/record-sets/:id/import                → Bulk import records from CSV/JSON
         Multipart form: file
         Format (CSV): event_code,gender,mark,mark_sortable,athlete_name,
                        team_name,meet_name,record_date,wind
         Returns: { imported: number, updated: number, errors: ImportError[] }

GET    /api/record-sets/:id/export                → Export records
         ?format=csv|json|pdf
```

### Desktop App Sync Endpoints

These are the primary endpoints the desktop app calls during sync operations.

```
POST   /api/sync/down                             → Pull data from cloud to desktop
         Body: {
           recordSetIds: string[],                  → Which record sets to sync
           includeOrganizations: boolean,           → Include org data for linked teams
           organizationIds?: string[],              → Specific orgs (or all if omitted)
           lastSyncedAt?: string                    → Incremental sync (only changes since)
         }
         Returns: {
           recordSets: RecordSetWithRecords[],
           organizations: OrganizationForSync[],    → Includes logo URLs
           syncTimestamp: string
         }

POST   /api/sync/up                               → Push broken records from desktop to cloud
         Body: {
           meetName: string,
           meetId: string,                           → Desktop SQLite meet UUID
           meetDate: string,
           brokenRecords: Array<{
             recordSetId: string,                    → Maps to cloud record_set.id
             eventCode: string,
             gender: string,
             newMark: string,
             newMarkSortable: number,
             athleteName: string,
             teamName?: string,
             wind?: number,
             resultId: string                        → Desktop result UUID for audit
           }>
         }
         Returns: {
           updated: number,
           created: number,                          → New records (event had no prior record)
           errors: Array<{ eventCode: string, error: string }>
         }

GET    /api/sync/status                           → Check what's available for sync
         Returns: {
           recordSets: Array<{ id, name, abbreviation, recordCount, lastUpdated }>,
           organizationCount: number,
           lastSyncDown?: string,
           lastSyncUp?: string
         }
```

### Event Catalog

```
GET    /api/event-definitions                     → List all standard events
         ?venue=indoor                             → Filter by venue
         &category=RUN                             → Filter by category
         &wind_affected=true                       → Filter wind-affected events

GET    /api/event-definitions/:eventCode          → Get single event definition
```

---

## Sync Protocol — Desktop Integration

### Pre-Meet: Sync Down

The desktop app needs records and organization data before a meet starts. This is triggered from the desktop Settings → Cloud Sync page.

**Flow:**

1. Desktop operator opens Settings → Cloud Sync
2. Enters cloud API URL and API key (persisted in meet config)
3. Clicks "Sync Records"
4. Desktop calls `POST /api/auth/api-key` to get JWT
5. Desktop calls `GET /api/sync/status` to show available record sets
6. Operator selects which record sets to sync (checkboxes)
7. Desktop calls `POST /api/sync/down` with selected IDs
8. Response data is written to local SQLite:
   - `local_record_sets` ← record set metadata
   - `local_records` ← individual records
   - Teams table ← org data auto-populates linked teams

**Local SQLite Mapping:**

```typescript
// Cloud record_sets → local_record_sets
// Cloud records → local_records
// Cloud organizations → teams.organization_id reference

function syncRecordSetsDown(cloudData: SyncDownResponse): void {
  const db = getDatabase();

  db.transaction(() => {
    for (const rs of cloudData.recordSets) {
      // Upsert local_record_sets
      db.prepare(`
        INSERT INTO local_record_sets (id, name, abbreviation, scope, gender, season,
                                        organization, eligibility_rules, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          abbreviation = excluded.abbreviation,
          eligibility_rules = excluded.eligibility_rules,
          synced_at = datetime('now')
      `).run(rs.id, rs.name, rs.abbreviation, rs.scope,
             rs.gender, rs.season, rs.organization,
             JSON.stringify(rs.eligibilityRules));

      // Upsert records within the set
      for (const r of rs.records) {
        db.prepare(`
          INSERT INTO local_records (id, record_set_id, event_code, gender, mark, mark_sortable,
                                     athlete_name, team_name, meet_name, record_date, wind)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(record_set_id, event_code, gender) DO UPDATE SET
            mark = excluded.mark,
            mark_sortable = excluded.mark_sortable,
            athlete_name = excluded.athlete_name,
            team_name = excluded.team_name,
            meet_name = excluded.meet_name,
            record_date = excluded.record_date,
            wind = excluded.wind,
            pending_upload = 0
        `).run(r.id, rs.id, r.eventCode, r.gender, r.mark, r.markSortable,
               r.athleteName, r.teamName, r.meetName, r.recordDate, r.wind);
      }
    }
  })();
}
```

### Post-Meet: Sync Up

After a meet is completed, broken records are pushed back to the cloud.

**Flow:**

1. Meet completes, operator clicks "Upload Results" or "Sync Records"
2. Desktop queries `local_records WHERE pending_upload = 1`
3. Desktop calls `POST /api/sync/up` with broken records
4. Cloud updates `records` table, creates `record_history` entries
5. Cloud responds with success/failure per record
6. Desktop marks successfully synced records as `pending_upload = 0`

---

## Web Dashboard Pages

### Organizations Management

**`/organizations`** — List page
- Search bar with type-ahead (name, abbreviation)
- Filter chips: type (HS, College, Club...), state, conference
- Table: Logo thumbnail | Name | Abbreviation | Type | City, State | Conference | Athletes
- Bulk actions: CSV import, CSV export
- Click row → edit page

**`/organizations/new`** — Create page
- Form sections:
  - **Identity**: Name, abbreviation, short name, mascot
  - **Classification**: Type dropdown, NCAA division (conditional), conference, state association
  - **Location**: City, state, country
  - **Branding**: Logo upload (drag-drop, max 2MB, auto-resize), color picker (primary + secondary), dark variant upload
  - **Contact**: Head coach, AD, email, phone, website
  - **External IDs**: TFRRS, Athletic.net, DirectAthletics, MileSplit

**`/organizations/:id`** — Edit page (same form, pre-populated)

**`/organizations/:id/images`** — Image gallery management

### Records Management

**`/records`** — Record sets list
- Cards or table: Name | Abbreviation | Scope | Season | Gender | Records Count | Last Updated
- Quick actions: View records, Export, Edit

**`/records/new`** — Create record set
- Form:
  - Name, abbreviation, description
  - Scope dropdown (world, national, collegiate, state, conference, facility, meet, school)
  - Gender toggle (Men, Women, Both)
  - Season toggle (Indoor, Outdoor, Both)
  - Organization link (optional, search + select)
  - Eligibility rules builder (visual condition builder — add conditions, select type, enter value)

**`/records/:id`** — Record set detail + record list
- Header: Set name, scope badge, gender/season pills, eligibility rules display
- Table of records: Event | Gender | Mark | Holder | Team | Meet | Date | Wind | Verified
- Inline editing for corrections
- Bulk import button (CSV upload)
- Add single record button
- Export buttons (CSV, JSON, PDF)

**`/records/:id/history`** — Record change history
- Timeline view of all changes
- Filter by event, date range
- Shows previous → new values with meet context

### Sync Dashboard

**`/sync`** — Sync overview
- Recent sync operations (table with direction, type, counts, status)
- Manual sync trigger buttons
- API key management

### Settings

**`/settings`** — Platform settings
- API key generation and rotation
- User management (invite, roles)
- Event catalog management (view/edit event definitions)
- Default record set templates

---

## Seeding Data

The platform should be bootstrapped with seed data from JSON files. These files can live in the repo and be loaded via a seed script or admin import.

### Organization Seed Files

```
data/
├── organizations/
│   ├── ncaa-d1-schools.json        # All ~350 NCAA D1 track programs
│   ├── ncaa-d2-schools.json        # NCAA D2 programs
│   ├── ncaa-d3-schools.json        # NCAA D3 programs
│   ├── naia-schools.json           # NAIA programs
│   ├── juco-schools.json           # JUCO/community college programs
│   ├── sec-schools.json            # SEC conference (detailed with logos)
│   ├── tssaa-schools.json          # Tennessee HS schools
│   ├── ghsa-schools.json           # Georgia HS schools
│   ├── usatf-clubs.json            # Major USATF clubs
│   └── national-federations.json   # Country teams (World Athletics members)
├── records/
│   ├── world-records-outdoor.json  # WA outdoor world records
│   ├── world-records-indoor.json   # WA indoor world records
│   ├── ncaa-d1-outdoor.json        # NCAA D1 outdoor records
│   ├── ncaa-d1-indoor.json         # NCAA D1 indoor records
│   ├── nfhs-national-outdoor.json  # National HS outdoor records
│   ├── nfhs-national-indoor.json   # National HS indoor records
│   └── american-records.json       # USA national records
└── event-definitions/
    └── event-catalog.json          # Canonical event catalog (from desktop app)
```

### Organization JSON Format

```json
[
  {
    "name": "Vanderbilt University",
    "abbreviation": "VAND",
    "shortName": "Vandy",
    "mascot": "Commodores",
    "organizationType": "college",
    "ncaaDivision": "D1",
    "conference": "SEC",
    "city": "Nashville",
    "state": "TN",
    "country": "USA",
    "primaryColor": "#866D4B",
    "secondaryColor": "#000000",
    "website": "https://vucommodores.com/sports/track-field",
    "tfrrsId": "vanderbilt",
    "athleticNetId": "12345",
    "logo": "vanderbilt.png"
  }
]
```

Logos are stored as files alongside the JSON, referenced by filename. The seed script uploads them to Supabase Storage.

### Record JSON Format

```json
{
  "recordSet": {
    "name": "World Outdoor Records",
    "abbreviation": "WR",
    "scope": "world",
    "season": "outdoor",
    "eligibilityRules": [{ "type": "any" }]
  },
  "records": [
    {
      "eventCode": "100",
      "gender": "M",
      "mark": "9.58",
      "markSortable": 9.58,
      "athleteName": "Usain Bolt",
      "teamName": "Jamaica",
      "meetName": "2009 World Championships",
      "recordDate": "2009-08-16",
      "location": "Berlin, Germany",
      "wind": 0.9
    },
    {
      "eventCode": "100",
      "gender": "F",
      "mark": "10.49",
      "markSortable": 10.49,
      "athleteName": "Florence Griffith-Joyner",
      "teamName": "USA",
      "meetName": "1988 US Olympic Trials",
      "recordDate": "1988-07-16",
      "location": "Indianapolis, IN",
      "wind": 0.0
    }
  ]
}
```

---

## Supabase Configuration

### Storage Buckets

```
organization-logos/          → Public bucket for team logos
  ├── {org_id}/logo.png
  ├── {org_id}/logo-dark.png
  ├── {org_id}/wordmark.png
  └── {org_id}/photos/
```

**Bucket policies:**
- `organization-logos`: Public read, authenticated write
- Max file size: 2MB
- Allowed types: `image/png`, `image/jpeg`, `image/svg+xml`, `image/webp`

### Row Level Security (RLS)

```sql
-- Organizations: anyone can read, authenticated users can write
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read organizations" ON organizations FOR SELECT USING (true);
CREATE POLICY "Authenticated users can manage organizations" ON organizations
  FOR ALL USING (auth.role() = 'authenticated');

-- Record sets: public sets readable by all, private sets by owner
ALTER TABLE record_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public record sets are readable" ON record_sets
  FOR SELECT USING (is_public = true OR auth.uid() = created_by);
CREATE POLICY "Authenticated users can manage record sets" ON record_sets
  FOR ALL USING (auth.role() = 'authenticated');

-- Records: follow parent record set visibility
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Records inherit set visibility" ON records FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM record_sets rs
    WHERE rs.id = record_set_id
    AND (rs.is_public = true OR rs.created_by = auth.uid())
  ));
CREATE POLICY "Authenticated users can manage records" ON records
  FOR ALL USING (auth.role() = 'authenticated');
```

### Auth Configuration

- Email + password (primary)
- Magic link (for mobile-friendly access)
- Custom claims for roles: `admin`, `editor`, `viewer`
- API key auth for desktop sync (mapped to service role)

---

## Implementation Phases

### Phase 1: Foundation
1. Initialize Next.js 15 project with TypeScript
2. Configure Supabase project (database, auth, storage)
3. Set up Drizzle ORM with PostgreSQL schema
4. Create all tables with migrations
5. Seed event_definitions from desktop app's event-catalog.json
6. Basic auth flow (email/password login)
7. API key generation for desktop sync

### Phase 2: Organizations
1. Organizations CRUD API routes
2. Organizations list page with search + filters
3. Organization create/edit form with logo upload
4. Image management (Supabase Storage integration)
5. CSV import/export for bulk operations
6. Seed data: NCAA D1 schools, SEC conference, sample HS schools

### Phase 3: Record Sets & Records
1. Record set CRUD API routes
2. Record CRUD with history tracking
3. Record set detail page with record table
4. Eligibility rules builder UI component
5. Bulk CSV/JSON import for records
6. Seed data: World records, NCAA D1 records, sample facility records
7. Record history timeline view
8. Export (CSV, JSON, PDF)

### Phase 4: Desktop Sync API
1. `POST /api/sync/down` — cloud → desktop data export
2. `POST /api/sync/up` — desktop → cloud record updates
3. `GET /api/sync/status` — available data summary
4. Sync logging and audit trail
5. Desktop app: add Cloud Sync settings page
6. Desktop app: implement sync-down and sync-up logic
7. Incremental sync (only changes since last sync)

### Phase 5: Polish & Extras
1. Dashboard home page with stats
2. User management and invitations
3. Mobile-responsive layouts (for tablet access)
4. Record set templates (quick-create common sets)
5. Duplicate organization detection and merge
6. Webhook notifications for record breaks
7. Public record book pages (shareable URLs)

---

## Key Design Decisions

1. **Supabase over custom backend** — Auth, storage, RLS, and real-time all come built-in. Eliminates 60% of the infrastructure work compared to a custom Express + PostgreSQL setup.

2. **UUID primary keys everywhere** — Enables offline-first sync between desktop (SQLite UUIDs) and cloud (PostgreSQL UUIDs) without ID conflicts.

3. **JSON eligibility rules** — Stored as JSONB in PostgreSQL, parsed on the desktop. This keeps the rule format flexible without schema migrations for new condition types.

4. **Event codes as the mapping key** — Records don't reference specific meet events. They use standardized event codes ("100", "LJ") that are matched against meet events during record checking. This decouples records from any specific meet's event structure.

5. **Soft deletes for organizations and record sets** — `is_active` flag instead of hard delete. Prevents broken references in historical data.

6. **Record history as separate table** — Every record break creates a history entry. This provides a full audit trail and enables "historical records" views without complex versioning on the main records table.

7. **Organization logos in Supabase Storage** — Referenced by URL. Desktop app can download and cache logos for offline display. Cloud serves them directly for the web UI.

8. **team_type ↔ organization_type mapping** — The desktop app's `team_type` (simple 6-value enum) maps to the cloud's more detailed `organization_type`. The cloud can enrich "college" into "D1"/"D2"/"D3" via `ncaa_division`. On sync-down, the desktop receives the simplified `team_type` for its eligibility engine.

---

## File Structure

```
ptt-nexus-cloud/
├── .env.local                         # Supabase URL, anon key, service key
├── package.json
├── tsconfig.json
├── next.config.ts
├── drizzle.config.ts                  # Drizzle ORM config
├── tailwind.config.ts
├── supabase/
│   ├── config.toml                    # Supabase project config
│   └── migrations/                    # SQL migrations
│       ├── 001_initial_schema.sql
│       ├── 002_rls_policies.sql
│       └── 003_seed_event_definitions.sql
├── src/
│   ├── app/                           # Next.js App Router
│   │   ├── layout.tsx                 # Root layout with nav
│   │   ├── page.tsx                   # Dashboard home
│   │   ├── login/
│   │   ├── organizations/
│   │   │   ├── page.tsx               # List page
│   │   │   ├── new/page.tsx           # Create page
│   │   │   └── [id]/
│   │   │       ├── page.tsx           # Edit page
│   │   │       └── images/page.tsx    # Image gallery
│   │   ├── records/
│   │   │   ├── page.tsx               # Record sets list
│   │   │   ├── new/page.tsx           # Create record set
│   │   │   └── [id]/
│   │   │       ├── page.tsx           # Record set detail + records
│   │   │       └── history/page.tsx   # Record change history
│   │   ├── sync/
│   │   │   └── page.tsx               # Sync dashboard
│   │   ├── settings/
│   │   │   └── page.tsx               # Platform settings
│   │   └── api/
│   │       ├── auth/
│   │       │   └── api-key/route.ts
│   │       ├── organizations/
│   │       │   ├── route.ts           # GET list, POST create
│   │       │   ├── [id]/route.ts      # GET, PUT, DELETE single
│   │       │   ├── [id]/images/route.ts
│   │       │   ├── import/route.ts
│   │       │   └── export/route.ts
│   │       ├── record-sets/
│   │       │   ├── route.ts
│   │       │   ├── [id]/route.ts
│   │       │   ├── [id]/records/route.ts
│   │       │   ├── [id]/import/route.ts
│   │       │   └── [id]/export/route.ts
│   │       ├── records/
│   │       │   ├── [id]/route.ts
│   │       │   └── [id]/history/route.ts
│   │       ├── event-definitions/
│   │       │   └── route.ts
│   │       └── sync/
│   │           ├── down/route.ts
│   │           ├── up/route.ts
│   │           └── status/route.ts
│   ├── db/
│   │   ├── schema.ts                  # Drizzle schema definitions
│   │   ├── client.ts                  # Supabase client setup
│   │   └── queries/                   # Typed query modules
│   │       ├── organizations.ts
│   │       ├── record-sets.ts
│   │       ├── records.ts
│   │       └── sync.ts
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts              # Browser client
│   │   │   ├── server.ts              # Server client
│   │   │   └── admin.ts               # Service role client
│   │   ├── auth.ts                    # Auth helpers
│   │   └── utils.ts                   # Shared utilities
│   ├── components/
│   │   ├── ui/                        # Reusable UI primitives
│   │   ├── organizations/             # Org-specific components
│   │   ├── records/                   # Record-specific components
│   │   └── eligibility-builder.tsx    # Visual rule builder
│   └── types/
│       ├── index.ts                   # Shared types
│       ├── organizations.ts
│       ├── records.ts
│       └── sync.ts
├── data/                              # Seed data JSON files
│   ├── organizations/
│   │   ├── ncaa-d1-schools.json
│   │   ├── sec-schools.json
│   │   └── ...
│   ├── records/
│   │   ├── world-records-outdoor.json
│   │   ├── ncaa-d1-outdoor.json
│   │   └── ...
│   ├── event-definitions/
│   │   └── event-catalog.json         # Copied from desktop app
│   └── logos/                         # Organization logo images
│       ├── vanderbilt.png
│       ├── tennessee.png
│       └── ...
├── scripts/
│   ├── seed-event-definitions.ts      # Load event catalog into DB
│   ├── seed-organizations.ts          # Bulk-load organizations from JSON
│   ├── seed-records.ts                # Bulk-load records from JSON
│   └── upload-logos.ts                # Upload logo images to Supabase Storage
└── tests/
    ├── api/
    └── sync/
```

---

## Reference

- Desktop app spec: `../ptt-nexus-manager/docs/meet-management-app-spec.md`
- Desktop records engine: `../ptt-nexus-manager/src/main/records/index.ts`
- Desktop event catalog: `../ptt-nexus-manager/src/shared/data/event-catalog.json`
- Desktop shared types: `../ptt-nexus-manager/src/shared/types/`
- Governing body rules: `../ptt-nexus-manager/docs/governing-body-rules.md`

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  real,
  date,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ═══════════════════════════════════════════════════════════
// Organizations
// ═══════════════════════════════════════════════════════════

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Identity
  name: text('name').notNull(),
  abbreviation: text('abbreviation').notNull(),
  shortName: text('short_name'),
  mascot: text('mascot'),

  // Classification
  organizationType: text('organization_type').notNull(), // OrganizationType
  genderDesignation: text('gender_designation'), // 'men', 'women', 'coed', null
  ncaaDivision: text('ncaa_division'), // 'D1', 'D2', 'D3', null
  naiaMember: boolean('naia_member').default(false),
  jucoMember: boolean('juco_member').default(false),
  conference: text('conference'),
  subConference: text('sub_conference'),
  stateAssociation: text('state_association'),

  // Location
  city: text('city'),
  state: text('state'),
  country: text('country').default('USA'),

  // Branding
  primaryColor: text('primary_color'),
  secondaryColor: text('secondary_color'),
  logoUrl: text('logo_url'),
  logoDarkUrl: text('logo_dark_url'),
  wordmarkUrl: text('wordmark_url'),

  // Contact
  headCoach: text('head_coach'),
  assistantCoach: text('assistant_coach'),
  athleticDirector: text('athletic_director'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  website: text('website'),

  // External IDs
  tfrrsId: text('tfrrs_id'),
  athleticNetId: text('athletic_net_id'),
  directAthleticsId: text('direct_athletics_id'),
  milesplitId: text('milesplit_id'),
  mshsaaId: text('mshsaa_id'),
  ncaaSlug: text('ncaa_slug'),

  // Metadata
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  createdBy: uuid('created_by'),
}, (table) => [
  index('idx_orgs_name').on(table.name),
  index('idx_orgs_abbreviation').on(table.abbreviation),
  index('idx_orgs_type').on(table.organizationType),
  index('idx_orgs_state').on(table.state),
  index('idx_orgs_conference').on(table.conference),
  uniqueIndex('idx_orgs_mshsaa_id').on(table.mshsaaId),
  uniqueIndex('idx_orgs_ncaa_slug').on(table.ncaaSlug),
]);

// ═══════════════════════════════════════════════════════════
// Organization Images
// ═══════════════════════════════════════════════════════════

export const organizationImages = pgTable('organization_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url').notNull(),
  imageType: text('image_type').notNull(), // 'logo', 'logo_dark', 'wordmark', 'banner', 'photo'
  caption: text('caption'),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_org_images_org').on(table.organizationId),
]);

// ═══════════════════════════════════════════════════════════
// Event Definitions (canonical event catalog)
// ═══════════════════════════════════════════════════════════

export const eventDefinitions = pgTable('event_definitions', {
  id: text('id').primaryKey(), // matches CatalogEvent.id from desktop
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  eventType: text('event_type').notNull(),
  category: text('category').notNull(), // STRAIGHT, RUN, RELAY, FIELD, COMBINED
  indRel: text('ind_rel').notNull().default('I'), // I=individual, R=relay
  distance: real('distance'),
  units: text('units').notNull().default('M'),
  venueFilter: text('venue_filter').notNull().default('both'), // outdoor, indoor, both
  sortOrder: integer('sort_order').notNull().default(0),

  // Record-specific
  isWindAffected: boolean('is_wind_affected').default(false),
  lowerIsBetter: boolean('lower_is_better').default(true),
  markFormat: text('mark_format').default('time'), // 'time', 'distance', 'height'

  // Display
  eventCode: text('event_code').notNull(),
  genderNeutralName: text('gender_neutral_name'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_event_defs_code').on(table.eventCode),
  index('idx_event_defs_type').on(table.eventType),
  index('idx_event_defs_venue').on(table.venueFilter),
]);

// ═══════════════════════════════════════════════════════════
// Record Sets
// ═══════════════════════════════════════════════════════════

export const recordSets = pgTable('record_sets', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Identity
  name: text('name').notNull(),
  abbreviation: text('abbreviation').notNull(),
  description: text('description'),

  // Scope
  scope: text('scope').notNull(), // 'world', 'national', 'collegiate', 'state', 'conference', 'facility', 'meet', 'school', 'custom'

  // Filters
  gender: text('gender'), // 'M', 'F', null (both)
  season: text('season'), // 'indoor', 'outdoor', null (both)

  // Owning organization
  organizationId: uuid('organization_id').references(() => organizations.id),

  // Eligibility rules (JSON array of conditions, AND logic)
  eligibilityRules: jsonb('eligibility_rules').default([]),

  // Metadata
  isActive: boolean('is_active').default(true),
  isPublic: boolean('is_public').default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  createdBy: uuid('created_by'),
}, (table) => [
  index('idx_record_sets_scope').on(table.scope),
  index('idx_record_sets_org').on(table.organizationId),
  index('idx_record_sets_active').on(table.isActive),
]);

// ═══════════════════════════════════════════════════════════
// Records
// ═══════════════════════════════════════════════════════════

export const records = pgTable('records', {
  id: uuid('id').primaryKey().defaultRandom(),
  recordSetId: uuid('record_set_id').notNull().references(() => recordSets.id, { onDelete: 'cascade' }),

  // What event
  eventCode: text('event_code').notNull(),
  gender: text('gender').notNull(), // 'M' or 'F'

  // The record itself
  mark: text('mark').notNull(), // display string: "9.58", "2:01.45", "8.95m"
  markSortable: real('mark_sortable').notNull(), // numeric for comparison

  // Who / when / where
  athleteName: text('athlete_name'),
  athleteId: uuid('athlete_id'),
  teamName: text('team_name'),
  organizationId: uuid('organization_id').references(() => organizations.id),
  meetName: text('meet_name'),
  recordDate: date('record_date'),
  location: text('location'),

  // Conditions
  wind: real('wind'),
  altitudeAdjusted: boolean('altitude_adjusted').default(false),
  autoTimed: boolean('auto_timed').default(true),

  // Audit
  notes: text('notes'),
  source: text('source'),
  verified: boolean('verified').default(false),
  verifiedBy: uuid('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),

  // Sync
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  brokenAtMeet: text('broken_at_meet'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_records_unique').on(table.recordSetId, table.eventCode, table.gender),
  index('idx_records_set').on(table.recordSetId),
  index('idx_records_event').on(table.eventCode),
  index('idx_records_gender').on(table.gender),
  index('idx_records_org').on(table.organizationId),
]);

// ═══════════════════════════════════════════════════════════
// Record History (audit trail)
// ═══════════════════════════════════════════════════════════

export const recordHistory = pgTable('record_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),

  // Previous values
  previousMark: text('previous_mark').notNull(),
  previousMarkSortable: real('previous_mark_sortable').notNull(),
  previousAthleteName: text('previous_athlete_name'),
  previousTeamName: text('previous_team_name'),
  previousMeetName: text('previous_meet_name'),
  previousRecordDate: date('previous_record_date'),
  previousWind: real('previous_wind'),

  // What replaced it
  newMark: text('new_mark').notNull(),
  newAthleteName: text('new_athlete_name'),
  brokenAtMeet: text('broken_at_meet'),
  brokenDate: date('broken_date'),

  // Source
  source: text('source'), // 'desktop_sync', 'manual_edit', 'bulk_import'
  syncedFromMeetId: text('synced_from_meet_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_record_history_record').on(table.recordId),
  index('idx_record_history_date').on(table.brokenDate),
]);

// ═══════════════════════════════════════════════════════════
// Online Relay Entry — Meet Sessions
// ═══════════════════════════════════════════════════════════

export const meetRelaySessions = pgTable('meet_relay_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Token embedded in QR URLs for the meet — possession = auth
  meetToken: text('meet_token').notNull().unique(),

  meetName: text('meet_name').notNull(),
  meetDate: text('meet_date'), // ISO date string e.g. "2026-04-26"

  // JSON array: [{id, name, gender, distance, legs}]
  eventsJson: text('events_json').notNull().default('[]'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_relay_sessions_token').on(table.meetToken),
]);

// ═══════════════════════════════════════════════════════════
// Online Relay Entry — Per-Team Access
// ═══════════════════════════════════════════════════════════

export const teamRelayAccess = pgTable('team_relay_access', {
  id: uuid('id').primaryKey().defaultRandom(),

  meetSessionId: uuid('meet_session_id').notNull().references(() => meetRelaySessions.id, { onDelete: 'cascade' }),

  // Unique per-team token embedded in QR URL
  teamToken: text('team_token').notNull().unique(),

  // Local desktop team ID (for reference when syncing back)
  teamId: text('team_id').notNull(),
  teamName: text('team_name').notNull(),

  // JSON array of athletes from meet DB: [{id, firstName, lastName, bib, gender}]
  rosterJson: text('roster_json').notNull().default('[]'),

  // JSON string[] of event IDs this team is entered in; null = show all (backward compat)
  enteredEventsJson: text('entered_events_json'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_team_relay_session').on(table.meetSessionId),
  index('idx_team_relay_token').on(table.teamToken),
]);

// ═══════════════════════════════════════════════════════════
// Online Relay Entry — Coach Submissions
// ═══════════════════════════════════════════════════════════

export const relayOnlineEntries = pgTable('relay_online_entries', {
  id: uuid('id').primaryKey().defaultRandom(),

  teamAccessId: uuid('team_access_id').notNull().references(() => teamRelayAccess.id, { onDelete: 'cascade' }),
  meetSessionId: uuid('meet_session_id').notNull(),

  // Local desktop event ID (passed back when syncing)
  eventId: text('event_id').notNull(),
  eventName: text('event_name').notNull(),

  // JSON array: [{leg, athleteId, firstName, lastName}]
  legsJson: text('legs_json').notNull().default('[]'),

  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),

  // Set when the coach clicks "Finalize & Lock" — signals entry is confirmed
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
}, (table) => [
  index('idx_relay_entries_team').on(table.teamAccessId),
  index('idx_relay_entries_session').on(table.meetSessionId),
  index('idx_relay_entries_event').on(table.eventId),
]);

// ═══════════════════════════════════════════════════════════
// Desktop API Keys
// ═══════════════════════════════════════════════════════════

/**
 * API keys issued to PTT Nexus Manager desktop instances.
 * Used to authenticate /api/relay/* and /api/organizations calls.
 */
export const desktopApiKeys = pgTable('desktop_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Human-readable label set by the admin (e.g. "Main Office", "Coach's Laptop")
  label: text('label').notNull(),

  // 32-char hex random key — stored plaintext for easy lookup
  key: text('key').notNull(),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('idx_desktop_api_keys_key').on(table.key),
]);

// ═══════════════════════════════════════════════════════════
// Sync Logs
// ═══════════════════════════════════════════════════════════

export const syncLogs = pgTable('sync_logs', {
  id: uuid('id').primaryKey().defaultRandom(),

  direction: text('direction').notNull(), // 'down', 'up'
  syncType: text('sync_type').notNull(), // 'record_sets', 'organizations', 'full'

  // What was synced
  recordSetsSynced: integer('record_sets_synced').default(0),
  recordsSynced: integer('records_synced').default(0),
  recordsBroken: integer('records_broken').default(0),
  organizationsSynced: integer('organizations_synced').default(0),

  // Source
  desktopMeetName: text('desktop_meet_name'),
  desktopMeetId: text('desktop_meet_id'),
  clientIp: text('client_ip'),

  // Status
  status: text('status').notNull().default('completed'),
  errorMessage: text('error_message'),

  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  initiatedBy: uuid('initiated_by'),
}, (table) => [
  index('idx_sync_logs_date').on(table.startedAt),
  index('idx_sync_logs_type').on(table.syncType),
]);

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
  unique,
  index,
  primaryKey,
  type AnyPgColumn,
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
// Venues, courses, meet series
// supabase/migrations/records_venues_courses.sql
// ═══════════════════════════════════════════════════════════

/** The place: a cross country park, a track facility. */
export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  city: text('city'),
  state: text('state'),
  country: text('country').default('USA'),
  organizationId: uuid('organization_id').references(() => organizations.id),
  setting: text('setting'), // 'outdoor' | 'indoor' | null
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/**
 * One course layout at a venue. A reroute is a new row pointing at the one it
 * replaced; the old row is retired, not edited, so records set on it still
 * say which layout they were set on.
 */
export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => venues.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  distanceMeters: real('distance_meters').notNull(),
  kml: text('kml'),
  profileJson: jsonb('profile_json'),
  totalGainMeters: real('total_gain_meters'),
  totalLossMeters: real('total_loss_meters'),
  difficultyJson: jsonb('difficulty_json').notNull().default([]),
  splitPointsJson: jsonb('split_points_json').notNull().default([]),
  notes: text('notes'),
  revision: integer('revision').notNull().default(1),
  replacesCourseId: uuid('replaces_course_id').references((): AnyPgColumn => courses.id),
  isActive: boolean('is_active').default(true),
  updatedByKeyId: uuid('updated_by_key_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_courses_venue').on(table.venueId),
]);

/**
 * Every set of difficulty ratings a course has had: when, from which meet,
 * and whether it was put back from an earlier one. Any can be restored.
 */
export const courseRatingLog = pgTable('course_rating_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  difficultyJson: jsonb('difficulty_json').notNull().default([]),
  segmentCount: integer('segment_count').notNull().default(0),
  changeKind: text('change_kind').notNull().default('saved'), // 'saved' | 'restored'
  meetName: text('meet_name'),
  changedBy: text('changed_by'),
  desktopKeyId: uuid('desktop_key_id'),
  restoredFromId: uuid('restored_from_id').references((): AnyPgColumn => courseRatingLog.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_course_rating_log').on(table.courseId, table.createdAt),
]);

/** A meet as it comes round each year; what meet records belong to. */
export const meetSeries = pgTable('meet_series', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  venueId: uuid('venue_id').references(() => venues.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  level: text('level'), // RecordLevel | null
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

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

  // What the set is anchored to: a venue (venue and course records, track
  // facility records) or a meet series (meet and race records). Both null for
  // state, conference, school and national sets.
  venueId: uuid('venue_id').references(() => venues.id),
  meetSeriesId: uuid('meet_series_id').references(() => meetSeries.id),

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
  index('idx_record_sets_venue').on(table.venueId),
  index('idx_record_sets_series').on(table.meetSeriesId),
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

  // Where and at what level. A venue record is pinned to a course; a college
  // 5K is never a high school 5K record, so the level is part of the key.
  courseId: uuid('course_id').references(() => courses.id),
  level: text('level'), // RecordLevel | null (any level)
  divisionKey: text('division_key'), // a race inside a meet series: 'Gold', 'Open'
  holderNo: integer('holder_no').notNull().default(1), // 2, 3… for a tie
  carriedFromCourseId: uuid('carried_from_course_id').references(() => courses.id),
  revision: integer('revision').notNull().default(1),

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
  unique('records_key_unique')
    .on(table.recordSetId, table.eventCode, table.gender, table.courseId, table.level, table.divisionKey, table.holderNo)
    .nullsNotDistinct(),
  index('idx_records_set').on(table.recordSetId),
  index('idx_records_course').on(table.courseId),
  index('idx_records_updated').on(table.updatedAt),
  index('idx_records_event').on(table.eventCode),
  index('idx_records_gender').on(table.gender),
  index('idx_records_org').on(table.organizationId),
]);

// ═══════════════════════════════════════════════════════════
// Record Splits — the holder's splits, keyed by distance
// ═══════════════════════════════════════════════════════════

export const recordSplits = pgTable('record_splits', {
  id: uuid('id').primaryKey().defaultRandom(),
  recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  distanceMeters: real('distance_meters').notNull(),
  label: text('label'),
  seconds: real('seconds').notNull(),
}, (table) => [
  uniqueIndex('idx_record_splits_key').on(table.recordId, table.distanceMeters),
]);

// ═══════════════════════════════════════════════════════════
// Record History (audit trail)
// ═══════════════════════════════════════════════════════════

export const recordHistory = pgTable('record_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Kept when the record is deleted, so the delete can be reverted.
  recordId: uuid('record_id').references(() => records.id, { onDelete: 'set null' }),
  recordSetId: uuid('record_set_id'),

  // 'created' | 'broken' | 'edited' | 'deleted' | 'reverted' | 'carried_over'
  changeKind: text('change_kind'),
  // The whole record, splits included, before and after. Null before = it
  // was created; null after = it was deleted. Reverting puts `before` back.
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  revertedFromId: uuid('reverted_from_id').references((): AnyPgColumn => recordHistory.id),
  desktopKeyId: uuid('desktop_key_id'),
  changedBy: text('changed_by'),

  // Previous values
  previousMark: text('previous_mark'),
  previousMarkSortable: real('previous_mark_sortable'),
  previousAthleteName: text('previous_athlete_name'),
  previousTeamName: text('previous_team_name'),
  previousMeetName: text('previous_meet_name'),
  previousRecordDate: date('previous_record_date'),
  previousWind: real('previous_wind'),

  // What replaced it
  newMark: text('new_mark'),
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
  index('idx_record_history_set').on(table.recordSetId, table.createdAt),
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

  // JSON {eventId, teamLetter}[] — one entry per (event, letter) combo the team is in.
  // Supersedes enteredEventsJson when present. Null = fall back to enteredEventsJson.
  enteredTeamsJson: text('entered_teams_json'),

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

  // Which relay team variant (A, B, C…) within a school for this event
  teamLetter: text('team_letter').notNull().default('A'),

  // JSON array: [{leg, athleteId, firstName, lastName}]
  legsJson: text('legs_json').notNull().default('[]'),

  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),

  // Set when the coach clicks "Finalize & Lock" — signals entry is confirmed
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),

  // True when this entry was seeded by a Nexus publish/update and the coach
  // has NOT yet made any changes. Set to false the moment the coach saves.
  // The update endpoint only overwrites entries where this is still true.
  seededByDesktop: boolean('seeded_by_desktop').notNull().default(false),
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

// ═══════════════════════════════════════════════════════════
// Cross Country Declarations — Meet Sessions
// ═══════════════════════════════════════════════════════════

/**
 * A cross country meet published for coaches to declare into.
 *
 * Deliberately its own tables rather than a flag on the relay ones. The two
 * products ask coaches different questions — relay wants four names in an
 * order, cross country wants which race each runner is in — and a shared
 * table would mean every read on either side carrying an "is this the other
 * kind" branch that nobody would keep straight.
 */
export const meetDeclarationSessions = pgTable('meet_declaration_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Token embedded in QR URLs for the meet — possession = auth
  meetToken: text('meet_token').notNull().unique(),

  meetName: text('meet_name').notNull(),
  meetDate: text('meet_date'), // ISO date string e.g. "2026-10-03"

  // JSON array: [{id, name, gender, distanceLabel, scheduledTime, deadlineMinutes}]
  racesJson: text('races_json').notNull().default('[]'),

  // What this meet calls the two sides of its field: 'boys_girls' or
  // 'men_women'. Sent by the desktop so the coach's form uses the same words
  // as everything else the meet prints.
  genderTerms: text('gender_terms').notNull().default('boys_girls'),

  /**
   * The live dashboard's link (/declare/dashboard/{token}). Possession is the
   * key, as with the coach links, but a token of its own: it can be shown on
   * a screen or handed to a director without giving out the meet token.
   * Made on publish, and on the first update of a session from before it.
   */
  dashboardToken: text('dashboard_token').unique(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_decl_sessions_token').on(table.meetToken),
]);

// ═══════════════════════════════════════════════════════════
// Cross Country Declarations — Per-Team Access
// ═══════════════════════════════════════════════════════════

export const teamDeclarationAccess = pgTable('team_declaration_access', {
  id: uuid('id').primaryKey().defaultRandom(),

  meetSessionId: uuid('meet_session_id').notNull()
    .references(() => meetDeclarationSessions.id, { onDelete: 'cascade' }),

  // Unique per-team token embedded in the QR URL
  teamToken: text('team_token').notNull().unique(),

  // Local desktop team ID, passed back when syncing
  teamId: text('team_id').notNull(),
  teamName: text('team_name').notNull(),

  /**
   * The squad as the desktop sees it, and which races each runner may be put
   * in. JSON array of:
   *   {id, firstName, lastName, bib, gender, year, eligibleRaceIds: string[]}
   *
   * Eligibility is decided on the desktop and sent, rather than worked out
   * here from gender: the rules that govern it — gender, division, entry caps
   * — live there, and a second implementation would drift from the first.
   */
  rosterJson: text('roster_json').notNull().default('[]'),

  /** The school's Nexus Online organization, when the desk knows it: its logo, colors and headshots. */
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),

  /** When the coach first opened the form, and most recently. Null: never opened. */
  openedAt: timestamp('opened_at', { withTimezone: true }),
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_decl_team_session').on(table.meetSessionId),
  index('idx_decl_team_token').on(table.teamToken),
]);

// ═══════════════════════════════════════════════════════════
// Cross Country Declarations — Coach Submissions
// ═══════════════════════════════════════════════════════════

/**
 * One row per athlete: the race the coach put them in, or a scratch.
 *
 * A row per athlete rather than a blob per race, because that is the shape of
 * the question — "which race is this runner in" — and because a coach moving
 * one runner from the Gold race to the Open race is then one row changing
 * rather than two blobs rewritten, which is what makes the sync back
 * idempotent and the audit trail readable.
 */
export const declarationSubmissions = pgTable('declaration_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),

  teamAccessId: uuid('team_access_id').notNull()
    .references(() => teamDeclarationAccess.id, { onDelete: 'cascade' }),
  meetSessionId: uuid('meet_session_id').notNull(),

  // Local desktop athlete ID
  athleteId: text('athlete_id').notNull(),

  /**
   * 'declared' — running, in raceId
   * 'scratched' — not running
   * A runner the coach has not answered for has no row at all, which is how
   * "not yet decided" is told apart from "decided, and the answer is out".
   */
  status: text('status').notNull(),

  // The race they are declared in. Null for a scratch.
  raceId: text('race_id'),

  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_decl_sub_team').on(table.teamAccessId),
  index('idx_decl_sub_session').on(table.meetSessionId),
  uniqueIndex('idx_decl_sub_athlete').on(table.teamAccessId, table.athleteId),
]);

// ═══════════════════════════════════════════════════════════
// Cross Country Declarations — Finalizing a race
// ═══════════════════════════════════════════════════════════

/**
 * A school saying it is done with one race.
 *
 * Per race rather than per school, because a meet runs several and a coach is
 * done with the Gold long before they have decided the Open. Finalizing the
 * Gold locks who is in it; a runner not in it is untouched and can still be
 * put in a later race, which is the whole reason this is not one switch for
 * the whole form.
 */
export const declarationFinalizations = pgTable('declaration_finalizations', {
  id: uuid('id').primaryKey().defaultRandom(),

  teamAccessId: uuid('team_access_id').notNull()
    .references(() => teamDeclarationAccess.id, { onDelete: 'cascade' }),
  meetSessionId: uuid('meet_session_id').notNull(),

  raceId: text('race_id').notNull(),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_decl_final_team').on(table.teamAccessId),
  index('idx_decl_final_session').on(table.meetSessionId),
  uniqueIndex('idx_decl_final_race').on(table.teamAccessId, table.raceId),
]);

// ═══════════════════════════════════════════════════════════
// Organisation submissions
// ═══════════════════════════════════════════════════════════

/**
 * A school a meet met that the org database does not have.
 *
 * Org matching turns up teams with no organisation behind them, and the
 * operator is mid-meet with no time to fill in a school's colors, city and
 * conference. So the team is pushed here instead: what the meet knew, which
 * meet it came from, and nothing else.
 *
 * Deliberately not the organizations table. Race-day entry files carry
 * misspellings, one-off "Unattached" rows and a school entered twice under
 * two names, and every one of those would otherwise become a permanent row
 * in the data that feeds every results page. Somebody approves them, and
 * approval is what creates the organisation.
 *
 * A school pushed twice is one row: the unique index is on the normalised
 * name and level, so fourteen races at one meet — or the same school at the
 * next meet — do not make fourteen things to review.
 */
export const organizationSubmissions = pgTable('organization_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),

  // What the meet knew.
  name: text('name').notNull(),
  /** Lower case, punctuation stripped — what "seen this one already" means. */
  nameKey: text('name_key').notNull(),
  abbreviation: text('abbreviation'),
  organizationType: text('organization_type').notNull(),
  city: text('city'),
  state: text('state'),

  // Where it came from, so a reviewer can go and look.
  meetName: text('meet_name'),
  meetDate: date('meet_date'),
  /** Entries under this name at the meet it came from — a squad or a stray. */
  athleteCount: integer('athlete_count'),

  /** pending | approved | rejected */
  status: text('status').notNull().default('pending'),
  /** The organisation an approval created, so the decision is traceable. */
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  /** Why it was turned down — a misspelling of a school already in here, say. */
  reviewNote: text('review_note'),

  /** How many times it has been pushed, across every meet. */
  timesSeen: integer('times_seen').notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('idx_org_subs_key').on(table.nameKey, table.organizationType),
  index('idx_org_subs_status').on(table.status),
  index('idx_org_subs_seen').on(table.lastSeenAt),
]);

// ═══════════════════════════════════════════════════════════
// Organisation tags
// ═══════════════════════════════════════════════════════════

/**
 * How a school is classified, as things you can filter by.
 *
 * A school is not one level, it is a stack of them — College, NCAA DI, SEC;
 * High School, MSHSAA, Class 1 — and which one you want depends on what you
 * are doing. Seeding a meet wants the conference; a state championship wants
 * the class; org matching wants the level and nothing else.
 *
 * Most of this was already on the organisation as fixed columns:
 * organization_type, ncaa_division, conference, state_association. Those
 * stay, because a great deal reads them. Tags sit alongside and are
 * backfilled from them, and they add the thing the columns had no room for —
 * a state's own classes, which is where "Class 1" was meant to go and had
 * nowhere.
 *
 * A controlled list rather than free text on the team. Free tags on two
 * thousand schools become "SEC", "S.E.C." and "Southeastern Conference" by
 * the end of one season, which is the same problem the org database exists
 * to solve.
 */
export const orgTags = pgTable('org_tags', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** level | governing_body | conference | class | region */
  kind: text('kind').notNull(),
  /** As it is shown: "NCAA DI", "MSHSAA", "Class 1". */
  name: text('name').notNull(),
  /** Lower case and hyphenated, for the API to take as a filter. */
  slug: text('slug').notNull(),

  /**
   * What it sits under: a conference under its governing body, a governing
   * body under a level. Null for a level, which is the top.
   *
   * Nested rather than flat because the tags are only meaningful in their
   * chain — "Class 1" says nothing without MSHSAA over it, and there is a
   * Division I in several governing bodies.
   */
  parentId: uuid('parent_id'),

  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_org_tags_slug').on(table.slug),
  index('idx_org_tags_kind').on(table.kind),
  index('idx_org_tags_parent').on(table.parentId),
]);

/** Which tags a school carries. A school has as many as it has. */
export const organizationTags = pgTable('organization_tags', {
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull()
    .references(() => orgTags.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_org_tags_pair').on(table.organizationId, table.tagId),
  index('idx_org_tags_by_tag').on(table.tagId),
]);

// ═══════════════════════════════════════════════════════════
// Admin users
// ═══════════════════════════════════════════════════════════

/**
 * Who may sign in to the dashboard.
 *
 * A shared password got the door shut quickly, but it cannot be taken off one
 * person: the only way to remove somebody is to change it for everybody and
 * tell the rest. So each person gets their own, and revoking is switching one
 * row off.
 *
 * Passwords are stored as scrypt hashes with a per-user salt — never the
 * password, and never a bare hash that the same password would produce twice.
 *
 * The ADMIN_PASSWORD environment variable stays as a way in when no user can
 * sign in: the first deploy before anybody exists, and the day somebody
 * revokes the last account by mistake. It is a bootstrap, not an account, and
 * the settings page says so.
 */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),

  email: text('email').notNull(),
  name: text('name'),
  /** scrypt, as salt:hash — both hex. */
  passwordHash: text('password_hash').notNull(),

  /**
   * 'admin' may manage users; 'editor' may change data but not people.
   *
   * Two is enough for the size of this. The check is one place, so a third
   * is a row in a table rather than a rewrite.
   */
  role: text('role').notNull().default('editor'),

  /** Off rather than deleted, so who did what still reads back. */
  isActive: boolean('is_active').notNull().default(true),

  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  createdBy: uuid('created_by'),
}, (table) => [
  uniqueIndex('idx_admin_users_email').on(table.email),
  index('idx_admin_users_active').on(table.isActive),
]);

// ═══════════════════════════════════════════════════════════
// Cross Country Polls and Rankings (USTFCCCA)
// ═══════════════════════════════════════════════════════════

/**
 * Every team the USTFCCCA has ranked, and which organization it is.
 *
 * Matched once and kept: their team id is stable across seasons, so a school
 * matched this year is still matched next year. See supabase/migrations/
 * xc_rankings.sql for the whole design.
 */
export const rankingTeams = pgTable('ranking_teams', {
  ustfcccaTeamId: integer('ustfccca_team_id').primaryKey(),
  teamName: text('team_name').notNull(),
  teamShort: text('team_short'),
  abbrev: text('abbrev'),
  divisionId: integer('division_id'),
  division: text('division'),
  conference: text('conference'),
  region: text('region'),
  athnetTeamId: integer('athnet_team_id'),

  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  /** 'auto' | 'confirmed' | 'review' | 'unmatched' | 'ignored' */
  matchStatus: text('match_status').notNull().default('unmatched'),
  matchNote: text('match_note'),
  matchedAt: timestamp('matched_at', { withTimezone: true }),
  matchedBy: text('matched_by'),

  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_ranking_teams_org').on(table.organizationId),
  index('idx_ranking_teams_status').on(table.matchStatus),
]);

/** One released list: season, gender, type, division, region and week. */
export const rankingLists = pgTable('ranking_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  gender: text('gender').notNull(),
  /** 'national' | 'regional' */
  kind: text('kind').notNull(),
  typeId: integer('type_id').notNull(),
  listType: text('list_type'),
  divisionId: integer('division_id').notNull(),
  divisionName: text('division_name'),
  /** 0 for a national list. */
  regionId: integer('region_id').notNull().default(0),
  regionName: text('region_name'),
  /** 0 preseason, 99 final. */
  week: integer('week').notNull(),
  releaseDateEt: text('release_date_et'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  collectionId: integer('collection_id'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_ranking_lists_key').on(table.season, table.gender, table.typeId, table.divisionId, table.regionId, table.week),
  index('idx_ranking_lists_released').on(table.releasedAt),
]);

/** A team's place on one list. */
export const rankingEntries = pgTable('ranking_entries', {
  listId: uuid('list_id').notNull().references(() => rankingLists.id, { onDelete: 'cascade' }),
  ustfcccaTeamId: integer('ustfccca_team_id').notNull().references(() => rankingTeams.ustfcccaTeamId, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  /** Null when receiving votes; isRv is then true. */
  rank: integer('rank'),
  isRv: boolean('is_rv').notNull().default(false),
  score: real('score'),
  firstPlaceVotes: integer('first_place_votes'),
  /** Their 999 sentinel is stored as null with prevIsRv true. */
  prevRank: integer('prev_rank'),
  prevIsRv: boolean('prev_is_rv').notNull().default(false),
  rankChange: integer('rank_change'),
  conference: text('conference'),
  region: text('region'),
}, (table) => [
  primaryKey({ columns: [table.listId, table.ustfcccaTeamId] }),
  index('idx_ranking_entries_team').on(table.ustfcccaTeamId),
]);

/** Each read of the USTFCCCA API. */
export const rankingPulls = pgTable('ranking_pulls', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 'cron' | 'manual' */
  trigger: text('trigger').notNull(),
  /** 'ok' | 'unchanged' | 'failed' */
  status: text('status').notNull(),
  httpStatus: integer('http_status'),
  etag: text('etag'),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  season: integer('season'),
  listsSeen: integer('lists_seen').default(0),
  listsNew: integer('lists_new').default(0),
  teamsSeen: integer('teams_seen').default(0),
  teamsNew: integer('teams_new').default(0),
  autoMatched: integer('auto_matched').default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => [
  index('idx_ranking_pulls_started').on(table.startedAt),
]);

/** Switches for the rankings reader: 'auto_pull' is whether the daily read runs. */
export const rankingSettings = pgTable('ranking_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  updatedBy: text('updated_by'),
});

// ═══════════════════════════════════════════════════════════
// Athlete headshots
// ═══════════════════════════════════════════════════════════

/**
 * A runner's headshot, kept once and found again by school, season and name.
 * See supabase/migrations/athlete_headshots.sql.
 */
export const athleteHeadshots = pgTable('athlete_headshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  /** The fall year: 2026 for 2026-27. */
  season: integer('season').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  /** "last|first", letters only: see headshotNameKey. */
  nameKey: text('name_key').notNull(),
  gender: text('gender'),
  classYear: text('class_year'),
  rosterUrl: text('roster_url'),
  rosterPlayerId: text('roster_player_id'),
  photoSourceUrl: text('photo_source_url'),
  cutoutPath: text('cutout_path'),
  originalPath: text('original_path'),
  width: integer('width'),
  height: integer('height'),
  bytes: integer('bytes'),
  sha256: text('sha256'),
  /** 'ok' | 'review' | 'hidden' */
  status: text('status').notNull().default('ok'),
  review: text('review').array().notNull().default([]),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_athlete_headshots_key').on(table.organizationId, table.season, table.nameKey),
  index('idx_athlete_headshots_season').on(table.season, table.organizationId),
]);

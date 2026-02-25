// ═══════════════════════════════════════════════════════════
// Organization Types
// ═══════════════════════════════════════════════════════════

export type OrganizationType =
  | 'professional'
  | 'college'
  | 'high_school'
  | 'middle_school'
  | 'club'
  | 'national_federation'
  | 'unattached'
  | 'other';

export const ORGANIZATION_TYPES: { value: OrganizationType; label: string }[] = [
  { value: 'college', label: 'College / University' },
  { value: 'high_school', label: 'High School' },
  { value: 'middle_school', label: 'Middle School' },
  { value: 'club', label: 'Club' },
  { value: 'professional', label: 'Professional' },
  { value: 'national_federation', label: 'National Federation' },
  { value: 'unattached', label: 'Unattached' },
  { value: 'other', label: 'Other' },
];

export type NcaaDivision = 'D1' | 'D2' | 'D3';

export const NCAA_DIVISIONS: { value: NcaaDivision; label: string }[] = [
  { value: 'D1', label: 'Division I' },
  { value: 'D2', label: 'Division II' },
  { value: 'D3', label: 'Division III' },
];

// ═══════════════════════════════════════════════════════════
// Record Types
// ═══════════════════════════════════════════════════════════

export type RecordScope =
  | 'world'
  | 'national'
  | 'collegiate'
  | 'state'
  | 'conference'
  | 'facility'
  | 'meet'
  | 'school'
  | 'custom';

export const RECORD_SCOPES: { value: RecordScope; label: string }[] = [
  { value: 'world', label: 'World' },
  { value: 'national', label: 'National' },
  { value: 'collegiate', label: 'Collegiate' },
  { value: 'state', label: 'State' },
  { value: 'conference', label: 'Conference' },
  { value: 'facility', label: 'Facility' },
  { value: 'meet', label: 'Meet' },
  { value: 'school', label: 'School' },
  { value: 'custom', label: 'Custom' },
];

export type RecordCondition =
  | { type: 'any' }
  | { type: 'team_type'; value: string }
  | { type: 'organization_id'; value: string }
  | { type: 'organization_type'; value: OrganizationType[] }
  | { type: 'conference'; value: string }
  | { type: 'state_association'; value: string }
  | { type: 'ncaa_division'; value: string }
  | { type: 'nationality'; value: string }
  | { type: 'age_group'; value: string }
  | { type: 'age_max'; value: number }
  | { type: 'is_high_school'; value: true }
  | { type: 'is_collegiate'; value: true }
  | { type: 'team_id'; value: string }
  | { type: 'custom_flag'; value: string };

// ═══════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════

export type EventType =
  | 'track_sprint'
  | 'track_middle'
  | 'track_distance'
  | 'track_hurdles'
  | 'track_steeplechase'
  | 'track_relay'
  | 'field_throw'
  | 'field_jump_h'
  | 'field_jump_v'
  | 'combined'
  | 'race_walk'
  | 'cross_country';

export type EventCategory = 'STRAIGHT' | 'RUN' | 'RELAY' | 'FIELD' | 'COMBINED';
export type VenueFilter = 'outdoor' | 'indoor' | 'both';

// ═══════════════════════════════════════════════════════════
// API Types (for data transfer between client and server)
// ═══════════════════════════════════════════════════════════

export interface OrganizationRow {
  id: string;
  name: string;
  abbreviation: string;
  shortName: string | null;
  mascot: string | null;
  organizationType: string;
  genderDesignation: string | null;
  ncaaDivision: string | null;
  naiaMember: boolean | null;
  jucoMember: boolean | null;
  conference: string | null;
  subConference: string | null;
  stateAssociation: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  wordmarkUrl: string | null;
  headCoach: string | null;
  assistantCoach: string | null;
  athleticDirector: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  tfrrsId: string | null;
  athleticNetId: string | null;
  directAthleticsId: string | null;
  milesplitId: string | null;
  notes: string | null;
  isActive: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface RecordSetRow {
  id: string;
  name: string;
  abbreviation: string;
  description: string | null;
  scope: string;
  gender: string | null;
  season: string | null;
  organizationId: string | null;
  eligibilityRules: RecordCondition[];
  isActive: boolean | null;
  isPublic: boolean | null;
  notes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  recordCount?: number;
  organizationName?: string | null;
}

export interface RecordRow {
  id: string;
  recordSetId: string;
  eventCode: string;
  gender: string;
  mark: string;
  markSortable: number;
  athleteName: string | null;
  teamName: string | null;
  organizationId: string | null;
  meetName: string | null;
  recordDate: string | null;
  location: string | null;
  wind: number | null;
  altitudeAdjusted: boolean | null;
  autoTimed: boolean | null;
  notes: string | null;
  source: string | null;
  verified: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface EventDefinitionRow {
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
  isWindAffected: boolean | null;
  lowerIsBetter: boolean | null;
  markFormat: string | null;
  eventCode: string;
  genderNeutralName: string | null;
}

// ═══════════════════════════════════════════════════════════
// US States
// ═══════════════════════════════════════════════════════════

export const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' }, { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' }, { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' }, { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' }, { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' }, { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' }, { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' }, { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' }, { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' }, { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' }, { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' }, { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' },
  { value: 'DC', label: 'District of Columbia' },
] as const;

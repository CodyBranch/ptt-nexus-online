-- How a school is classified, as things you can filter by.
--
-- Hand-written and additive, like the others here: this database has no
-- drizzle history, so a generated migration would try to create every table
-- that is already present.
--
-- Nothing is dropped and nothing is rewritten. organization_type,
-- ncaa_division, conference and state_association all stay exactly as they
-- are — plenty reads them — and the tags are derived from them at the end of
-- this file. The tags add the one thing those columns had no room for: a
-- state's own classes.
--
-- Safe to run twice. Every insert is guarded, so a second run adds the tags
-- a first run could not and changes nothing else.

CREATE TABLE IF NOT EXISTS "org_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- level | governing_body | conference | class | region
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  -- A conference under its governing body, a governing body under a level.
  -- Null for a level. "Class 1" says nothing without MSHSAA over it, and
  -- there is a Division I in more than one governing body.
  "parent_id" uuid REFERENCES "org_tags"("id") ON DELETE CASCADE,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_tags_slug" ON "org_tags" ("slug");
CREATE INDEX IF NOT EXISTS "idx_org_tags_kind" ON "org_tags" ("kind");
CREATE INDEX IF NOT EXISTS "idx_org_tags_parent" ON "org_tags" ("parent_id");

CREATE TABLE IF NOT EXISTS "organization_tags" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "org_tags"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_tags_pair"
  ON "organization_tags" ("organization_id", "tag_id");
CREATE INDEX IF NOT EXISTS "idx_org_tags_by_tag" ON "organization_tags" ("tag_id");

-- ── The levels ──────────────────────────────────────────────────────────────
INSERT INTO "org_tags" ("kind", "name", "slug", "sort_order")
SELECT * FROM (VALUES
  ('level', 'College',       'college',       1),
  ('level', 'High School',   'high-school',   2),
  ('level', 'Middle School', 'middle-school', 3),
  ('level', 'Club',          'club',          4),
  ('level', 'Professional',  'professional',  5)
) AS v(kind, name, slug, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "org_tags" t WHERE t.slug = v.slug);

-- ── Who runs the competition, under the level it belongs to ────────────────
INSERT INTO "org_tags" ("kind", "name", "slug", "parent_id", "sort_order")
SELECT v.kind, v.name, v.slug, p.id, v.sort_order
FROM (VALUES
  ('governing_body', 'NCAA DI',   'ncaa-di',   'college',     1),
  ('governing_body', 'NCAA DII',  'ncaa-dii',  'college',     2),
  ('governing_body', 'NCAA DIII', 'ncaa-diii', 'college',     3),
  ('governing_body', 'NAIA',      'naia',      'college',     4),
  ('governing_body', 'NJCAA',     'njcaa',     'college',     5),
  ('governing_body', 'MSHSAA',    'mshsaa',    'high-school', 1)
) AS v(kind, name, slug, parent_slug, sort_order)
JOIN "org_tags" p ON p.slug = v.parent_slug
WHERE NOT EXISTS (SELECT 1 FROM "org_tags" t WHERE t.slug = v.slug);

-- ── Missouri's classes, under MSHSAA ───────────────────────────────────────
-- The reason for all this. There was no column for a state's own classes, so
-- "Class 1" had nowhere to be recorded and nothing to be filtered by.
INSERT INTO "org_tags" ("kind", "name", "slug", "parent_id", "sort_order")
SELECT 'class', 'Class ' || n, 'mshsaa-class-' || n, p.id, n
FROM generate_series(1, 5) AS n
CROSS JOIN "org_tags" p
WHERE p.slug = 'mshsaa'
  AND NOT EXISTS (SELECT 1 FROM "org_tags" t WHERE t.slug = 'mshsaa-class-' || n);

-- ── Conferences, from the ones the organisations already name ──────────────
-- Taken from the data rather than typed out: 109 of them, and the database is
-- the only place that knows which. Hung under the governing body the schools
-- in them actually belong to, by majority, so the SEC lands under NCAA DI.
INSERT INTO "org_tags" ("kind", "name", "slug", "parent_id", "sort_order")
SELECT DISTINCT ON (slug) 'conference', name, slug, parent_id, 0
FROM (
  SELECT
    o.conference AS name,
    'conf-' || lower(regexp_replace(trim(o.conference), '[^a-zA-Z0-9]+', '-', 'g')) AS slug,
    (SELECT g.id FROM "org_tags" g WHERE g.slug = CASE o.ncaa_division
        WHEN 'D1' THEN 'ncaa-di' WHEN 'D2' THEN 'ncaa-dii' WHEN 'D3' THEN 'ncaa-diii'
        ELSE CASE WHEN o.naia_member THEN 'naia'
                  WHEN o.juco_member THEN 'njcaa' ELSE 'college' END END) AS parent_id,
    COUNT(*) OVER (PARTITION BY o.conference, o.ncaa_division) AS weight
  FROM "organizations" o
  WHERE o.conference IS NOT NULL AND trim(o.conference) <> ''
) AS c
WHERE parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "org_tags" t WHERE t.slug = c.slug)
ORDER BY slug, weight DESC;

-- ── Hang the schools on the tags they already imply ────────────────────────
-- Level, from organization_type.
INSERT INTO "organization_tags" ("organization_id", "tag_id")
SELECT o.id, t.id
FROM "organizations" o
JOIN "org_tags" t ON t.kind = 'level' AND t.slug = replace(o.organization_type, '_', '-')
WHERE NOT EXISTS (
  SELECT 1 FROM "organization_tags" x WHERE x.organization_id = o.id AND x.tag_id = t.id);

-- Governing body, from the NCAA division or the NAIA/JUCO flags.
INSERT INTO "organization_tags" ("organization_id", "tag_id")
SELECT o.id, t.id
FROM "organizations" o
JOIN "org_tags" t ON t.slug = CASE o.ncaa_division
    WHEN 'D1' THEN 'ncaa-di' WHEN 'D2' THEN 'ncaa-dii' WHEN 'D3' THEN 'ncaa-diii'
    ELSE CASE WHEN o.naia_member THEN 'naia' WHEN o.juco_member THEN 'njcaa' ELSE NULL END END
WHERE NOT EXISTS (
  SELECT 1 FROM "organization_tags" x WHERE x.organization_id = o.id AND x.tag_id = t.id);

-- Governing body, from the state association — every high school here is MSHSAA.
INSERT INTO "organization_tags" ("organization_id", "tag_id")
SELECT o.id, t.id
FROM "organizations" o
JOIN "org_tags" t ON t.kind = 'governing_body'
  AND lower(t.name) = lower(trim(o.state_association))
WHERE o.state_association IS NOT NULL AND trim(o.state_association) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "organization_tags" x WHERE x.organization_id = o.id AND x.tag_id = t.id);

-- Conference.
INSERT INTO "organization_tags" ("organization_id", "tag_id")
SELECT o.id, t.id
FROM "organizations" o
JOIN "org_tags" t ON t.kind = 'conference'
  AND t.slug = 'conf-' || lower(regexp_replace(trim(o.conference), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE o.conference IS NOT NULL AND trim(o.conference) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "organization_tags" x WHERE x.organization_id = o.id AND x.tag_id = t.id);

-- Classes are not filled in here. Nothing in the organisations knows which
-- class a school is in — that is the gap this was built for — so they go on
-- as somebody records them.

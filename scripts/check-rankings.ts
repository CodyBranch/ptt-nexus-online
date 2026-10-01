/**
 * The USTFCCCA rankings reader and matcher, checked offline.
 *
 * Parsing runs on a fixture in their documented shape (receiving votes, the
 * 999 "receiving votes last week" sentinel, Eastern release times). The
 * matcher runs against the organizations in the database - read only - with
 * USTFCCCA-style names, to see what links on its own and what waits.
 *
 *   npx tsx scripts/check-rankings.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

let fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ' -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  if (!cond) fail++;
};

(async () => {
  const { parseLatestXc, easternToDate } = await import('../src/lib/rankings/ustfccca');
  const { decide, nameKey } = await import('../src/lib/rankings/match');

  console.log('Eastern time');
  ok('September is UTC-4', easternToDate('2026-09-29T14:00:00')?.toISOString() === '2026-09-29T18:00:00.000Z', easternToDate('2026-09-29T14:00:00')?.toISOString());
  ok('December is UTC-5', easternToDate('2026-12-01T14:00:00')?.toISOString() === '2026-12-01T19:00:00.000Z', easternToDate('2026-12-01T14:00:00')?.toISOString());

  console.log('Parsing /latest/xc');
  const snap = parseLatestXc({
    generated_at: '2026-09-30T20:59:03Z', season: 2026,
    latest_order: {
      national_poll: [{ division: 2030, division_name: 'NCAA DI', gender: 'men', list_type: 'poll', type_id: 6,
        collection_id: 17779, week: 2, release_date: '2026-09-29T14:00:00', teams: [
          { rank: 1, is_rv: false, team_id: 1067, team_name: 'University of New Mexico', team_short: 'New Mexico',
            score: 330, first_place_votes: 11, prev_rank: 2, rank_change: 1, conference: 'Mountain West', region: 'Mountain' },
          { rank: 2, is_rv: false, team_id: 714, team_name: 'Iowa State University', team_short: 'Iowa State',
            score: 317, first_place_votes: 0, prev_rank: 999, prev_is_rv: true, rank_change: null, conference: 'Big 12', region: 'Midwest' },
          { rank: null, is_rv: true, team_id: 9001, team_name: 'Somewhere College', team_short: 'Somewhere',
            score: null, prev_rank: null, conference: null, region: null },
        ] }],
      regional_rankings: [{ division: 2030, division_name: 'NCAA DI', gender: 'men', region_id: 2046,
        region_name: 'Great Lakes (NCAA DI)', collection_id: 17819, week: 2, release_date: '2026-09-28T14:00:00',
        teams: [{ rank: 1, is_rv: false, team_id: 1812, team_name: 'University of Wisconsin, Madison', team_short: 'Wisconsin',
          score: null, first_place_votes: null, prev_rank: 1, rank_change: 0, conference: 'Big Ten', region: 'Great Lakes' }] }],
    },
    by_team: {
      1067: { team_id: 1067, team_name: 'University of New Mexico', team_short: 'New Mexico', abbrev: null,
        conference: 'Mountain West', region: 'Mountain', division_id: 2030, division: 'NCAA DI', athnet_team_id: 21180 },
    },
  });
  const poll = snap.lists.find((l) => l.kind === 'national')!;
  const regional = snap.lists.find((l) => l.kind === 'regional')!;
  ok('two lists, national and regional', snap.lists.length === 2 && !!poll && !!regional);
  ok('a national list has region 0', poll.regionId === 0 && regional.regionId === 2046);
  ok('receiving votes: no rank, flagged', poll.entries[2].rank === null && poll.entries[2].isRv === true);
  ok('999 last week is "receiving votes last week", not a rank', poll.entries[1].prevRank === null && poll.entries[1].prevIsRv === true);
  ok('release time kept as sent and as an instant', poll.releaseDateEt === '2026-09-29T14:00:00' && poll.releasedAt?.toISOString() === '2026-09-29T18:00:00.000Z');
  ok('teams only on a list still become teams', snap.teams.length === 4 && snap.teams.some((t) => t.ustfcccaTeamId === 1812));
  ok('the AthNET id is carried', snap.teams.find((t) => t.ustfcccaTeamId === 1067)?.athnetTeamId === 21180);

  console.log('Names');
  const same = (a: string, b: string) => nameKey(a).words === nameKey(b).words;
  ok('"Iowa St." is "Iowa State"', same('Iowa St.', 'Iowa State'));
  ok('"St. Louis" is "Saint Louis"', same('St. Louis University', 'Saint Louis University'));
  ok('"Mt. St. Mary" is "Mount Saint Mary"', same('Mt. St. Mary College', 'Mount Saint Mary College'));
  ok('"(Minn.)" and "(MN)" are one state', nameKey("St. John's University (Minn.)").state === 'MN' && nameKey("St. John's (MN)").state === 'MN');
  ok('"Univ." is University', same('Northwestern Oklahoma State Univ.', 'Northwestern Oklahoma State University'));
  ok('a comma and a hyphen are the same', same('University of Wisconsin, Madison', 'University of Wisconsin-Madison'));

  console.log('Matching against the organizations here (read only)');
  const { db } = await import('../src/db/client');
  const { organizations } = await import('../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const orgs = await db.select({
    id: organizations.id, name: organizations.name, shortName: organizations.shortName,
    abbreviation: organizations.abbreviation, ncaaDivision: organizations.ncaaDivision,
    naiaMember: organizations.naiaMember, jucoMember: organizations.jucoMember,
    conference: organizations.conference, state: organizations.state, athleticNetId: organizations.athleticNetId,
  }).from(organizations).where(eq(organizations.organizationType, 'college'));
  console.log(`  ${orgs.length} colleges`);

  // USTFCCCA-style names: full, short, division, conference.
  const teams: Array<[string, string, number, string]> = [
    ['University of New Mexico', 'New Mexico', 2030, 'Mountain West'],
    ['Iowa State University', 'Iowa State', 2030, 'Big 12'],
    ['Oklahoma State University', 'Oklahoma State', 2030, 'Big 12'],
    ['University of Wisconsin, Madison', 'Wisconsin', 2030, 'Big Ten'],
    ['Northern Arizona University', 'Northern Arizona', 2030, 'Big Sky'],
    ['Brigham Young University', 'BYU', 2030, 'Big 12'],
    ['University of Notre Dame', 'Notre Dame', 2030, 'ACC'],
    ['University of Arkansas', 'Arkansas', 2030, 'SEC'],
    ['Saint Louis University', 'Saint Louis', 2030, 'Atlantic 10'],
    ["St. John's University (NY)", "St. John's (NY)", 2030, 'Big East'],
    ["Saint John's University (MN)", "St. John's (MN)", 2032, 'Minnesota Intercollegiate Athletic'],
    ['Grand Valley State University', 'Grand Valley State', 2031, 'GLIAC'],
    ['Adams State University', 'Adams State', 2031, 'RMAC'],
    ['Western Colorado University', 'Western Colorado', 2031, 'RMAC'],
    ['University of Wisconsin, La Crosse', 'Wisconsin-La Crosse', 2032, 'WIAC'],
    ['Williams College', 'Williams', 2032, 'NESCAC'],
    ['North Central College', 'North Central (Ill.)', 2032, 'CCIW'],
    ['Washington University in St. Louis', 'Washington U.', 2032, 'UAA'],
    ['Oklahoma Christian University', 'Oklahoma Christian', 2031, 'Lone Star'],
    ['Lee University', 'Lee', 2031, 'Gulf South'],
  ];
  const tally = { auto: 0, review: 0, unmatched: 0 };
  for (const [full, short, div, conf] of teams) {
    const d = decide({ ustfcccaTeamId: 0, teamName: full, teamShort: short, divisionId: div, conference: conf, athnetTeamId: null }, orgs);
    tally[d.status]++;
    const pick = d.status === 'auto' ? d.org.name : d.candidates[0]?.org.name ?? '-';
    console.log(`  ${d.status.padEnd(9)} ${full.padEnd(38)} ${pick.padEnd(42)} ${d.note}`);
  }
  console.log(`  ${tally.auto} linked on their own, ${tally.review} to review, ${tally.unmatched} not found`);

  console.log(fail ? `\n${fail} FAILED` : '\nOK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

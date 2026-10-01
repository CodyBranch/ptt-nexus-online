/**
 * Which of our organizations a USTFCCCA team is.
 *
 * Their names and ours are written differently for the same school:
 * "University of Wisconsin, Madison" and "University of Wisconsin-Madison",
 * "Iowa State" and "Iowa St.", "St. John's (MN)" and "Saint John's University
 * (Minn.)". Names are reduced to a comparable form first, then each candidate
 * is scored, with the division as a gate (an NCAA DI team is never a DIII
 * school) and the conference as a tie-breaker.
 *
 * An AthNET id on both sides is certain. Otherwise only a clear winner is
 * linked on its own; a close call goes to a person, with the candidates.
 * Matched once: the USTFCCCA team id does not change between seasons.
 */

export interface MatchTeam {
  ustfcccaTeamId: number;
  teamName: string;
  teamShort: string | null;
  divisionId: number | null;
  conference: string | null;
  athnetTeamId: number | null;
}

export interface MatchOrg {
  id: string;
  name: string;
  shortName: string | null;
  abbreviation: string | null;
  ncaaDivision: string | null;
  naiaMember: boolean | null;
  jucoMember: boolean | null;
  conference: string | null;
  state: string | null;
  athleticNetId: string | null;
}

export interface Candidate { org: MatchOrg; score: number; why: string }

export type MatchDecision =
  | { status: 'auto'; org: MatchOrg; note: string; candidates: Candidate[] }
  | { status: 'review'; note: string; candidates: Candidate[] }
  | { status: 'unmatched'; note: string; candidates: Candidate[] };

// ── Names to a comparable form ──────────────────────────────────────────────

/** State spellings in school names, to postal codes: "(Minn.)", "(MN)", "Minnesota". */
const STATES: Record<string, string> = {
  al: 'AL', ala: 'AL', alabama: 'AL', ak: 'AK', alaska: 'AK', az: 'AZ', ariz: 'AZ', arizona: 'AZ',
  ar: 'AR', ark: 'AR', arkansas: 'AR', ca: 'CA', cal: 'CA', calif: 'CA', california: 'CA',
  co: 'CO', colo: 'CO', colorado: 'CO', ct: 'CT', conn: 'CT', connecticut: 'CT', de: 'DE', del: 'DE',
  delaware: 'DE', dc: 'DC', fl: 'FL', fla: 'FL', florida: 'FL', ga: 'GA', georgia: 'GA', hi: 'HI',
  hawaii: 'HI', id: 'ID', idaho: 'ID', il: 'IL', ill: 'IL', illinois: 'IL', in: 'IN', ind: 'IN',
  indiana: 'IN', ia: 'IA', iowa: 'IA', ks: 'KS', kan: 'KS', kans: 'KS', kansas: 'KS', ky: 'KY',
  kentucky: 'KY', la: 'LA', louisiana: 'LA', me: 'ME', maine: 'ME', md: 'MD', maryland: 'MD',
  ma: 'MA', mass: 'MA', massachusetts: 'MA', mi: 'MI', mich: 'MI', michigan: 'MI', mn: 'MN',
  minn: 'MN', minnesota: 'MN', ms: 'MS', miss: 'MS', mississippi: 'MS', mo: 'MO', missouri: 'MO',
  mt: 'MT', mont: 'MT', montana: 'MT', ne: 'NE', neb: 'NE', nebraska: 'NE', nv: 'NV', nev: 'NV',
  nevada: 'NV', nh: 'NH', nj: 'NJ', nm: 'NM', ny: 'NY', nc: 'NC', nd: 'ND', oh: 'OH', ohio: 'OH',
  ok: 'OK', okla: 'OK', oklahoma: 'OK', or: 'OR', ore: 'OR', oregon: 'OR', pa: 'PA', penn: 'PA',
  pennsylvania: 'PA', ri: 'RI', sc: 'SC', sd: 'SD', tn: 'TN', tenn: 'TN', tennessee: 'TN',
  tx: 'TX', tex: 'TX', texas: 'TX', ut: 'UT', utah: 'UT', vt: 'VT', vermont: 'VT', va: 'VA',
  virginia: 'VA', wa: 'WA', wash: 'WA', washington: 'WA', wv: 'WV', wi: 'WI', wis: 'WI',
  wisc: 'WI', wisconsin: 'WI', wy: 'WY', wyo: 'WY', wyoming: 'WY',
};
/** Two-word states, written with or without dots: "N.Y.", "New York". */
const STATE_PHRASES: Array<[RegExp, string]> = [
  [/\bn\s*y\b|\bnew york\b/, 'NY'], [/\bn\s*c\b|\bnorth carolina\b/, 'NC'], [/\bs\s*c\b|\bsouth carolina\b/, 'SC'],
  [/\bn\s*d\b|\bnorth dakota\b/, 'ND'], [/\bs\s*d\b|\bsouth dakota\b/, 'SD'], [/\bn\s*h\b|\bnew hampshire\b/, 'NH'],
  [/\bn\s*j\b|\bnew jersey\b/, 'NJ'], [/\bn\s*m\b|\bnew mexico\b/, 'NM'], [/\bw\s*va\b|\bwest virginia\b/, 'WV'],
  [/\br\s*i\b|\brhode island\b/, 'RI'], [/\bd\s*c\b/, 'DC'], [/\bl\s*i\b|\blong island\b/, 'LI'],
];

const WORDS: Record<string, string> = {
  univ: 'university', u: 'university', coll: 'college', inst: 'institute', tech: 'technology',
  mt: 'mount', ft: 'fort', intl: 'international', poly: 'polytechnic', cc: 'community college',
};
const DROP = new Set(['the', 'of', 'at', 'and', 'in']);

export interface NameKey {
  /** The name's words in order, normalized. */
  words: string;
  /** The same as a set, for overlap. */
  set: Set<string>;
  /** A state named in brackets, as a postal code. */
  state: string | null;
}

function bracketState(inner: string): string | null {
  const s = inner.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, code] of STATE_PHRASES) if (re.test(s)) return code;
  const one = s.replace(/\s/g, '');
  return STATES[one] ?? null;
}

export function nameKey(name: string): NameKey {
  let state: string | null = null;
  // "(Minn.)" and "(MN)" are the same thing; anything else in brackets stays a word.
  let text = name.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    const code = bracketState(inner);
    if (code) { state = code; return ' '; }
    return ` ${inner} `;
  });
  text = text.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')        // St. John's -> st johns
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const raw = text.split(' ').filter(Boolean);
  const words: string[] = [];
  raw.forEach((w, i) => {
    // "St." is State at the end of a place ("Iowa St.", "Iowa St. University")
    // and Saint everywhere else: St. Louis, Mt. St. Mary, University of St. Thomas.
    if (w === 'st') {
      const after = raw[i + 1];
      const state = i > 0 && (!after || ['university', 'univ', 'u', 'college', 'coll'].includes(after));
      words.push(state ? 'state' : 'saint');
      return;
    }
    if (w === 'ste') { words.push('sainte'); return; }
    const mapped = WORDS[w] ?? w;
    for (const m of mapped.split(' ')) if (!DROP.has(m)) words.push(m);
  });
  return { words: words.join(' '), set: new Set(words), state };
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(a.size, b.size);
}

/** Whether an organization can be in this USTFCCCA division at all. */
export function divisionFits(divisionId: number | null, org: MatchOrg): 'yes' | 'unknown' | 'no' {
  const want: Record<number, string> = { 2030: 'D1', 2031: 'D2', 2032: 'D3' };
  if (divisionId == null) return 'unknown';
  if (want[divisionId]) {
    if (org.ncaaDivision) return org.ncaaDivision === want[divisionId] ? 'yes' : 'no';
    return org.naiaMember || org.jucoMember ? 'no' : 'unknown';
  }
  if (divisionId === 2028) return org.naiaMember ? 'yes' : org.ncaaDivision || org.jucoMember ? 'no' : 'unknown';
  if ([19781, 19782, 2034, 2033].includes(divisionId)) return org.jucoMember ? 'yes' : org.ncaaDivision || org.naiaMember ? 'no' : 'unknown';
  return 'unknown';
}

/** How sure, 0 to 100, that this organization is this team, and why. */
export function scoreCandidate(team: MatchTeam, org: MatchOrg): Candidate | null {
  if (team.athnetTeamId != null && org.athleticNetId && String(team.athnetTeamId) === org.athleticNetId.trim()) {
    return { org, score: 100, why: 'same Athletic.net id' };
  }
  const fits = divisionFits(team.divisionId, org);
  if (fits === 'no') return null;

  const full = nameKey(team.teamName);
  const short = team.teamShort ? nameKey(team.teamShort) : null;
  const oName = nameKey(org.name);
  const oShort = org.shortName ? nameKey(org.shortName) : null;
  const oAbbr = org.abbreviation ? nameKey(org.abbreviation) : null;

  // A state in brackets on both sides that disagrees: St. John's (MN) is not St. John's (NY).
  const states = [full.state, short?.state].filter(Boolean);
  const oStates = [oName.state, oShort?.state, oAbbr?.state, org.state].filter(Boolean);
  if (states.length && oStates.length && !states.some((s) => oStates.includes(s))) return null;

  let score = 0;
  let why = '';
  const same = (a: NameKey | null, b: NameKey | null) => !!a && !!b && a.words === b.words && a.words.length > 0;
  // The main campus named after a comma: "University of Arkansas, Fayetteville"
  // is our "University of Arkansas". Only with the short names agreeing too,
  // because "University of California, Irvine" is not our University of
  // California - its short name is UC Irvine, not California.
  const campus = team.teamName.includes(',') ? nameKey(team.teamName.slice(0, team.teamName.lastIndexOf(','))) : null;
  const shortAgrees = same(short, oShort) || same(short, oAbbr) || same(short, oName);
  if (same(full, oName)) { score = 90; why = 'full name'; }
  else if (same(campus, oName) && shortAgrees) { score = 85; why = 'name without the campus, and short name'; }
  else if (same(full, oShort) || same(short, oName)) { score = 75; why = 'full name and short name'; }
  else if (same(short, oShort) || same(short, oAbbr)) { score = 65; why = 'short name'; }
  else {
    const o = Math.max(overlap(full.set, oName.set), short && oShort ? overlap(short.set, oShort.set) : 0);
    if (o >= 0.75) { score = Math.round(40 + o * 20); why = 'similar name'; }
  }
  if (!score) return null;

  if (fits === 'yes') score += 5;
  else { score -= 10; why += ', division not on file'; }
  // Agreeing conferences help; disagreeing ones do not count against, because
  // the same conference is written "SEC" on one side and "Southeastern" on
  // the other far more often than a school is in a different one.
  if (team.conference && org.conference) {
    const c = overlap(nameKey(team.conference).set, nameKey(org.conference).set);
    if (c >= 0.5) { score += 5; why += ', same conference'; }
  }
  return { org, score: Math.min(100, score), why };
}

/** Linked on its own only at this score, and this far ahead of the next. */
const AUTO_AT = 85;
const AUTO_LEAD = 15;
const REVIEW_AT = 50;

/** The decision for one team, given every organization it could be. */
export function decide(team: MatchTeam, orgs: MatchOrg[], taken: Set<string> = new Set()): MatchDecision {
  const candidates = orgs
    .map((o) => scoreCandidate(team, o))
    .filter((c): c is Candidate => c != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const [best, next] = candidates;
  if (!best || best.score < REVIEW_AT) {
    return { status: 'unmatched', note: best ? `closest: ${best.org.name} (${best.score})` : 'no organization looks like it', candidates };
  }
  if (taken.has(best.org.id)) {
    return { status: 'review', note: `${best.org.name} is already linked to another USTFCCCA team`, candidates };
  }
  if (best.score >= AUTO_AT && (!next || best.score - next.score >= AUTO_LEAD)) {
    return { status: 'auto', org: best.org, note: `${best.why} (${best.score})`, candidates };
  }
  return {
    status: 'review',
    note: next ? `${best.org.name} (${best.score}) or ${next.org.name} (${next.score})` : `${best.org.name} (${best.score}): ${best.why}`,
    candidates,
  };
}

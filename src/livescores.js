// Scores en direct et résultats finaux via API-Football (api-sports.io).

const STOP = new Set(['fc', 'ac', 'as', 'sc', 'cf', 'afc', 'sv', 'fk', 'ss', 'us', 'rc', 'ud', 'cd', 'sd', 'de', 'la', 'le', 'the', 'club']);
const ALIAS = {
  'paris sg': 'paris saint germain',
  psg: 'paris saint germain',
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'inter milan': 'inter',
  'atletico madrid': 'atletico madrid',
  'bayern munich': 'bayern munchen',
  'olympique de marseille': 'marseille',
  'olympique lyonnais': 'lyon',
};

export function tokens(name) {
  let s = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = ALIAS[s] ?? s;
  return s.split(' ').filter((w) => w && !STOP.has(w));
}

export function teamSim(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  let hit = 0;
  for (const x of A)
    if (B.some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))) hit++;
  return hit / Math.min(A.length, B.length);
}

export function matchFixture(m, fixtures) {
  let best = null, bestScore = 0;
  for (const f of fixtures) {
    const ko = Date.parse(f.fixture.date);
    if (Math.abs(ko - m.kickoff) > 20 * 60e3) continue;
    const s1 = teamSim(m.home, f.teams.home.name);
    const s2 = teamSim(m.away, f.teams.away.name);
    if (s1 < 0.5 || s2 < 0.5) continue;
    if (s1 + s2 > bestScore) { bestScore = s1 + s2; best = f; }
  }
  return best;
}

const VOID = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);
const DONE = new Set(['FT', 'AET', 'PEN']);
const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP']);

export function fixtureToState(f) {
  const s = f.fixture.status.short;
  const base = { fixtureId: f.fixture.id, home: f.goals.home ?? 0, away: f.goals.away ?? 0, minute: f.fixture.status.elapsed ?? null, code: s };
  if (VOID.has(s)) return { ...base, status: 'void' };
  if (DONE.has(s)) {
    const ftH = f.score?.fulltime?.home ?? f.goals.home;
    const ftA = f.score?.fulltime?.away ?? f.goals.away;
    return { ...base, status: 'finished', ftHome: ftH, ftAway: ftA };
  }
  if (LIVE.has(s)) return { ...base, status: 'live' };
  return { ...base, status: 'pending' };
}

export async function fetchFixtures(date, key) {
  const r = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}`, {
    headers: { 'x-apisports-key': key },
  });
  if (!r.ok) throw new Error(`API-Football HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length && !Array.isArray(j.errors))
    throw new Error('API-Football: ' + JSON.stringify(j.errors));
  return j.response || [];
}

// Met à jour `tracked` (id -> {home, away, kickoff, live?}) avec les scores. Retourne les ids finis/annulés.
export async function pollScores(tracked, key, { now = Date.now(), log = console.log } = {}) {
  const need = Object.values(tracked).filter((m) => m.kickoff < now + 5 * 60e3 && !m.result);
  if (!need.length) return { calls: 0 };
  const dates = [...new Set(need.map((m) => new Date(m.kickoff).toISOString().slice(0, 10)))];
  let calls = 0;
  for (const d of dates) {
    const fixtures = await fetchFixtures(d, key);
    calls++;
    for (const m of need.filter((x) => new Date(x.kickoff).toISOString().slice(0, 10) === d)) {
      const f = matchFixture(m, fixtures);
      if (!f) { m.unmatched = (m.unmatched || 0) + 1; continue; }
      const st = fixtureToState(f);
      m.live = st;
      if (st.status === 'finished' || st.status === 'void') m.result = st;
    }
  }
  return { calls };
}

// ---------- mode démo : scores simulés ----------
export function demoState(m, now = Date.now()) {
  const e = Math.floor((now - m.kickoff) / (process.env.DEMO_FAST === "1" ? 1000 : 60000));
  if (e < 0) return { status: 'pending', home: 0, away: 0, minute: null };
  const minute = e <= 45 ? e : e <= 60 ? 45 : e <= 105 ? e - 15 : 90;
  const gh = m.demoGoals.home.filter((x) => x <= minute).length;
  const ga = m.demoGoals.away.filter((x) => x <= minute).length;
  if (e > 105) return { status: 'finished', home: gh, away: ga, ftHome: gh, ftAway: ga, minute: 90 };
  return { status: 'live', home: gh, away: ga, minute, code: e > 45 && e <= 60 ? 'HT' : e <= 45 ? '1H' : '2H' };
}

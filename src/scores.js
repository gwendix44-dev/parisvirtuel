// Scores en direct et résultats via l'API publique d'ESPN (sans clé ni compte).
// API non officielle : peut changer sans préavis.

const STOP = new Set(['fc', 'ac', 'as', 'sc', 'cf', 'afc', 'sv', 'fk', 'ss', 'us', 'rc', 'ud', 'cd', 'sd', 'de', 'la', 'le', 'the', 'club', 'cp', 'ca']);
const ALIAS = {
  'paris sg': 'paris saint germain', psg: 'paris saint germain',
  'man city': 'manchester city', 'man utd': 'manchester united', 'man united': 'manchester united',
  'inter milan': 'inter', 'internazionale': 'inter', 'bayern munich': 'bayern munchen',
  'olympique de marseille': 'marseille', 'olympique lyonnais': 'lyon', 'stade rennais': 'rennes',
  'atletico de madrid': 'atletico madrid', 'sporting cp': 'sporting', 'sporting lisbonne': 'sporting',
};

export function tokens(name) {
  let s = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
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

const side = (e, ha) => e.competitions?.[0]?.competitors?.find((c) => c.homeAway === ha);

export function matchEvent(m, events) {
  let best = null, bestScore = 0;
  for (const e of events) {
    if (Math.abs(Date.parse(e.date) - m.kickoff) > 20 * 60e3) continue;
    const h = side(e, 'home'), a = side(e, 'away');
    if (!h || !a) continue;
    const s1 = teamSim(m.home, h.team.displayName), s2 = teamSim(m.away, a.team.displayName);
    if (s1 < 0.5 || s2 < 0.5) continue;
    if (s1 + s2 > bestScore) { bestScore = s1 + s2; best = e; }
  }
  return best;
}

const VOID = new Set(['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_CANCELLED', 'STATUS_ABANDONED', 'STATUS_FORFEIT']);

// Score à 90 minutes depuis les buts détaillés (prolongation et tirs au but exclus).
function regulationScore(e, h, a) {
  const det = e.competitions?.[0]?.details;
  if (!Array.isArray(det)) return null;
  let gh = 0, ga = 0;
  for (const d of det) {
    if (!d.scoringPlay || d.shootout) continue;
    const base = parseInt(String(d.clock?.displayValue || '').replace(/[^\d+]/g, '').split('+')[0], 10);
    if (!Number.isFinite(base) || base > 90) continue;
    const tid = d.team?.id;
    if (tid === h.team.id) gh++; else if (tid === a.team.id) ga++; else return null;
  }
  return [gh, ga];
}

export function eventToState(e) {
  const h = side(e, 'home'), a = side(e, 'away');
  const type = e.status.type, name = type.name;
  const home = Number(h.score) || 0, away = Number(a.score) || 0;
  const base = { home, away, minute: parseInt(e.status.displayClock, 10) || null, code: name };
  if (VOID.has(name)) return { ...base, status: 'void' };
  if (type.state === 'post' || type.completed) {
    if (name === 'STATUS_FULL_TIME') return { ...base, status: 'finished', ftHome: home, ftAway: away };
    const reg = regulationScore(e, h, a);
    return reg
      ? { ...base, status: 'finished', ftHome: reg[0], ftAway: reg[1] }
      : { ...base, status: 'finished', ftHome: home, ftAway: away, approx: true };
  }
  if (type.state === 'in') return { ...base, status: 'live', code: name === 'STATUS_HALFTIME' ? 'HT' : name };
  return { ...base, status: 'pending', minute: null };
}

export async function fetchDay(yyyymmdd) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${yyyymmdd}&limit=500`, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
  return (await r.json()).events || [];
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

// Met à jour tracked[id].live / .result. Retourne le nombre d'appels.
export async function pollScores(tracked, { now = Date.now(), log = console.log } = {}) {
  const need = Object.values(tracked).filter((m) => !m.result && m.kickoff < now + 5 * 60e3 && m.kickoff > now - 4 * 86400e3);
  if (!need.length) return 0;
  const days = new Set();
  for (const m of need) { const d = new Date(m.kickoff); days.add(ymd(d)); days.add(ymd(new Date(m.kickoff - 86400e3))); }
  const events = [];
  for (const d of days) events.push(...(await fetchDay(d)));
  for (const m of need) {
    const e = matchEvent(m, events);
    if (!e) { m.unmatched = (m.unmatched || 0) + 1; continue; }
    const st = eventToState(e);
    m.live = st;
    if (st.status === 'finished' || st.status === 'void') m.result = st;
  }
  return days.size;
}

// ---------- mode démo : scores simulés ----------
export function demoState(m, now = Date.now()) {
  const unit = process.env.DEMO_FAST === '1' ? 1000 : 60000;
  const e = Math.floor((now - m.kickoff) / unit);
  if (e < 0) return { status: 'pending', home: 0, away: 0, minute: null };
  const minute = e <= 45 ? e : e <= 60 ? 45 : e <= 105 ? e - 15 : 90;
  const gh = m.demoGoals.home.filter((x) => x <= minute).length;
  const ga = m.demoGoals.away.filter((x) => x <= minute).length;
  if (e > 105) return { status: 'finished', home: gh, away: ga, ftHome: gh, ftAway: ga, minute: 90 };
  return { status: 'live', home: gh, away: ga, minute, code: e > 45 && e <= 60 ? 'HT' : e <= 45 ? '1H' : '2H' };
}

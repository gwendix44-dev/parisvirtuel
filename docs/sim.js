// Moteur de simulation déterministe : calendrier, matchs, cotes, classements.
// Pur (aucun accès réseau ni DOM) : le téléphone et les tests calculent exactement la même chose.

export const SLOT_MS = 30 * 60e3;            // un créneau = un match de 30 minutes
export const HALF_MS = 14 * 60e3;            // mi-temps réelle : 14 min
export const BREAK_MS = 2 * 60e3;            // pause : 2 min
export const BETTING_AHEAD = 6;              // paris ouverts sur les 6 prochains créneaux (3 h)
const SHARP = 1.3, FORM_W = 0.16;           // écart de niveau accentué, poids de la forme récente
export const VERSION = 3;
export const MAX_PARALLEL = 6;               // 6 matchs maximum au même coup d'envoi (une journée est jouée en vagues)                    // à incrémenter si le modèle change (les anciens paris sont alors remboursés)

const BASE_HOME = 1.5, BASE_AWAY = 1.2;      // buts moyens à domicile / à l'extérieur
const HT_SHARE = 0.45;                       // part des buts marqués en 1re mi-temps
const YELLOW_PER_TEAM = 1.8;
const MARGIN = 0.06, MARGIN_EXOTIC = 0.14;

// ---------- aléatoire reproductible ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = hash(String(seed));
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poissonSample(lam, r) {
  let k = 0, p = Math.exp(-lam), s = p;
  const u = r();
  while (u > s && k < 40) { k++; p *= lam / k; s += p; }
  return k;
}
const pois = (lam, k) => { let p = Math.exp(-lam); for (let i = 1; i <= k; i++) p *= lam / i; return p; };
function shuffle(arr, r) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function pickWeighted(items, weights, r) {
  const tot = weights.reduce((a, b) => a + b, 0);
  let u = r() * tot;
  for (let i = 0; i < items.length; i++) { u -= weights[i]; if (u <= 0) return items[i]; }
  return items[items.length - 1];
}

// ---------- monde (équipes réelles, forces dérivées de leurs vraies stats) ----------
export function createWorld(raw) {
  const groups = raw.leagues.map((L) => {
    const pairs = Math.floor(L.teamIds.length / 2), waves = Math.ceil(pairs / MAX_PARALLEL);
    return { ...L, rounds: 2 * (L.teamIds.length - 1), pairs, waves, size: Math.ceil(pairs / waves) };
  });
  const teams = raw.teams;
  // forces d'attaque et de défense, relatives à la moyenne de la compétition d'origine
  const domestic = {};
  for (const t of Object.values(teams)) (domestic[t.league] ||= []).push(t);
  for (const [lid, list] of Object.entries(domestic)) {
    const gp = list.reduce((a, t) => a + t.gp, 0) || 1;
    const avg = list.reduce((a, t) => a + t.gf, 0) / gp || 1.3;
    const lg = raw.leagues.find((l) => l.id === lid);
    for (const t of list) {
      const w = t.gp / (t.gp + 6);
      t.att = Math.pow(w * (t.gf / Math.max(t.gp, 1) / avg) + (1 - w), SHARP);
      t.def = Math.pow(w * (t.ga / Math.max(t.gp, 1) / avg) + (1 - w), SHARP);
      t.str = t.strengthOverride ?? lg?.strength ?? 1;
    }
  }
  for (const t of Object.values(teams)) {
    const ps = t.players;
    const maxApps = Math.max(1, ...ps.map((p) => p.apps));
    const prior = { F: 0.3, M: 0.1, D: 0.03, G: 0.0005 };
    for (const p of ps) {
      const rate = (p.goals + 5 * prior[p.pos]) / (p.apps + 5);
      p.w = rate * (0.35 + 0.65 * (p.apps / maxApps));
      p.team = t.id;
    }
    const tot = ps.reduce((a, p) => a + p.w, 0) || 1;
    for (const p of ps) p.share = p.w / tot;
  }
  return { version: VERSION, groups, teams, cache: new Map() };
}

// Forme récente : 5 derniers matchs de la saison virtuelle (V/N/D), alimente la force de l'équipe.
export function teamForm(world, teamId, g, season, round) {
  const key = `form|${teamId}|${g}|${season}|${round}`;
  if (world.cache.has(key)) return world.cache.get(key);
  const seq = [];
  let pts = 0, gf = 0, ga = 0;
  for (let rd = round - 1; rd >= 0 && seq.length < 5; rd--) {
    const m = roundMatches(world, g, season, rd).find((x) => x.home === teamId || x.away === teamId);
    if (!m) continue;
    const s = simulate(world, m), home = m.home === teamId;
    const f = home ? s.ftHome : s.ftAway, a = home ? s.ftAway : s.ftHome;
    gf += f; ga += a;
    if (f > a) { pts += 3; seq.push('V'); } else if (f === a) { pts++; seq.push('N'); } else seq.push('D');
  }
  const out = { seq, pts, gf, ga, n: seq.length, factor: seq.length ? 1 + FORM_W * (pts / (3 * seq.length) - 0.5) : 1 };
  world.cache.set(key, out);
  return out;
}

// Derniers résultats d'une équipe (peut remonter aux saisons précédentes), du plus récent au plus ancien.
export function recentResults(world, teamId, g, season, round, n = 10) {
  const key = `rec|${teamId}|${g}|${season}|${round}|${n}`;
  if (world.cache.has(key)) return world.cache.get(key);
  const grp = world.groups[g], out = [];
  for (let idx = season * grp.rounds + round - 1, scanned = 0; idx >= 0 && out.length < n && scanned < grp.rounds * 2; idx--, scanned++) {
    const m = roundMatches(world, g, Math.floor(idx / grp.rounds), idx % grp.rounds).find((x) => x.home === teamId || x.away === teamId);
    if (!m) continue;
    const sm = simulate(world, m), home = m.home === teamId, f = home ? sm.ftHome : sm.ftAway, a = home ? sm.ftAway : sm.ftHome;
    out.push({ id: m.id, home, opp: home ? m.away : m.home, f, a, res: f > a ? 'V' : f === a ? 'N' : 'D' });
  }
  world.cache.set(key, out);
  return out;
}

// Derniers face-à-face entre les deux équipes d'un match (simulations des saisons passées incluses).
export function headToHead(world, m, n = 5) {
  const key = `h2h|${m.id}|${n}`;
  if (world.cache.has(key)) return world.cache.get(key);
  const grp = world.groups[m.g], out = [];
  for (let idx = m.season * grp.rounds + m.round - 1, scanned = 0; idx >= 0 && out.length < n && scanned < grp.rounds * 3; idx--, scanned++) {
    const x = roundMatches(world, m.g, Math.floor(idx / grp.rounds), idx % grp.rounds).find((y) => (y.home === m.home && y.away === m.away) || (y.home === m.away && y.away === m.home));
    if (!x) continue;
    const sm = simulate(world, x);
    out.push({ id: x.id, home: x.home, away: x.away, ftHome: sm.ftHome, ftAway: sm.ftAway });
  }
  world.cache.set(key, out);
  return out;
}

export function lambdas(world, homeId, awayId, m) {
  const h = world.teams[homeId], a = world.teams[awayId];
  const clamp = (x) => Math.min(4.5, Math.max(0.25, x));
  const fh = m ? teamForm(world, homeId, m.g, m.season, m.round).factor : 1;
  const fa = m ? teamForm(world, awayId, m.g, m.season, m.round).factor : 1;
  return {
    lh: clamp(BASE_HOME * h.att * a.def * (h.str / a.str) * fh),
    la: clamp(BASE_AWAY * a.att * h.def * (a.str / h.str) * fa),
  };
}

// ---------- calendrier ----------
export const slotOf = (t) => Math.floor(t / SLOT_MS);
export const slotStart = (k) => k * SLOT_MS;

export function slotInfo(world, k) {
  const G = world.groups.length, g = k % G;
  const grp = world.groups[g];
  const turn = Math.floor(k / G);
  const roundIdx = Math.floor(turn / grp.waves), wave = turn % grp.waves;
  const season = Math.floor(roundIdx / grp.rounds);
  return { k, g, group: grp, season, round: roundIdx % grp.rounds, wave, kickoff: slotStart(k) };
}
const kOf = (world, g, season, round, wave) => ((season * world.groups[g].rounds + round) * world.groups[g].waves + wave) * world.groups.length + g;
// tous les matchs d'une journée (toutes vagues confondues)
export function roundMatches(world, g, season, round) {
  const out = [];
  for (let w = 0; w < world.groups[g].waves; w++) out.push(...matchesOfSlot(world, kOf(world, g, season, round, w)));
  return out;
}

function pairsOf(world, info) {
  const key = `pairs|${info.g}|${info.season}|${info.round}`;
  if (world.cache.has(key)) return world.cache.get(key);
  const ids = shuffle(info.group.teamIds, rng(`order|${info.g}|${info.season}`));
  const n = ids.length, half = n - 1;
  const leg = Math.floor(info.round / half), rr = info.round % half;
  const rest = ids.slice(1);
  const lst = [ids[0], ...rest.map((_, i) => rest[(i - rr + half * 4) % half])];
  const out = [];
  for (let i = 0; i < n / 2; i++) {
    const x = lst[i], y = lst[n - 1 - i];
    let home = (i + rr) % 2 === 0 ? x : y;
    if (leg === 1) home = home === x ? y : x;
    out.push({ home, away: home === x ? y : x });
  }
  world.cache.set(key, out);
  return out;
}

export function matchesOfSlot(world, k) {
  const info = slotInfo(world, k), grp = info.group;
  return pairsOf(world, info).map((p, i) => ({ p, i })).slice(info.wave * grp.size, (info.wave + 1) * grp.size).map(({ p, i }) => ({
    id: `${info.g}.${info.season}.${info.round}.${i}`,
    k, g: info.g, season: info.season, round: info.round, wave: info.wave, i,
    league: grp.name, country: grp.country, leagueId: grp.id,
    home: p.home, away: p.away, kickoff: info.kickoff,
  }));
}

export function matchById(world, id) {
  const [g, season, round, i] = id.split('.').map(Number);
  const grp = world.groups[g];
  if (!grp || i >= grp.pairs) return null;
  const wave = Math.floor(i / grp.size);
  return matchesOfSlot(world, kOf(world, g, season, round, wave)).find((m) => m.i === i) || null;
}

// ---------- simulation d'un match ----------
export function simulate(world, m) {
  const key = 'sim|' + m.id;
  if (world.cache.has(key)) return world.cache.get(key);
  const r = rng(`v${world.version}|${m.id}`);
  const { lh, la } = lambdas(world, m.home, m.away, m);
  const nH = poissonSample(lh, r), nA = poissonSample(la, r);
  const L1 = 45 + 1 + Math.floor(r() * 4), L2 = 45 + 2 + Math.floor(r() * 5);
  const events = [];
  const toAt = (half, gm) => (half === 1 ? (gm / L1) * HALF_MS : HALF_MS + BREAK_MS + (gm / L2) * HALF_MS);
  const label = (half, gm) => {
    const base = half === 1 ? 0 : 45, g = gm + base;
    return g <= (half === 1 ? 45 : 90) ? { min: Math.max(1, Math.ceil(g)), extra: 0 } : { min: half === 1 ? 45 : 90, extra: Math.ceil(g - (half === 1 ? 45 : 90)) };
  };
  for (const [side, n] of [['home', nH], ['away', nA]]) {
    const team = world.teams[m[side]];
    for (let j = 0; j < n; j++) {
      const half = r() < HT_SHARE ? 1 : 2;
      const gm = 0.3 + r() * ((half === 1 ? L1 : L2) - 0.6);
      const scorer = pickWeighted(team.players, team.players.map((p) => p.w), r);
      const others = team.players.filter((p) => p !== scorer && p.pos !== 'G');
      const assist = r() < 0.7 ? pickWeighted(others, others.map((p) => 0.05 + p.assists + p.apps * 0.02), r) : null;
      events.push({ type: 'goal', side, half, ...label(half, gm), at: toAt(half, gm), player: scorer.id, assist: assist?.id || null });
    }
    const ny = poissonSample(YELLOW_PER_TEAM, r);
    for (let j = 0; j < ny; j++) {
      const half = r() < 0.42 ? 1 : 2;
      const gm = 0.3 + r() * ((half === 1 ? L1 : L2) - 0.6);
      const field = team.players.filter((p) => p.pos !== 'G');
      const p = pickWeighted(field, field.map((x) => (x.pos === 'D' ? 1.3 : x.pos === 'M' ? 1.2 : 0.8) * (0.4 + x.apps / 10)), r);
      events.push({ type: 'yellow', side, half, ...label(half, gm), at: toAt(half, gm), player: p.id });
    }
  }
  events.sort((a, b) => a.at - b.at);
  const goals = events.filter((e) => e.type === 'goal');
  const res = {
    id: m.id, L1, L2, events, lh, la,
    ftHome: nH, ftAway: nA,
    htHome: goals.filter((e) => e.side === 'home' && e.half === 1).length,
    htAway: goals.filter((e) => e.side === 'away' && e.half === 1).length,
    scorers: [...new Set(goals.map((e) => e.player))],
    first: goals[0]?.player || null,
    yellows: events.filter((e) => e.type === 'yellow').length,
  };
  world.cache.set(key, res);
  return res;
}

// Résultat communiqué au règlement des paris (uniquement une fois le match fini).
export function resultOf(world, m, now) {
  if (now < m.kickoff + SLOT_MS) return null;
  const s = simulate(world, m);
  return { status: 'finished', ftHome: s.ftHome, ftAway: s.ftAway, htHome: s.htHome, htAway: s.htAway, scorers: s.scorers, first: s.first, yellows: s.yellows };
}

// État affichable à l'instant now.
export function liveState(world, m, now) {
  const el = now - m.kickoff;
  if (el < 0) return { phase: 'pre', home: 0, away: 0, startsIn: -el };
  const s = simulate(world, m);
  const done = s.events.filter((e) => e.at <= el);
  const home = done.filter((e) => e.type === 'goal' && e.side === 'home').length;
  const away = done.filter((e) => e.type === 'goal' && e.side === 'away').length;
  if (el >= SLOT_MS) return { phase: 'ft', home, away, events: done, minute: 90, extra: s.L2 - 45 };
  let phase, minute, extra = 0;
  if (el < HALF_MS) {
    phase = '1h'; const gm = (el / HALF_MS) * s.L1;
    minute = gm <= 45 ? Math.max(1, Math.ceil(gm)) : 45; extra = gm <= 45 ? 0 : Math.ceil(gm - 45);
  } else if (el < HALF_MS + BREAK_MS) { phase = 'ht'; minute = 45; }
  else {
    phase = '2h'; const gm = 45 + ((el - HALF_MS - BREAK_MS) / HALF_MS) * s.L2;
    minute = gm <= 90 ? Math.ceil(gm) : 90; extra = gm <= 90 ? 0 : Math.ceil(gm - 90);
  }
  return { phase, home, away, minute, extra, events: done };
}

// ---------- classement virtuel de la saison en cours ----------
export function tableAt(world, g, season, upToRound) {
  const key = `tab|${g}|${season}|${upToRound}`;
  if (world.cache.has(key)) return world.cache.get(key);
  const grp = world.groups[g], n = world.groups.length;
  const rows = {};
  for (const id of grp.teamIds) rows[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  for (let rd = 0; rd < upToRound; rd++) {
    for (const m of roundMatches(world, g, season, rd)) {
      const s = simulate(world, m), h = rows[m.home], a = rows[m.away];
      h.p++; a.p++; h.gf += s.ftHome; h.ga += s.ftAway; a.gf += s.ftAway; a.ga += s.ftHome;
      if (s.ftHome > s.ftAway) { h.w++; a.l++; h.pts += 3; } else if (s.ftHome < s.ftAway) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
    }
  }
  const out = Object.values(rows).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
  out.forEach((r, i) => (r.rank = i + 1));
  world.cache.set(key, out);
  return out;
}

// ---------- cotes ----------
const odd = (p, m = MARGIN) => Math.min(500, Math.max(1.01, Math.round(100 / (p * (1 + m))) / 100));
const fmtLine = (l) => String(l).replace('.', ',');

export function marketsOf(world, m) {
  const key = 'mk|' + m.id;
  if (world.cache.has(key)) return world.cache.get(key);
  const { lh, la } = lambdas(world, m.home, m.away, m);
  const H = world.teams[m.home], A = world.teams[m.away];
  const N = 14;
  const grid = (x, y) => { const ph = [], pa = []; for (let i = 0; i <= N; i++) { ph.push(pois(x, i)); pa.push(pois(y, i)); } return [ph, pa]; };
  const sumBy = (ph, pa, f) => { let s = 0; for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) if (f(i, j)) s += ph[i] * pa[j]; return s; };
  const [ph, pa] = grid(lh, la);
  const pH = sumBy(ph, pa, (i, j) => i > j), pD = sumBy(ph, pa, (i, j) => i === j), pA = sumBy(ph, pa, (i, j) => i < j);
  const out = [];
  out.push({ kind: '1N2', title: 'Résultat du match', selections: [
    { pick: '1', label: H.short, odds: odd(pH) }, { pick: 'X', label: 'Match nul', odds: odd(pD) }, { pick: '2', label: A.short, odds: odd(pA) }] });
  out.push({ kind: 'DC', title: 'Double chance', selections: [
    { pick: '1X', label: `${H.short} ou nul`, odds: odd(pH + pD) }, { pick: '12', label: `${H.short} ou ${A.short}`, odds: odd(pH + pA) }, { pick: 'X2', label: `Nul ou ${A.short}`, odds: odd(pD + pA) }] });
  const dnb = (win, lose) => Math.max(1.01, Math.round(100 * (1 + lose / win / (1 + MARGIN))) / 100);
  out.push({ kind: 'DNB', title: 'Nul remboursé', selections: [{ pick: '1', label: H.short, odds: dnb(pH, pA) }, { pick: '2', label: A.short, odds: dnb(pA, pH) }] });
  const pB = (1 - Math.exp(-lh)) * (1 - Math.exp(-la));
  out.push({ kind: 'BTTS', title: 'Les deux équipes marquent', selections: [{ pick: 'yes', label: 'Oui', odds: odd(pB) }, { pick: 'no', label: 'Non', odds: odd(1 - pB) }] });
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const pO = sumBy(ph, pa, (i, j) => i + j > line);
    out.push({ kind: 'OU', line, title: `Plus/Moins de ${fmtLine(line)} buts`, selections: [
      { pick: 'over', label: `Plus de ${fmtLine(line)}`, odds: odd(pO) }, { pick: 'under', label: `Moins de ${fmtLine(line)}`, odds: odd(1 - pO) }] });
  }
  { // mi-temps
    const [qh, qa] = grid(lh * HT_SHARE, la * HT_SHARE);
    const a1 = sumBy(qh, qa, (i, j) => i > j), x1 = sumBy(qh, qa, (i, j) => i === j), b1 = sumBy(qh, qa, (i, j) => i < j);
    out.push({ kind: 'HT', title: 'Résultat à la mi-temps', selections: [
      { pick: '1', label: H.short, odds: odd(a1) }, { pick: 'X', label: 'Match nul', odds: odd(x1) }, { pick: '2', label: A.short, odds: odd(b1) }] });
  }
  { // cartons jaunes : total ~ Poisson(2 x 1,8)
    const lam = 2 * YELLOW_PER_TEAM;
    for (const line of [3.5, 4.5]) {
      let pO = 0; for (let k = 0; k <= 40; k++) if (k > line) pO += pois(lam, k);
      out.push({ kind: 'YC', line, title: `Cartons jaunes : plus/moins de ${fmtLine(line)}`, selections: [
        { pick: 'over', label: `Plus de ${fmtLine(line)}`, odds: odd(pO) }, { pick: 'under', label: `Moins de ${fmtLine(line)}`, odds: odd(1 - pO) }] });
    }
  }
  { // score exact
    const list = [];
    for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) list.push([i, j, ph[i] * pa[j]]);
    list.sort((x, y) => y[2] - x[2]);
    out.push({ kind: 'CS', title: 'Score exact', selections: list.slice(0, 12).map(([i, j, p]) => ({ pick: `${i}-${j}`, label: `${i}-${j}`, odds: odd(p, MARGIN_EXOTIC) })) });
  }
  { // buteurs : un joueur marque en moyenne (lambda de son équipe x sa part)
    const pool = [];
    for (const [t, lam] of [[H, lh], [A, la]]) for (const p of t.players) if (p.pos !== 'G') pool.push({ p, t, lam: lam * p.share });
    pool.sort((x, y) => y.lam - x.lam);
    const top = (side) => pool.filter((x) => x.t === side).slice(0, 5);
    const sel = [...top(H), ...top(A)].sort((x, y) => y.lam - x.lam);
    out.push({ kind: 'ANY', title: 'Buteur à tout moment', selections: sel.map((x) => ({ pick: x.p.id, label: x.p.name, team: x.t.id, odds: odd(1 - Math.exp(-x.lam), MARGIN_EXOTIC) })) });
    const tot = lh + la, pAny = 1 - Math.exp(-tot);
    const first = [];
    for (const [t, lam] of [[H, lh], [A, la]]) for (const p of t.players) if (p.pos !== 'G') first.push({ p, t, pr: pAny * (lam / tot) * p.share });
    first.sort((x, y) => y.pr - x.pr);
    const fsel = [...first.filter((x) => x.t === H).slice(0, 4), ...first.filter((x) => x.t === A).slice(0, 4)].sort((x, y) => y.pr - x.pr);
    out.push({ kind: 'FIRST', title: 'Premier buteur', selections: [...fsel.map((x) => ({ pick: x.p.id, label: x.p.name, team: x.t.id, odds: odd(x.pr, MARGIN_EXOTIC) })), { pick: 'none', label: 'Aucun but', odds: odd(Math.exp(-tot), MARGIN_EXOTIC) }] });
  }
  world.cache.set(key, out);
  return out;
}

// Probabilités "vraies" du modèle, pour les tests de calibration.
export function trueProbs(world, m) {
  const { lh, la } = lambdas(world, m.home, m.away, m);
  let pH = 0, pD = 0, pA = 0, o25 = 0, btts = 0;
  for (let i = 0; i <= 14; i++) for (let j = 0; j <= 14; j++) {
    const p = pois(lh, i) * pois(la, j);
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
    if (i + j > 2.5) o25 += p;
    if (i > 0 && j > 0) btts += p;
  }
  return { lh, la, pH, pD, pA, o25, btts };
}

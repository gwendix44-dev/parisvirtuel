// Construit docs/data/world.json : équipes réelles, stats saison, effectifs, logos, photos.
// Sources : ESPN (public, sans clé) et Wikipédia pour les photos. À relancer de temps en temps.
import fs from 'node:fs';

const LEAGUES = [
  { id: 'fra.1', name: 'Ligue 1', country: 'France', strength: 0.94 },
  { id: 'eng.1', name: 'Premier League', country: 'Angleterre', strength: 1.06 },
  { id: 'esp.1', name: 'LaLiga', country: 'Espagne', strength: 1.03 },
  { id: 'ita.1', name: 'Serie A', country: 'Italie', strength: 1.0 },
  { id: 'ger.1', name: 'Bundesliga', country: 'Allemagne', strength: 1.0 },
];
const UCL = { id: 'uefa.champions', name: 'Ligue des champions', country: 'Europe', strength: 1, size: 16 };
const UA = { 'user-agent': 'Mozilla/5.0 ParisVirtuel-personal' };
const log = (...a) => console.log(...a);

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
  }
  return null;
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const stat = (e, name) => e.stats.find((s) => s.name === name)?.value ?? 0;
async function standings(slug) {
  const j = await getJson(`https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`);
  const entries = j?.children?.[0]?.standings?.entries || [];
  return entries.map((e) => ({
    id: e.team.id, name: e.team.displayName, short: e.team.shortDisplayName || e.team.displayName,
    abbr: e.team.abbreviation, logo: e.team.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/soccer/500/${e.team.id}.png`,
    gp: stat(e, 'gamesPlayed'), gf: stat(e, 'pointsFor'), ga: stat(e, 'pointsAgainst'), pts: stat(e, 'points'),
    w: stat(e, 'wins'), d: stat(e, 'ties'), l: stat(e, 'losses'), rank: stat(e, 'rank'),
  }));
}

const POS = { G: 'G', D: 'D', M: 'M', F: 'F' };
async function roster(slug, teamId) {
  const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams/${teamId}/roster`);
  return (j?.athletes || []).map((a) => {
    const st = {};
    for (const c of a.statistics?.splits?.categories || []) for (const s of c.stats) st[s.name] = s.value;
    return {
      id: a.id, name: a.displayName, short: a.shortName || a.displayName, pos: POS[a.position?.abbreviation] || 'M',
      n: a.jersey ? Number(a.jersey) : null, age: a.age || null,
      apps: st.appearances || 0, goals: st.totalGoals || 0, assists: st.goalAssists || 0, shots: st.totalShots || 0,
    };
  });
}

async function photos(players) {
  const names = [...new Set(players.map((p) => p.name))];
  const found = {};
  const chunks = [];
  for (let i = 0; i < names.length; i += 40) chunks.push(names.slice(i, i + 40));
  await pool(chunks, 1, async (chunk) => {
    await new Promise((r) => setTimeout(r, 300));
    const base = 'https://en.wikipedia.org/w/api.php?action=query&redirects=1&format=json&prop=pageimages%7Cdescription&piprop=thumbnail&pithumbsize=160&titles=' + encodeURIComponent(chunk.join('|'));
    const back = {}, redir = {}, pages = {};
    let cont = '';
    for (let guard = 0; guard < 12; guard++) {
      const j = await getJson(base + cont);
      if (!j?.query) break;
      for (const n of j.query.normalized || []) back[n.to] = n.from;
      for (const r of j.query.redirects || []) redir[r.to] = r.from;
      for (const [id, pg] of Object.entries(j.query.pages || {})) pages[id] = { ...(pages[id] || {}), ...pg };
      if (!j.continue) break;
      cont = '&' + Object.entries(j.continue).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    }
    for (const pg of Object.values(pages)) {
      if (!pg.thumbnail || !/football|soccer/i.test(pg.description || '')) continue;
      let from = redir[pg.title] || pg.title; from = back[from] || from;
      found[from] = pg.thumbnail.source;
    }
  });
  return found;
}

const teams = {}, leagues = [];
for (const L of LEAGUES) {
  const rows = await standings(L.id);
  log(L.name, rows.length, 'équipes');
  for (const r of rows) teams[r.id] = { ...r, league: L.id };
  leagues.push({ ...L, teamIds: rows.map((r) => r.id) });
}
const ucl = (await standings(UCL.id)).sort((a, b) => a.rank - b.rank).slice(0, UCL.size);
for (const r of ucl) if (!teams[r.id]) teams[r.id] = { ...r, league: UCL.id, strengthOverride: 0.95 };
leagues.push({ ...UCL, teamIds: ucl.map((r) => r.id) });
log('Ligue des champions', ucl.length, 'équipes (dont', ucl.filter((r) => teams[r.id].league === UCL.id).length, 'hors top 5)');

const list = Object.values(teams);
await pool(list, 6, async (t) => {
  let pl = await roster(t.league, t.id);
  if (!pl.length) pl = await roster(UCL.id, t.id);
  t.players = pl.sort((a, b) => b.apps - a.apps).slice(0, 24);
});
log('effectifs :', list.reduce((n, t) => n + t.players.length, 0), 'joueurs');

const all = list.flatMap((t) => t.players);
const ph = await photos(all);
let withPhoto = 0;
for (const p of all) if (ph[p.name]) { p.photo = ph[p.name]; withPhoto++; }
log('photos :', withPhoto, '/', all.length);

const bad = list.filter((t) => t.players.length < 11 || t.gp < 1);
if (bad.length) log('ATTENTION données faibles :', bad.map((t) => t.name).join(', '));
fs.mkdirSync('docs/data', { recursive: true });
fs.writeFileSync('docs/data/world.json', JSON.stringify({ generatedAt: Date.now(), leagues, teams }));
log('écrit docs/data/world.json', (fs.statSync('docs/data/world.json').size / 1024).toFixed(0), 'Ko');

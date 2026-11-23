import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeWinamax } from './src/winamax.js';
import { pollScores, demoState } from './src/livescores.js';
import { demoMatches } from './src/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DEMO = process.env.DEMO === '1';
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const ODDS_INTERVAL = Number(process.env.ODDS_INTERVAL_S || 90) * 1000;
const LIVE_INTERVAL = Number(process.env.LIVE_INTERVAL_S || 300) * 1000; // 5 min par défaut (quota API)
const IDLE_INTERVAL = Number(process.env.IDLE_INTERVAL_S || 3600) * 1000;
const DATA = path.join(__dirname, 'data');
const TRACK_FILE = path.join(DATA, 'tracked.json');

fs.mkdirSync(DATA, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// tracked : tous les matchs vus (id -> {home, away, kickoff, live?, result?}), persistés
// pour pouvoir régler les paris même après la disparition du match du catalogue.
let tracked = {};
if (!DEMO) { try { tracked = JSON.parse(fs.readFileSync(TRACK_FILE, 'utf8')); } catch {} }
const save = () => { try { fs.writeFileSync(TRACK_FILE, JSON.stringify(tracked)); } catch {} };

const state = { matches: [], updatedAt: null, error: null, source: DEMO ? 'demo' : 'winamax' };

function track(list) {
  const now = Date.now();
  for (const m of list) {
    const t = (tracked[m.id] ||= { id: m.id });
    Object.assign(t, { home: m.home, away: m.away, kickoff: m.kickoff });
    if (m.demoGoals) t.demoGoals = m.demoGoals;
  }
  for (const [id, t] of Object.entries(tracked)) if (t.kickoff < now - 10 * 86400e3) delete tracked[id];
  save();
}

async function refreshOdds() {
  try {
    if (DEMO) {
      if (!state.matches.length) state.matches = demoMatches();
    } else {
      state.matches = await scrapeWinamax({ log });
    }
    state.updatedAt = Date.now();
    state.error = null;
    track(state.matches);
    log(`catalogue : ${state.matches.length} matchs`);
  } catch (e) {
    state.error = e.message;
    log('ERREUR cotes :', e.message);
  }
}

async function refreshScores() {
  const now = Date.now();
  try {
    if (DEMO) {
      for (const t of Object.values(tracked)) {
        if (t.result || !t.demoGoals) continue;
        const s = demoState(t, now);
        t.live = s;
        if (s.status === 'finished') t.result = s;
      }
      save();
      return process.env.DEMO_FAST === "1" ? 1000 : 10_000;
    }
    if (!API_KEY) return IDLE_INTERVAL;
    const { calls } = await pollScores(tracked, API_KEY, { log });
    save();
    const active = Object.values(tracked).some((m) => !m.result && m.kickoff < now + 5 * 60e3 && m.kickoff > now - 4 * 3600e3);
    if (calls) log(`scores : ${calls} appel(s) API`);
    return active ? LIVE_INTERVAL : IDLE_INTERVAL;
  } catch (e) {
    log('ERREUR scores :', e.message);
    return LIVE_INTERVAL;
  }
}

(async function oddsLoop() {
  await refreshOdds();
  setInterval(refreshOdds, ODDS_INTERVAL);
})();
(async function scoreLoop() {
  const wait = await refreshScores();
  setTimeout(scoreLoop, wait);
})();

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/matches', (req, res) => {
  res.json({
    updatedAt: state.updatedAt,
    source: state.source,
    error: state.error,
    scoresEnabled: DEMO || !!API_KEY,
    matches: state.matches.map(({ demoGoals, ...m }) => ({ ...m, live: tracked[m.id]?.live || null })),
  });
});

// Résultats finaux (finished / void) pour une liste d'ids.
app.get('/api/results', (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
  const results = {}, live = {};
  for (const id of ids) {
    const t = tracked[id];
    if (t?.result) results[id] = t.result;
    else if (t?.live) live[id] = t.live;
  }
  res.json({ results, live });
});

// Le téléphone envoie les matchs de ses paris en cours : le serveur les (re)suit même après un redémarrage.
app.post('/api/results', (req, res) => {
  const legs = Array.isArray(req.body?.legs) ? req.body.legs.slice(0, 200) : [];
  for (const l of legs) {
    if (!l?.id || tracked[l.id] || !l.home || !l.away || !Number.isFinite(l.kickoff)) continue;
    tracked[l.id] = { id: String(l.id), home: String(l.home), away: String(l.away), kickoff: l.kickoff };
  }
  if (legs.length) save();
  const results = {}, live = {};
  for (const l of legs) {
    const t = tracked[l?.id];
    if (t?.result) results[l.id] = t.result; else if (t?.live) live[l.id] = t.live;
  }
  res.json({ results, live });
});

app.get('/api/health', (req, res) =>
  res.json({ ok: true, source: state.source, matches: state.matches.length, tracked: Object.keys(tracked).length, updatedAt: state.updatedAt, error: state.error })
);

app.listen(PORT, () => log(`ParisVirtuel sur http://localhost:${PORT}  (${DEMO ? 'MODE DÉMO' : 'Winamax + ' + (API_KEY ? 'API-Football' : 'SANS scores (API_FOOTBALL_KEY manquante)')})`));

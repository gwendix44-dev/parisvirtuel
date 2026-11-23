// Mode local / serveur permanent (optionnel). Sur GitHub, c'est scripts/update.js qui fait ce travail.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { update, publish } from './src/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DEMO = process.env.DEMO === '1';
const FAST = process.env.DEMO_FAST === '1';
const OUT = path.join(__dirname, 'docs', 'data', 'state.json');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let state = null;
if (!DEMO) { try { state = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {} }
else { try { fs.unlinkSync(OUT); } catch {} }

async function cycle() {
  state = await update(state, { demo: DEMO, scrapeEvery: Number(process.env.ODDS_INTERVAL_S || 90) * 1000, log });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(publish(state)));
}
await cycle();
setInterval(cycle, FAST ? 1000 : DEMO ? 10000 : Number(process.env.SCORES_INTERVAL_S || 60) * 1000);

const app = express();
app.use(express.static(path.join(__dirname, 'docs')));
app.get('/api/health', (req, res) => res.json({ ok: true, source: state.source, matches: state.matches.length, tracked: Object.keys(state.tracked).length, updatedAt: state.updatedAt, error: state.error }));
app.listen(PORT, () => log(`ParisVirtuel sur http://localhost:${PORT} (${DEMO ? 'MODE DÉMO' : 'Winamax + ESPN'})`));

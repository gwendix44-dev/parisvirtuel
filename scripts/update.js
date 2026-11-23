// Lancé par GitHub Actions toutes les ~5 minutes : met à jour docs/data/state.json.
import fs from 'node:fs';
import path from 'node:path';
import { update, publish } from '../src/engine.js';

const OUT = path.join('docs', 'data', 'state.json');
let prev = null;
const repo = process.env.GITHUB_REPOSITORY; // "owner/nom"
try {
  if (repo) {
    const [o, r] = repo.split('/');
    const res = await fetch(`https://${o.toLowerCase()}.github.io/${r}/data/state.json?t=${Date.now()}`);
    if (res.ok) prev = await res.json();
    else console.log('pas d\'état précédent (HTTP ' + res.status + ')');
  } else if (fs.existsSync(OUT)) prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch (e) { console.log('état précédent illisible :', e.message); }

const state = await update(prev, { scrapeEvery: 0 });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(publish(state)));
console.log('écrit', OUT, state.error ? '(avec erreur : ' + state.error + ')' : '');

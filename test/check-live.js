// Vérification sur la vraie source : node test/check-live.js
// Affiche les prochains matchs lus sur Winamax, avec heure locale, pour comparer à l'œil avec winamax.fr.
import { scrapeWinamax } from '../src/winamax.js';
import { fetchFixtures, matchFixture } from '../src/livescores.js';
const list = await scrapeWinamax({ detailLimit: 5 });
console.log(`${list.length} matchs de foot lus sur Winamax\n`);
const fmt = (t) => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
for (const m of list.slice(0, 15)) {
  const o = m.markets.find((x) => x.kind === '1N2').selections.map((s) => s.odds.toFixed(2)).join(' / ');
  console.log(`${fmt(m.kickoff).padEnd(24)} ${m.competition.padEnd(18)} ${m.home} - ${m.away}   [${o}]  ${m.markets.length} marchés`);
}
if (process.env.API_FOOTBALL_KEY) {
  const days = [...new Set(list.map((m) => new Date(m.kickoff).toISOString().slice(0, 10)))].slice(0, 2);
  let ok = 0, tot = 0;
  for (const d of days) {
    const fx = await fetchFixtures(d, process.env.API_FOOTBALL_KEY);
    for (const m of list.filter((x) => new Date(x.kickoff).toISOString().slice(0, 10) === d)) { tot++; if (matchFixture(m, fx)) ok++; else console.log('Sans correspondance API-Football :', m.home, '-', m.away, fmt(m.kickoff)); }
  }
  console.log(`\nAssociation avec API-Football : ${ok}/${tot}`);
}

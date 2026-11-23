import assert from 'node:assert/strict';
import { legOutcome, settleBet } from '../docs/settle.js';
import { extractState, parseState } from '../src/winamax.js';
import { teamSim, matchEvent, eventToState } from '../src/scores.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const fin = (h, a) => ({ status: 'finished', ftHome: h, ftAway: a });

t('1N2 / DC / DNB / BTTS / OU', () => {
  assert.equal(legOutcome({ market: '1N2', pick: '1' }, fin(2, 1)), 'won');
  assert.equal(legOutcome({ market: '1N2', pick: 'X' }, fin(2, 1)), 'lost');
  assert.equal(legOutcome({ market: 'DC', pick: 'X2' }, fin(0, 0)), 'won');
  assert.equal(legOutcome({ market: 'DC', pick: '12' }, fin(1, 1)), 'lost');
  assert.equal(legOutcome({ market: 'DNB', pick: '1' }, fin(1, 1)), 'void');
  assert.equal(legOutcome({ market: 'BTTS', pick: 'yes' }, fin(1, 1)), 'won');
  assert.equal(legOutcome({ market: 'BTTS', pick: 'no' }, fin(2, 0)), 'won');
  assert.equal(legOutcome({ market: 'OU', pick: 'over', line: 2.5 }, fin(2, 1)), 'won');
  assert.equal(legOutcome({ market: 'OU', pick: 'under', line: 2.5 }, fin(2, 1)), 'lost');
  assert.equal(legOutcome({ market: 'OU', pick: 'over', line: 3 }, fin(2, 1)), 'void');
  assert.equal(legOutcome({ market: '1N2', pick: '1' }, { status: 'void' }), 'void');
  assert.equal(legOutcome({ market: '1N2', pick: '1' }, undefined), null);
});

t('combiné : gain, perdu dès une jambe perdue, remboursé si void', () => {
  const mk = (legs) => ({ stake: 10, status: 'pending', legs: legs.map((l) => ({ status: 'pending', market: '1N2', ...l })) });
  const b = mk([{ matchId: 'a', pick: '1', odds: 2 }, { matchId: 'b', pick: '2', odds: 3 }]);
  assert.equal(settleBet(b, { a: fin(1, 0) }).status, 'pending');
  assert.equal(settleBet(b, { a: fin(0, 1) }).status, 'lost');
  const w = settleBet(b, { a: fin(1, 0), b: fin(0, 2) });
  assert.equal(w.status, 'won'); assert.equal(w.payout, 60);
  const v = settleBet(b, { a: fin(1, 0), b: { status: 'void' } });
  assert.equal(v.status, 'won'); assert.equal(v.payout, 20);
  const vv = settleBet(b, { a: { status: 'void' }, b: { status: 'void' } });
  assert.equal(vv.status, 'void'); assert.equal(vv.payout, 10);
});

t('parse PRELOADED_STATE Winamax (fixture)', () => {
  const state = {
    matches: { 1: { matchId: 1, sportId: 1, competitor1Name: 'Paris SG', competitor2Name: 'Lyon', matchStart: 1900000000, tournamentId: 7, categoryId: 3 } },
    tournaments: { 7: { tournamentName: 'Ligue 1' } }, categories: { 3: { categoryName: 'France' } },
    bets: {
      10: { betId: 10, matchId: 1, betTitle: 'Résultat', outcomes: [100, 101, 102] },
      11: { betId: 11, matchId: 1, betTitle: 'Plus/Moins de buts', outcomes: [110, 111] },
      12: { betId: 12, matchId: 1, betTitle: 'Les deux équipes marquent', outcomes: [120, 121] },
      13: { betId: 13, matchId: 1, betTitle: 'Premier buteur', outcomes: [130] },
      14: { betId: 14, matchId: 1, betTitle: 'Double chance', outcomes: [140, 141, 142] },
    },
    outcomes: {
      100: { label: 'Paris SG' }, 101: { label: 'Match nul' }, 102: { label: 'Lyon' },
      110: { label: 'Plus de 2,5' }, 111: { label: 'Moins de 2,5' },
      120: { label: 'Oui' }, 121: { label: 'Non' }, 130: { label: 'Dembélé' },
      140: { label: 'Paris SG ou Match nul' }, 141: { label: 'Paris SG ou Lyon' }, 142: { label: 'Match nul ou Lyon' },
    },
    odds: { 100: 1.5, 101: 4.2, 102: 6, 110: 1.7, 111: 2.1, 120: 1.6, 121: 2.2, 130: 5, 140: 1.2, 141: 1.2, 142: 2.5 },
  };
  const html = `<script>var PRELOADED_STATE = ${JSON.stringify(state)};var x=1;</script>`;
  const m = parseState(extractState(html)).get('1');
  assert.equal(m.competition, 'Ligue 1');
  assert.deepEqual(m.markets.map((x) => x.kind).sort(), ['1N2', 'BTTS', 'DC', 'OU']);
  assert.equal(m.markets.find((x) => x.kind === 'OU').line, 2.5);
  assert.deepEqual(m.markets.find((x) => x.kind === '1N2').selections.map((s) => s.pick), ['1', 'X', '2']);
  assert.deepEqual(m.markets.find((x) => x.kind === 'DC').selections.map((s) => s.pick), ['1X', '12', 'X2']);
});

t('rapprochement Winamax ↔ ESPN et statuts', () => {
  assert.ok(teamSim('Paris SG', 'Paris Saint-Germain') > 0.9);
  assert.ok(teamSim('Lens', 'RC Lens') > 0.9);
  assert.ok(teamSim('Nantes', 'Rennes') < 0.5);
  const ko = Date.parse('2026-11-23T20:00:00Z');
  const ev = (home, away, hs, as, type, extra = {}) => ({ date: new Date(ko).toISOString(), status: { displayClock: "35'", type }, competitions: [{ competitors: [
    { homeAway: 'home', score: String(hs), team: { id: '1', displayName: home } }, { homeAway: 'away', score: String(as), team: { id: '2', displayName: away } }], ...extra }] });
  const FT = { name: 'STATUS_FULL_TIME', state: 'post', completed: true };
  const list = [ev('Nantes', 'Rennes', 0, 0, FT), ev('Paris Saint-Germain', 'Marseille', 2, 1, FT)];
  const f = matchEvent({ home: 'Paris SG', away: 'Olympique de Marseille', kickoff: ko }, list);
  assert.equal(f.competitions[0].competitors[0].team.displayName, 'Paris Saint-Germain');
  assert.deepEqual([eventToState(f).status, eventToState(f).ftHome, eventToState(f).ftAway], ['finished', 2, 1]);
  assert.equal(eventToState(ev('A', 'B', 1, 0, { name: 'STATUS_FIRST_HALF', state: 'in' })).status, 'live');
  assert.equal(eventToState(ev('A', 'B', 1, 0, { name: 'STATUS_HALFTIME', state: 'in' })).code, 'HT');
  assert.equal(eventToState(ev('A', 'B', 0, 0, { name: 'STATUS_SCHEDULED', state: 'pre' })).status, 'pending');
  assert.equal(eventToState(ev('A', 'B', 0, 0, { name: 'STATUS_POSTPONED', state: 'pre' })).status, 'void');
  // prolongation : le score à 90 min vient des buts détaillés (but à 105' ignoré)
  const goal = (min, tid) => ({ scoringPlay: true, shootout: false, team: { id: tid }, clock: { displayValue: min } });
  const aet = ev('A', 'B', 2, 1, { name: 'STATUS_FINAL_AET', state: 'post', completed: true }, { details: [goal("20'", '1'), goal("90'+2'", '2'), goal("105'", '1')] });
  const st = eventToState(aet);
  assert.deepEqual([st.ftHome, st.ftAway, st.approx], [1, 1, undefined]);
});

console.log(`\n${n} groupes de tests OK`);

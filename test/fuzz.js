import assert from 'node:assert/strict';
import { settleBet } from '../docs/settle.js';
let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ri = (n) => Math.floor(rnd() * n);
const MK = [['1N2', ['1', 'X', '2']], ['DC', ['1X', '12', 'X2']], ['DNB', ['1', '2']], ['BTTS', ['yes', 'no']], ['OU', ['over', 'under']]];
function refLeg(l, h, a) { // référence écrite autrement (par énumération)
  const won = { '1N2': () => ({ 1: h > a, X: h === a, 2: h < a })[l.pick],
    DC: () => l.pick.split('').some((c) => ({ 1: h > a, X: h === a, 2: h < a })[c]),
    DNB: () => (h === a ? null : l.pick === '1' ? h > a : h < a),
    BTTS: () => (l.pick === 'yes') === (h > 0 && a > 0),
    OU: () => (h + a === l.line ? null : l.pick === 'over' ? h + a > l.line : h + a < l.line) }[l.market]();
  return won === null ? 'void' : won ? 'won' : 'lost';
}
let bets = 0;
for (let i = 0; i < 20000; i++) {
  const n = 1 + ri(4), legs = [], res = {};
  for (let k = 0; k < n; k++) {
    const [market, picks] = MK[ri(MK.length)];
    const line = [0.5, 1.5, 2, 2.5, 3, 3.5][ri(6)];
    legs.push({ matchId: 'm' + k, market, pick: picks[ri(picks.length)], line: market === 'OU' ? line : null, odds: 1.1 + ri(80) / 10, status: 'pending' });
    res['m' + k] = rnd() < 0.05 ? { status: 'void' } : { status: 'finished', ftHome: ri(6), ftAway: ri(6) };
  }
  const stake = 1 + ri(100);
  const out = settleBet({ stake, status: 'pending', legs }, res);
  const ls = legs.map((l) => res[l.matchId].status === 'void' ? 'void' : refLeg(l, res[l.matchId].ftHome, res[l.matchId].ftAway));
  if (ls.includes('lost')) assert.equal(out.status, 'lost'), assert.equal(out.payout, 0);
  else if (ls.every((s) => s === 'void')) assert.equal(out.status, 'void'), assert.equal(out.payout, stake);
  else { const o = legs.reduce((a, l, j) => a * (ls[j] === 'won' ? l.odds : 1), 1); assert.equal(out.status, 'won'); assert.ok(Math.abs(out.payout - stake * Math.round(o * 100) / 100) <= 0.0051 + 1e-9, `${out.payout} vs ${stake * o}`); }
  assert.ok(out.payout >= 0); bets++;
}
console.log(`fuzz règlement : ${bets} paris aléatoires conformes à la référence`);

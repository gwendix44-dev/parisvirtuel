// Règlement des paris (fonctions pures, utilisées par le navigateur et les tests).

export function legOutcome(leg, r) {
  if (!r) return null;
  if (r.status === 'void') return 'void';
  if (r.status !== 'finished') return null;
  const h = r.ftHome, a = r.ftAway, t = h + a;
  const res = h > a ? '1' : h < a ? '2' : 'X';
  switch (leg.market) {
    case '1N2': return leg.pick === res ? 'won' : 'lost';
    case 'DC': return leg.pick.includes(res) ? 'won' : 'lost';
    case 'DNB': return res === 'X' ? 'void' : leg.pick === res ? 'won' : 'lost';
    case 'BTTS': return (leg.pick === 'yes') === (h > 0 && a > 0) ? 'won' : 'lost';
    case 'OU':
      if (t === leg.line) return 'void';
      return (leg.pick === 'over') === t > leg.line ? 'won' : 'lost';
  }
  return null;
}

// Retourne un nouveau pari avec statuts mis à jour. payout défini quand le pari est terminé.
export function settleBet(bet, results) {
  if (bet.status !== 'pending') return bet;
  const legs = bet.legs.map((l) => {
    if (l.status !== 'pending') return l;
    const o = legOutcome(l, results[l.matchId]);
    return o ? { ...l, status: o, score: scoreOf(results[l.matchId]) } : l;
  });
  let status = 'pending', payout = 0;
  if (legs.some((l) => l.status === 'lost')) status = 'lost';
  else if (legs.every((l) => l.status !== 'pending')) {
    const eff = legs.reduce((acc, l) => acc * (l.status === 'won' ? l.odds : 1), 1);
    if (legs.every((l) => l.status === 'void')) { status = 'void'; payout = bet.stake; }
    else { status = 'won'; payout = round2(bet.stake * eff); }
  }
  return { ...bet, legs, status, payout };
}

const scoreOf = (r) => (r && r.ftHome != null ? `${r.ftHome}-${r.ftAway}` : null);
export const round2 = (n) => Math.round(n * 100) / 100;
export const comboOdds = (legs) => round2(legs.reduce((a, l) => a * l.odds, 1));

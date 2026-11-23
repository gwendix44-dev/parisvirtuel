// Données de démonstration (cotes inventées, scores simulés). Pour tester sans clés.

function markets(h, a, [o1, ox, o2]) {
  const r = (n) => Math.round(n * 100) / 100;
  return [
    { kind: '1N2', title: 'Résultat du match', selections: [
      { pick: '1', label: h, odds: o1 }, { pick: 'X', label: 'Match nul', odds: ox }, { pick: '2', label: a, odds: o2 }] },
    { kind: 'DC', title: 'Double chance', selections: [
      { pick: '1X', label: `${h} ou Match nul`, odds: r(1 / (1 / o1 + 1 / ox) * 0.95) },
      { pick: '12', label: `${h} ou ${a}`, odds: r(1 / (1 / o1 + 1 / o2) * 0.95) },
      { pick: 'X2', label: `Match nul ou ${a}`, odds: r(1 / (1 / ox + 1 / o2) * 0.95) }] },
    { kind: 'DNB', title: 'Nul remboursé', selections: [
      { pick: '1', label: h, odds: r(o1 * (1 - 1 / ox) + 0.05) }, { pick: '2', label: a, odds: r(o2 * (1 - 1 / ox) + 0.05) }] },
    { kind: 'BTTS', title: 'Les deux équipes marquent', selections: [
      { pick: 'yes', label: 'Oui', odds: 1.8 }, { pick: 'no', label: 'Non', odds: 1.95 }] },
    { kind: 'OU', line: 1.5, title: 'Plus/Moins de 1,5 buts', selections: [
      { pick: 'over', label: 'Plus de 1,5', odds: 1.3 }, { pick: 'under', label: 'Moins de 1,5', odds: 3.4 }] },
    { kind: 'OU', line: 2.5, title: 'Plus/Moins de 2,5 buts', selections: [
      { pick: 'over', label: 'Plus de 2,5', odds: 1.95 }, { pick: 'under', label: 'Moins de 2,5', odds: 1.85 }] },
    { kind: 'OU', line: 3.5, title: 'Plus/Moins de 3,5 buts', selections: [
      { pick: 'over', label: 'Plus de 3,5', odds: 3.2 }, { pick: 'under', label: 'Moins de 3,5', odds: 1.3 }] },
  ];
}

const DEFS = [
  ['d1', 'France', 'Ligue 1', 'Lens', 'Marseille', -35, [12], [30], [2.4, 3.3, 2.9]],
  ['d2', 'Angleterre', 'Premier League', 'Arsenal', 'Chelsea', -150, [20, 70], [55], [1.9, 3.6, 4.0]],
  ['d3', 'France', 'Ligue 1', 'Nantes', 'Rennes', 25, [], [], [3.1, 3.2, 2.2]],
  ['d4', 'Espagne', 'LaLiga', 'Real Madrid', 'Séville', 90, [], [], [1.45, 4.6, 7.0]],
  ['d5', 'Italie', 'Serie A', 'Inter', 'Naples', 200, [], [], [2.2, 3.4, 3.2]],
  ['d6', 'Allemagne', 'Bundesliga', 'Dortmund', 'Leipzig', 600, [], [], [2.5, 3.5, 2.6]],
  ['d8', 'France', 'Ligue 1', 'Monaco', 'Nice', 40, [5, 50], [70], [1.6, 4.0, 5.2]],
  ['d7', 'France', 'Ligue 2', 'Metz', 'Caen', 1500, [], [], [2.0, 3.3, 3.7]],
];

export function demoMatches(t0 = Date.now()) {
  return DEFS.map(([id, country, competition, home, away, off, gh, ga, o]) => ({
    id,
    home,
    away,
    country,
    competition,
    kickoff: t0 + off * (process.env.DEMO_FAST === "1" ? 1000 : 60e3),
    markets: markets(home, away, o),
    demoGoals: { home: gh, away: ga },
  }));
}

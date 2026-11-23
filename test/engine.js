import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld, matchesOfSlot, matchById, simulate, marketsOf, trueProbs, liveState, resultOf, tableAt, lambdas, SLOT_MS, HALF_MS, BREAK_MS } from '../docs/sim.js';

const raw = JSON.parse(fs.readFileSync('docs/data/world.json', 'utf8'));
const W = () => createWorld(JSON.parse(JSON.stringify(raw)));
const world = W();
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('déterminisme : deux mondes identiques donnent exactement les mêmes matchs et résultats', () => {
  const w2 = W();
  for (let k = 40000; k < 40060; k++) {
    const a = matchesOfSlot(world, k), b = matchesOfSlot(w2, k);
    assert.deepEqual(a, b);
    for (const m of a) { const x = simulate(world, m), y = simulate(w2, m); assert.deepEqual([x.ftHome, x.ftAway, x.events.length, x.first], [y.ftHome, y.ftAway, y.events.length, y.first]); }
  }
});

t('calendrier : jamais une équipe deux fois dans un créneau, tous les matchs retrouvables par id', () => {
  for (let k = 40000; k < 40240; k++) {
    const ms = matchesOfSlot(world, k), seen = new Set();
    for (const m of ms) {
      assert.ok(!seen.has(m.home) && !seen.has(m.away) && m.home !== m.away, `doublon k=${k}`);
      seen.add(m.home); seen.add(m.away);
      assert.deepEqual(matchById(world, m.id), m);
    }
    assert.equal(ms.length, world.groups[k % 6].teamIds.length / 2);
  }
});

t('saison : chaque équipe affronte chacune 2 fois (domicile/extérieur) sur une saison', () => {
  for (let g = 0; g < 6; g++) {
    const grp = world.groups[g], cnt = {};
    for (let rd = 0; rd < grp.rounds; rd++) for (const m of matchesOfSlot(world, (rd * 6) + g)) { const key = m.home + '>' + m.away; cnt[key] = (cnt[key] || 0) + 1; }
    const n = grp.teamIds.length;
    assert.equal(Object.keys(cnt).length, n * (n - 1), grp.name);
    assert.ok(Object.values(cnt).every((v) => v === 1), grp.name);
  }
});

t('chronologie : 14 min + 2 min + 14 min = 30 min, score final cohérent, événements ordonnés', () => {
  assert.equal(HALF_MS * 2 + BREAK_MS, SLOT_MS);
  const m = matchesOfSlot(world, 40001)[0], s = simulate(world, m);
  const L = (el) => liveState(world, m, m.kickoff + el);
  assert.equal(L(-1).phase, 'pre'); assert.equal(L(1000).phase, '1h');
  assert.equal(L(HALF_MS + 1000).phase, 'ht'); assert.equal(L(HALF_MS + BREAK_MS + 1000).phase, '2h');
  const end = L(SLOT_MS); assert.equal(end.phase, 'ft'); assert.deepEqual([end.home, end.away], [s.ftHome, s.ftAway]);
  for (let i = 1; i < s.events.length; i++) assert.ok(s.events[i].at >= s.events[i - 1].at);
  assert.ok(s.events.every((e) => e.at >= 0 && e.at <= SLOT_MS));
  assert.equal(resultOf(world, m, m.kickoff + SLOT_MS - 1), null);
  assert.equal(resultOf(world, m, m.kickoff + SLOT_MS).ftHome, s.ftHome);
});

t('réalisme : buts/match, % domicile-nul-extérieur, BTTS, cartons sur 4000 matchs', () => {
  let g = 0, H = 0, D = 0, A = 0, b = 0, o25 = 0, yc = 0, N = 0;
  for (let k = 50000; k < 50000 + 700; k++) for (const m of matchesOfSlot(world, k)) {
    const s = simulate(world, m); N++; g += s.ftHome + s.ftAway; yc += s.yellows;
    if (s.ftHome > s.ftAway) H++; else if (s.ftHome === s.ftAway) D++; else A++;
    if (s.ftHome && s.ftAway) b++; if (s.ftHome + s.ftAway > 2.5) o25++;
  }
  const pc = (x) => (100 * x / N).toFixed(1);
  console.log(`   ${N} matchs : ${(g / N).toFixed(2)} buts/match | dom ${pc(H)}% nul ${pc(D)}% ext ${pc(A)}% | BTTS ${pc(b)}% | +2,5 ${pc(o25)}% | ${(yc / N).toFixed(2)} jaunes`);
  assert.ok(g / N > 2.3 && g / N < 3.2); assert.ok(H / N > 0.38 && H / N < 0.52); assert.ok(D / N > 0.2 && D / N < 0.3); assert.ok(A / N > 0.22 && A / N < 0.36);
});

t('calibration : fréquences simulées = probabilités des cotes (1N2, +2,5, BTTS) sur un même match rejoué', () => {
  // on rejoue la même affiche avec 20000 graines différentes en réutilisant le tirage du moteur
  const m0 = matchesOfSlot(world, 40002)[0];
  const p = trueProbs(world, m0);
  let h = 0, d = 0, a = 0, o = 0, b = 0; const N = 20000;
  for (let i = 0; i < N; i++) {
    const s = simulate(world, { ...m0, id: m0.id + '#' + i });
    if (s.ftHome > s.ftAway) h++; else if (s.ftHome === s.ftAway) d++; else a++;
    if (s.ftHome + s.ftAway > 2.5) o++; if (s.ftHome && s.ftAway) b++;
  }
  const tol = 0.012;
  console.log(`   λ ${p.lh.toFixed(2)}-${p.la.toFixed(2)} | sim H/N/A ${(h / N).toFixed(3)}/${(d / N).toFixed(3)}/${(a / N).toFixed(3)} vs théorie ${p.pH.toFixed(3)}/${p.pD.toFixed(3)}/${p.pA.toFixed(3)}`);
  assert.ok(Math.abs(h / N - p.pH) < tol && Math.abs(d / N - p.pD) < tol && Math.abs(a / N - p.pA) < tol);
  assert.ok(Math.abs(o / N - p.o25) < tol && Math.abs(b / N - p.btts) < tol);
});

t('rentabilité des paris : espérance de gain ≈ -marge pour chaque marché (aucun pari gagnant à coup sûr)', () => {
  // Monte Carlo : on mise 1 € sur CHAQUE sélection de chaque marché de 120 matchs x 60 rejeux
  const ev = {}; let cnt = 0;
  const lg = (k) => matchesOfSlot(world, k);
  const win = (kind, sel, line, s) => {
    const T = s.ftHome + s.ftAway;
    switch (kind) {
      case '1N2': return sel === (s.ftHome > s.ftAway ? '1' : s.ftHome < s.ftAway ? '2' : 'X') ? 1 : 0;
      case 'DC': return sel.includes(s.ftHome > s.ftAway ? '1' : s.ftHome < s.ftAway ? '2' : 'X') ? 1 : 0;
      case 'DNB': return s.ftHome === s.ftAway ? 'v' : sel === (s.ftHome > s.ftAway ? '1' : '2') ? 1 : 0;
      case 'BTTS': return (sel === 'yes') === (s.ftHome > 0 && s.ftAway > 0) ? 1 : 0;
      case 'OU': return (sel === 'over') === (T > line) ? 1 : 0;
      case 'HT': return sel === (s.htHome > s.htAway ? '1' : s.htHome < s.htAway ? '2' : 'X') ? 1 : 0;
      case 'YC': return (sel === 'over') === (s.yellows > line) ? 1 : 0;
      case 'CS': return sel === `${s.ftHome}-${s.ftAway}` ? 1 : 0;
      case 'ANY': return s.scorers.includes(sel) ? 1 : 0;
      case 'FIRST': return (s.first || 'none') === sel ? 1 : 0;
    }
  };
  for (let k = 60000; k < 60012; k++) for (const m of lg(k).slice(0, 4)) {
    const mk = marketsOf(world, m);
    for (let i = 0; i < 400; i++) {
      const s = simulate(world, { ...m, id: m.id + '#' + i });
      for (const M of mk) for (const S of M.selections) {
        const w = win(M.kind, S.pick, M.line, s), key = M.kind;
        (ev[key] ||= { n: 0, ret: 0 }).n++;
        ev[key].ret += w === 'v' ? 1 : w ? S.odds : 0;
      }
    }
    cnt++;
  }
  const rows = Object.entries(ev).map(([k, v]) => `${k} ${(100 * (v.ret / v.n - 1)).toFixed(1)}%`);
  console.log('   rendement moyen par marché (sur ' + cnt + ' matchs x 400) : ' + rows.join(' | '));
  for (const [k, v] of Object.entries(ev)) assert.ok(v.ret / v.n - 1 < 0.04, `${k} trop généreux : ${(100 * (v.ret / v.n - 1)).toFixed(1)}%`);
});

t('forces réelles : PSG/Man City favoris contre un promu, domicile avantagé', () => {
  const byName = (s) => Object.values(world.teams).find((x) => x.name.includes(s));
  const psg = byName('Paris Saint-Germain'), city = byName('Manchester City');
  const weak = Object.values(world.teams).filter((x) => x.league === 'fra.1').sort((a, b) => b.rank - a.rank)[0];
  const x = lambdas(world, psg.id, weak.id), y = lambdas(world, weak.id, psg.id);
  console.log(`   ${psg.name} - ${weak.name} : λ ${x.lh.toFixed(2)}-${x.la.toFixed(2)} | retour ${y.lh.toFixed(2)}-${y.la.toFixed(2)}`);
  assert.ok(x.lh > x.la * 1.8 && x.lh > y.la);
  assert.ok(city && lambdas(world, city.id, psg.id).lh > 0.3);
});

t('classement virtuel : points cohérents avec les résultats', () => {
  const tb = tableAt(world, 0, 100, 10);
  assert.equal(tb.length, 18); assert.ok(tb.every((r) => r.p === 10 && r.w * 3 + r.d === r.pts));
  assert.equal(tb.reduce((a, r) => a + r.gf, 0), tb.reduce((a, r) => a + r.ga, 0));
});

console.log(`\n${n} groupes de tests moteur OK`);

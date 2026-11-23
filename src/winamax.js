// Scraper Winamax : lit l'objet PRELOADED_STATE embarqué dans les pages HTML.
// Usage perso uniquement. Le scraping est contraire aux CGU de Winamax.

const BASE = 'https://www.winamax.fr';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function extractState(html) {
  const key = 'PRELOADED_STATE';
  let i = html.indexOf(key);
  if (i < 0) return null;
  i = html.indexOf('{', i);
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(i, j + 1));
    }
  }
  return null;
}

const strip = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const oddValue = (v) => (typeof v === 'number' ? v : v && typeof v === 'object' ? Number(v.value ?? v.odds) : Number(v));

// Reconnaît les marchés que l'appli sait régler automatiquement.
export function classifyBet(title, outcomes, home, away) {
  const t = strip(title);
  if (/mi-temps|1ere|2eme|1re|2e |periode|corner|carton|handicap|buteur|joueur|exact|score|pile|premier|prochain/.test(t))
    return null;
  const h = strip(home), a = strip(away);
  const sel = [];

  if (/^resultat( du match| final)?$/.test(t) || t === '1n2') {
    if (outcomes.length !== 3) return null;
    for (const o of outcomes) {
      const l = strip(o.label);
      let pick = null;
      if (/\bnul\b/.test(l) || l === 'n' || l === 'x') pick = 'X';
      else if (l === h || l === '1') pick = '1';
      else if (l === a || l === '2') pick = '2';
      if (!pick) return null;
      sel.push({ pick, label: pick === 'X' ? 'Match nul' : pick === '1' ? home : away, odds: o.odds });
    }
    if (new Set(sel.map((s) => s.pick)).size !== 3) return null;
    return { kind: '1N2', title: 'Résultat du match', selections: order(sel, ['1', 'X', '2']) };
  }

  if (/double chance/.test(t)) {
    for (const o of outcomes) {
      const l = strip(o.label);
      const nul = /\bnul\b/.test(l);
      const hh = l.includes(h), aa = l.includes(a);
      let pick = null;
      if (hh && nul) pick = '1X';
      else if (aa && nul) pick = 'X2';
      else if (hh && aa) pick = '12';
      if (!pick) return null;
      sel.push({ pick, label: o.label, odds: o.odds });
    }
    return { kind: 'DC', title: 'Double chance', selections: order(sel, ['1X', '12', 'X2']) };
  }

  if (/rembourse|draw no bet|nul rembourse/.test(t)) {
    for (const o of outcomes) {
      const l = strip(o.label);
      const pick = l.includes(h) ? '1' : l.includes(a) ? '2' : null;
      if (!pick) return null;
      sel.push({ pick, label: o.label, odds: o.odds });
    }
    return { kind: 'DNB', title: 'Nul remboursé', selections: order(sel, ['1', '2']) };
  }

  if (/deux equipes marquent|btts/.test(t)) {
    for (const o of outcomes) {
      const l = strip(o.label);
      const pick = l === 'oui' ? 'yes' : l === 'non' ? 'no' : null;
      if (!pick) return null;
      sel.push({ pick, label: o.label, odds: o.odds });
    }
    return { kind: 'BTTS', title: 'Les deux équipes marquent', selections: order(sel, ['yes', 'no']) };
  }

  if (/buts/.test(t) && !/equipe|\b(domicile|exterieur)\b/.test(t) && !h.split(' ').some((w) => w.length > 3 && t.includes(w))) {
    let line = null;
    for (const o of outcomes) {
      const m = strip(o.label).match(/(plus|moins) de ([\d.,]+)/);
      if (!m) return null;
      const l = parseFloat(m[2].replace(',', '.'));
      if (line !== null && l !== line) return null;
      line = l;
      sel.push({ pick: m[1] === 'plus' ? 'over' : 'under', label: o.label, odds: o.odds });
    }
    if (line === null) return null;
    return {
      kind: 'OU',
      line,
      title: `Plus/Moins de ${String(line).replace('.', ',')} buts`,
      selections: order(sel, ['over', 'under']),
    };
  }
  return null;
}

function order(sel, keys) {
  return keys.map((k) => sel.find((s) => s.pick === k)).filter(Boolean);
}

export function parseState(state, now = Date.now()) {
  const matches = state.matches || {};
  const bets = state.bets || {};
  const outcomes = state.outcomes || {};
  const odds = state.odds || {};
  const tournaments = state.tournaments || {};
  const categories = state.categories || {};

  const betsByMatch = new Map();
  for (const b of Object.values(bets)) {
    const mid = b.matchId;
    if (!betsByMatch.has(mid)) betsByMatch.set(mid, []);
    betsByMatch.get(mid).push(b);
  }

  const out = new Map();
  for (const m of Object.values(matches)) {
    if (Number(m.sportId) !== 1) continue;
    const id = String(m.matchId ?? m.id);
    let home = m.competitor1Name ?? m.competitorName1;
    let away = m.competitor2Name ?? m.competitorName2;
    if ((!home || !away) && m.title && m.title.includes(' - ')) [home, away] = m.title.split(' - ');
    if (!home || !away) continue;
    const kickoff = Number(m.matchStart) * 1000;
    if (!kickoff) continue;

    const list = [];
    for (const b of betsByMatch.get(m.matchId ?? m.id) || []) {
      const outs = (b.outcomes || [])
        .map((oid) => ({ label: outcomes[oid]?.label, odds: oddValue(odds[oid]) }))
        .filter((o) => o.label && o.odds > 1);
      if (outs.length !== (b.outcomes || []).length || !outs.length) continue;
      const mk = classifyBet(b.betTitle ?? b.title, outs, home, away);
      if (mk) list.push(mk);
    }
    if (!list.some((x) => x.kind === '1N2')) continue;

    const tour = tournaments[m.tournamentId];
    const cat = categories[m.categoryId];
    out.set(id, {
      id,
      home,
      away,
      kickoff,
      competition: tour?.tournamentName ?? tour?.name ?? 'Football',
      country: cat?.categoryName ?? cat?.name ?? '',
      markets: list,
    });
  }
  return out;
}

async function getHtml(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9', accept: 'text/html' },
  });
  if (!r.ok) throw new Error(`Winamax HTTP ${r.status} sur ${url}`);
  return r.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Liste foot + détail des matchs proches (pour avoir tous les marchés).
export async function scrapeWinamax({ detailLimit = 40, detailHorizonH = 30, log = console.log } = {}) {
  const html = await getHtml(`${BASE}/paris-sportifs/sports/1`);
  const state = extractState(html);
  if (!state) throw new Error('PRELOADED_STATE introuvable (page changée ou accès bloqué)');
  const list = parseState(state);
  if (!list.size)
    throw new Error("Aucun match lu sur Winamax : la page ne contient plus les matchs (chargés après coup par le site). Source de cotes à changer.");
  const now = Date.now();
  const targets = [...list.values()]
    .filter((m) => m.kickoff > now && m.kickoff < now + detailHorizonH * 3600e3)
    .sort((a, b) => a.kickoff - b.kickoff)
    .slice(0, detailLimit);
  for (const m of targets) {
    try {
      await sleep(400);
      const d = extractState(await getHtml(`${BASE}/paris-sportifs/match/${m.id}`));
      const full = d && parseState(d).get(m.id);
      if (full && full.markets.length >= m.markets.length) m.markets = full.markets;
    } catch (e) {
      log(`détail ${m.id}: ${e.message}`);
    }
  }
  return [...list.values()].sort((a, b) => a.kickoff - b.kickoff);
}

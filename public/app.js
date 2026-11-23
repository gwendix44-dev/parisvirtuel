import { settleBet, comboOdds, round2 } from './settle.js';

// ---------- stockage ----------
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('pv_' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pv_' + k, JSON.stringify(v)); } catch {} },
};
const START = 1000;
const S = {
  tab: 'matches', filter: 'all', mode: 'single', stake: '10',
  matches: [], live: {}, expanded: new Set(), meta: {},
  balance: LS.get('balance', START), bets: LS.get('bets', []), slip: LS.get('slip', []),
};
const save = () => { LS.set('balance', S.balance); LS.set('bets', S.bets); LS.set('slip', S.slip); };

// ---------- utilitaires ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => n.toFixed(2).replace('.', ',') + ' €';
const cote = (n) => n.toFixed(2).replace('.', ',');
const fmtTime = (ts) => {
  const d = new Date(ts), n = new Date();
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === n.toDateString()) return hm;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm;
};
const key = (m, mk, sel) => `${m.id}|${mk.kind}|${mk.line ?? ''}|${sel.pick}`;
const bettable = (m) => m.kickoff > Date.now() && (!m.live || m.live.status === 'pending');
const toast = (t) => {
  const el = $('#toast'); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2200);
};

// ---------- ticket ----------
function toggleSel(matchId, kind, line, pick) {
  const m = S.matches.find((x) => x.id === matchId);
  const mk = m?.markets.find((x) => x.kind === kind && String(x.line ?? '') === line);
  const sel = mk?.selections.find((s) => s.pick === pick);
  if (!sel || !bettable(m)) return;
  const k = key(m, mk, sel);
  const i = S.slip.findIndex((s) => s.key === k);
  // une seule sélection par marché et par match
  S.slip = S.slip.filter((s) => !(s.matchId === m.id && s.market === kind && String(s.line ?? '') === line));
  if (i < 0)
    S.slip.push({ key: k, matchId: m.id, home: m.home, away: m.away, kickoff: m.kickoff, market: kind, line: mk.line ?? null,
      pick, label: sel.label, title: mk.title, odds: sel.odds });
  save(); render();
}
const stakeNum = () => Math.max(0, parseFloat(String(S.stake).replace(',', '.')) || 0);
function slipInfo() {
  const n = S.slip.length, st = stakeNum();
  const dup = new Set(S.slip.map((s) => s.matchId)).size < n;
  if (S.mode === 'combo') {
    const o = n ? comboOdds(S.slip) : 0;
    return { total: st, odds: o, gain: round2(st * o), ok: n >= 2 && !dup && st > 0 && st <= S.balance, dup, n };
  }
  const total = round2(st * n);
  const gain = round2(S.slip.reduce((a, s) => a + st * s.odds, 0));
  return { total, odds: null, gain, ok: n >= 1 && st > 0 && total <= S.balance, dup: false, n };
}
function place() {
  const info = slipInfo();
  if (!info.ok) return;
  const st = stakeNum(), now = Date.now();
  const mkLeg = (s) => ({ ...s, status: 'pending' });
  const mk = (legs, stake) => ({ id: now + '-' + Math.random().toString(36).slice(2, 6), placedAt: now, type: legs.length > 1 ? 'combo' : 'single', stake, legs: legs.map(mkLeg), status: 'pending', payout: 0 });
  const created = S.mode === 'combo' ? [mk(S.slip, st)] : S.slip.map((s) => mk([s], st));
  S.bets = [...created, ...S.bets];
  S.balance = round2(S.balance - info.total);
  S.slip = [];
  S.tab = 'bets';
  save(); render(); toast('Pari validé ✓');
}

// ---------- règlement ----------
async function settleAll() {
  const legs = new Map();
  for (const b of S.bets) if (b.status === 'pending') for (const l of b.legs) if (l.status === 'pending') legs.set(l.matchId, { id: l.matchId, home: l.home, away: l.away, kickoff: l.kickoff });
  if (!legs.size) return;
  let data;
  try {
    const r = await fetch('/api/results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ legs: [...legs.values()] }) });
    data = await r.json();
  } catch { return; }
  Object.assign(S.live, data.live || {});
  let changed = false;
  S.bets = S.bets.map((b) => {
    if (b.status !== 'pending') return b;
    const nb = settleBet(b, data.results || {});
    if (nb !== b && JSON.stringify(nb.legs) !== JSON.stringify(b.legs)) changed = true;
    if (nb.status !== 'pending') { S.balance = round2(S.balance + nb.payout); toast(nb.status === 'won' ? `Gagné ! +${eur(nb.payout)}` : nb.status === 'lost' ? 'Pari perdu' : 'Pari remboursé'); }
    return nb;
  });
  if (changed) { save(); render(); }
}

// ---------- données ----------
async function refresh() {
  try {
    const d = await (await fetch('/api/matches')).json();
    S.meta = d;
    S.matches = d.matches.filter((m) => m.live?.status !== 'finished' && m.live?.status !== 'void');
    for (const m of d.matches) if (m.live) S.live[m.id] = m.live;
    // met à jour les cotes du ticket, retire les matchs commencés
    S.slip = S.slip.flatMap((s) => {
      const m = S.matches.find((x) => x.id === s.matchId);
      const mk = m?.markets.find((x) => x.kind === s.market && (x.line ?? null) === s.line);
      const sel = mk?.selections.find((x) => x.pick === s.pick);
      return m && sel && bettable(m) ? [{ ...s, odds: sel.odds }] : [];
    });
    save();
  } catch { S.meta = { error: 'Serveur injoignable' }; }
  await settleAll();
  render();
}

// ---------- rendu ----------
function oddBtn(m, mk, sel, label) {
  const on = S.slip.some((s) => s.key === key(m, mk, sel));
  return `<button class="o ${on ? 'sel' : ''}" ${bettable(m) ? '' : 'disabled'} aria-pressed="${on}" data-a="sel" data-m="${esc(m.id)}" data-k="${mk.kind}" data-l="${mk.line ?? ''}" data-p="${sel.pick}">
    <small>${esc(label)}</small><b>${cote(sel.odds)}</b></button>`;
}
const shortLabel = (m, mk, s) => mk.kind === '1N2' ? (s.pick === 'X' ? 'Nul' : s.pick === '1' ? m.home : m.away) : s.label;
const dayLabel = (ts) => {
  const d = new Date(ts), n = new Date(), tm = new Date(n.getTime() + 86400e3);
  if (d.toDateString() === n.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === tm.toDateString()) return 'Demain';
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
};
const hm = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function renderMatches() {
  const now = new Date();
  let list = S.matches;
  if (S.filter === 'live') list = list.filter((m) => m.live?.status === 'live');
  if (S.filter === 'today') list = list.filter((m) => new Date(m.kickoff).toDateString() === now.toDateString());
  const filters = [['all', 'Tous'], ['live', '<span class="dot"></span>En direct'], ['today', "Aujourd'hui"]]
    .map(([k, l]) => `<button data-a="filter" data-v="${k}" class="${S.filter === k ? 'on' : ''}">${l}</button>`).join('');
  let html = `<div class="filters">${filters}</div>`;
  if (!list.length) return html + `<div class="empty"><b>${S.filter === 'live' ? 'Aucun match en direct' : 'Aucun match à afficher'}</b>${S.filter === 'live' ? 'Les matchs apparaissent ici dès le coup d\'envoi.' : 'Le catalogue se met à jour toutes les 90 secondes.'}</div>`;
  let last = '';
  for (const m of list) {
    const c = m.competition + '|' + m.country;
    if (c !== last) { html += `<div class="comp"><b>${esc(m.competition)}</b><span>${esc(m.country)}</span></div>`; last = c; }
    const lv = m.live?.status === 'live' ? m.live : null;
    const when = lv
      ? `<div class="when is-live">${lv.code === 'HT' ? 'MT' : (lv.minute ?? '') + "'"}<small><span class="pulse"></span>En direct</small></div>`
      : `<div class="when">${hm(m.kickoff)}<small>${dayLabel(m.kickoff)}</small></div>`;
    const main = m.markets.find((x) => x.kind === '1N2');
    const others = m.markets.filter((x) => x !== main);
    const open = S.expanded.has(m.id);
    html += `<article class="match"><div class="mhead">${when}
      <div class="teams"><span>${esc(m.home)}</span><span>${esc(m.away)}</span></div>
      ${lv ? `<div class="score"><span>${lv.home}</span><span>${lv.away}</span></div>` : bettable(m) ? '' : '<span class="closed">Paris fermés</span>'}</div>
      <div class="bar c3">${main.selections.map((s) => oddBtn(m, main, s, shortLabel(m, main, s))).join('')}</div>
      ${others.length ? `<button class="more" data-a="exp" data-m="${esc(m.id)}" aria-expanded="${open}">${open ? 'Masquer les marchés' : `Voir les ${others.length} autres marchés`}</button>` : ''}
      ${open ? others.map((mk) => `<div class="mk"><h4>${esc(mk.title)}</h4><div class="bar c${mk.selections.length === 2 ? 2 : 3}">${mk.selections.map((s) => oddBtn(m, mk, s, shortLabel(m, mk, s))).join('')}</div></div>`).join('') : ''}
    </article>`;
  }
  return html;
}

function renderSlip() {
  if (!S.slip.length) return `<div class="empty"><b>Ton ticket est vide</b>Touche une cote dans l'onglet Matchs pour l'ajouter.</div>`;
  const i = slipInfo();
  const legs = S.slip.map((s) => `<div class="leg"><div><b>${esc(s.label)}</b><span class="q">${cote(s.odds)}</span><div class="t">${esc(s.title)}</div><div class="t">${esc(s.home)} - ${esc(s.away)}</div></div><button class="x" data-a="rm" data-k="${esc(s.key)}" aria-label="Retirer">✕</button></div>`).join('');
  return `<div class="panel">${legs}</div>
  <div class="panel pad">
    <div class="seg"><button data-a="mode" data-v="single" class="${S.mode === 'single' ? 'on' : ''}">Simple</button><button data-a="mode" data-v="combo" class="${S.mode === 'combo' ? 'on' : ''}">Combiné</button></div>
    ${S.mode === 'combo' && S.slip.length < 2 ? '<div class="warn">Un combiné demande au moins 2 sélections.</div>' : ''}
    ${i.dup ? '<div class="warn">Combiné impossible : deux sélections sont du même match.</div>' : ''}
    <div class="stake"><input id="stake" inputmode="decimal" aria-label="Mise" value="${esc(S.stake)}" placeholder="0"><span>€${S.mode === 'single' && S.slip.length > 1 ? ' par pari' : ''}</span></div>
    <div class="quick">${[5, 10, 25, 50].map((v) => `<button data-a="q" data-v="${v}">${v} €</button>`).join('')}<button data-a="q" data-v="max">Max</button></div>
    ${i.odds ? `<div class="row"><span>Cote combinée</span><b>${cote(i.odds)}</b></div>` : ''}
    <div class="row"><span>Mise totale</span><b>${eur(i.total)}</b></div>
    <div class="row"><span>Gain potentiel</span><b class="gain">${eur(i.gain)}</b></div>
    ${i.total > S.balance ? '<div class="warn">Ton solde ne couvre pas cette mise.</div>' : ''}
    <button class="go" data-a="place" ${i.ok ? '' : 'disabled'}>Valider le pari</button>
  </div>`;
}

function renderBets() {
  if (!S.bets.length) return `<div class="empty"><b>Aucun pari pour l'instant</b>Tes paris en cours et terminés apparaîtront ici.</div>`;
  const lbl = { pending: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Remboursé' };
  return S.bets.map((b) => {
    const odds = b.legs.reduce((a, l) => a * l.odds, 1);
    const legs = b.legs.map((l) => {
      const lv = S.live[l.matchId];
      const sc = l.score ? `Final ${l.score}` : lv?.status === 'live' ? `<span class="live-t" style="color:var(--live)">${lv.home}-${lv.away} à ${lv.minute ?? ''}'</span>` : `${dayLabel(l.kickoff)} ${hm(l.kickoff)}`;
      const c = l.status === 'won' ? 'lw' : l.status === 'lost' ? 'll' : l.status === 'void' ? 'lv' : '';
      return `<div class="leg"><div><b>${esc(l.label)}</b><span class="q">${cote(l.odds)}</span><div class="t">${esc(l.title)}</div><div class="t">${esc(l.home)} - ${esc(l.away)}</div></div><div class="res ${c}">${sc}${l.status !== 'pending' ? `<br>${lbl[l.status]}` : ''}</div></div>`;
    }).join('');
    const gain = b.status === 'pending' ? round2(b.stake * odds) : b.payout;
    const foot = b.status === 'pending' ? ['Gain potentiel', eur(gain), ''] : b.status === 'lost' ? ['Mise perdue', '−' + eur(b.stake), ''] : [b.status === 'won' ? 'Gain encaissé' : 'Mise rendue', eur(gain), b.status === 'won' ? 'w' : ''];
    return `<article class="panel bet"><div class="h"><span>${b.type === 'combo' ? `Combiné de ${b.legs.length}, cote ${cote(odds)}` : 'Pari simple'}</span><span class="pill p-${b.status}">${lbl[b.status]}</span></div>${legs}
      <div class="foot"><span>Mise ${eur(b.stake)}<br>${foot[0]}</span><b class="${foot[2]}">${foot[1]}</b></div></article>`;
  }).join('');
}

function render() {
  const y = window.scrollY;
  $('#bal b').textContent = eur(S.balance);
  const nb = $('#slipN'); nb.hidden = !S.slip.length; nb.textContent = S.slip.length;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  const sb = $('#slipbar');
  sb.hidden = !S.slip.length || S.tab !== 'matches';
  if (!sb.hidden) { const i = slipInfo(); sb.innerHTML = `<span>Ticket, ${S.slip.length} sélection${S.slip.length > 1 ? 's' : ''}</span><b>Voir</b>`; }
  const bn = $('#banner');
  const msgs = [];
  if (S.meta.error) msgs.push(S.meta.error);
  if (S.meta.source === 'demo') msgs.push('Mode démo : cotes fictives et scores simulés.');
  else if (S.meta.scoresEnabled === false) msgs.push('Clé API-Football manquante : les scores en direct et le règlement sont désactivés.');
  bn.hidden = !msgs.length; bn.textContent = msgs.join(' ');
  const keep = document.activeElement?.id === 'stake';
  $('#view').innerHTML = S.tab === 'matches' ? renderMatches() : S.tab === 'slip' ? renderSlip() : renderBets();
  if (keep) { const el = $('#stake'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  window.scrollTo(0, y);
}

// ---------- événements ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const a = t.dataset.a;
  if (a === 'sel') toggleSel(t.dataset.m, t.dataset.k, t.dataset.l, t.dataset.p);
  else if (a === 'exp') { S.expanded.has(t.dataset.m) ? S.expanded.delete(t.dataset.m) : S.expanded.add(t.dataset.m); render(); }
  else if (a === 'filter') { S.filter = t.dataset.v; render(); }
  else if (a === 'rm') { S.slip = S.slip.filter((s) => s.key !== t.dataset.k); save(); render(); }
  else if (a === 'mode') { S.mode = t.dataset.v; render(); }
  else if (a === 'q') { S.stake = t.dataset.v === 'max' ? String(Math.floor(S.balance)) : t.dataset.v; render(); }
  else if (a === 'place') place();
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'stake') return;
  S.stake = e.target.value;
  render();
});
$('#bal').addEventListener('click', () => (S.tab = 'bets', render()));
$('#slipbar').addEventListener('click', () => { S.tab = 'slip'; render(); window.scrollTo(0, 0); });
$('#menu').addEventListener('click', () => {
  const s = document.createElement('div');
  s.className = 'sheet';
  s.innerHTML = `<div><b>Menu</b><button data-x="top">Ajouter 1 000 € virtuels</button><button data-x="reset" class="danger">Tout réinitialiser</button><button data-x="close">Fermer</button></div>`;
  s.addEventListener('click', (e) => {
    const x = e.target.dataset?.x;
    if (e.target === s || x === 'close') return s.remove();
    if (x === 'top') { S.balance = round2(S.balance + 1000); save(); render(); toast('+1 000 € ajoutés'); s.remove(); }
    if (x === 'reset' && confirm('Effacer solde, ticket et historique de paris ?')) { S.balance = START; S.bets = []; S.slip = []; save(); render(); s.remove(); }
  });
  document.body.appendChild(s);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
refresh();
setInterval(refresh, 30000);

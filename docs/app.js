import { createWorld, teamForm, slotOf, matchesOfSlot, matchById, marketsOf, liveState, resultOf, simulate, tableAt, slotStart, SLOT_MS, BETTING_AHEAD, VERSION } from './sim.js';
import { settleBet, comboOdds, round2 } from './settle.js';

// ---------- horloge (le paramètre ?speed=N accélère le temps, pour tester) ----------
const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);
const T0 = Date.now();
const now = () => T0 + (Date.now() - T0) * SPEED;

// ---------- stockage ----------
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('pv_' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pv_' + k, JSON.stringify(v)); } catch {} },
};
const START = 100, REFILL_MS = 24 * 3600e3;
if (LS.get('ver', 0) !== 2) { for (const k of ['balance', 'bets', 'slip', 'broke']) localStorage.removeItem('pv_' + k); LS.set('ver', 2); }
const S = {
  tab: 'matches', filter: 'all', league: 'all', mode: 'single', stake: '10',
  world: null, detail: null, dtab: 'bets', open: new Set(['1N2']), sig: '',
  balance: LS.get('balance', START), broke: LS.get('broke', null), bets: LS.get('bets', []), slip: LS.get('slip', []),
};
const save = () => { LS.set('balance', S.balance); LS.set('bets', S.bets); LS.set('slip', S.slip); LS.set('broke', S.broke); };

// ---------- utilitaires ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => n.toFixed(2).replace('.', ',') + ' €';
const cote = (n) => n.toFixed(2).replace('.', ',');
const hm = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2400); };
const TEAM = (id) => S.world.teams[id];
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const logo = (id, cls = '') => { const t = TEAM(id); return `<img class="logo ${cls}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`; };
const face = (p, cls = '') => `<span class="face ${cls}"><b>${esc(initials(p.name))}</b>${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
const playerOf = (teamId, pid) => TEAM(teamId).players.find((p) => p.id === pid);
const phaseLabel = (lv) => lv.phase === 'ht' ? 'Mi-temps' : lv.phase === 'ft' ? 'Terminé' : `${lv.minute}${lv.extra ? '+' + lv.extra : ''}'`;
const minLabel = (e) => `${e.min}${e.extra ? '+' + e.extra : ''}'`;
const bettable = (m) => now() < m.kickoff;
const pending = (b) => b.status === 'pending';

// ---------- ticket ----------
const keyOf = (mid, kind, line, pick) => `${mid}|${kind}|${line ?? ''}|${pick}`;
function toggleSel(mid, kind, line, pick) {
  const m = matchById(S.world, mid);
  if (!m || !bettable(m)) return;
  const mk = marketsOf(S.world, m).find((x) => x.kind === kind && String(x.line ?? '') === line);
  const sel = mk?.selections.find((s) => s.pick === pick);
  if (!sel) return;
  const k = keyOf(mid, kind, mk.line, pick);
  const had = S.slip.some((s) => s.key === k);
  S.slip = S.slip.filter((s) => !(s.matchId === mid && s.market === kind && String(s.line ?? '') === line));
  if (!had) S.slip.push({ key: k, matchId: mid, home: TEAM(m.home).short, away: TEAM(m.away).short, kickoff: m.kickoff, market: kind, line: mk.line ?? null, pick, label: sel.label, title: mk.title, odds: sel.odds, wv: VERSION });
  save(); renderAll();
}
const stakeNum = () => Math.max(0, parseFloat(String(S.stake).replace(',', '.')) || 0);
function slipInfo() {
  // un seul ticket : 1 sélection = pari simple, 2 ou plus = combiné (une seule mise, cotes multipliées)
  const n = S.slip.length, st = stakeNum();
  const dup = new Set(S.slip.map((s) => s.matchId)).size < n;
  const odds = n ? comboOdds(S.slip) : 0;
  return { total: st, odds, gain: round2(st * odds), ok: n >= 1 && !dup && st > 0 && st <= S.balance, dup };
}
function place() {
  const info = slipInfo();
  if (!info.ok) return;
  const st = stakeNum(), t = now();
  const bet = { id: t + '-' + Math.random().toString(36).slice(2, 6), placedAt: t, type: S.slip.length > 1 ? 'combo' : 'single', stake: st, legs: S.slip.map((l) => ({ ...l, status: 'pending' })), status: 'pending', payout: 0 };
  S.bets = [bet, ...S.bets];
  S.balance = round2(S.balance - st);
  S.slip = []; S.tab = 'bets'; S.detail = null;
  save(); renderAll(); toast('Ticket validé');
}

// ---------- règlement (calculé sur place, identique sur tous les téléphones) ----------
function settleAll() {
  const t = now(), results = {};
  let changed = false;
  S.bets = S.bets.map((b) => {
    if (!pending(b)) return b;
    for (const l of b.legs) {
      if (l.status !== 'pending' || results[l.matchId]) continue;
      if (l.wv !== VERSION) { results[l.matchId] = { status: 'void' }; continue; }
      const m = matchById(S.world, l.matchId);
      const r = m && resultOf(S.world, m, t);
      if (r) results[l.matchId] = r;
    }
    const nb = settleBet(b, results);
    if (JSON.stringify(nb.legs) !== JSON.stringify(b.legs)) changed = true;
    if (nb.status !== 'pending') {
      S.balance = round2(S.balance + nb.payout);
      toast(nb.status === 'won' ? `Gagné ! +${eur(nb.payout)}` : nb.status === 'lost' ? 'Pari perdu' : 'Pari remboursé');
    }
    return nb;
  });
  const t2 = now();
  if (S.balance < 0.01 && !S.bets.some(pending)) {
    if (!S.broke) { S.broke = t2; changed = true; }
    else if (t2 - S.broke >= REFILL_MS) { S.balance = START; S.broke = null; changed = true; toast('+100 € : nouveau dépôt'); }
  } else if (S.broke) { S.broke = null; changed = true; }
  if (changed) { save(); $('#bal b').textContent = eur(S.balance); }
  return changed;
}

// ---------- rendu : liste des matchs ----------
function oddBtn(m, mk, sel, label, extra = '') {
  const on = S.slip.some((s) => s.key === keyOf(m.id, mk.kind, mk.line, sel.pick));
  return `<button class="o ${on ? 'sel' : ''}" ${bettable(m) ? '' : 'disabled'} aria-pressed="${on}" data-a="sel" data-m="${m.id}" data-k="${mk.kind}" data-l="${mk.line ?? ''}" data-p="${esc(sel.pick)}">${extra}<small>${esc(label)}</small><b>${cote(sel.odds)}</b></button>`;
}
const whenHtml = (m) => {
  const t = now(), lv = liveState(S.world, m, t);
  if (lv.phase === 'pre') { const s = Math.ceil(lv.startsIn / 1000); return `<div class="when">${hm(m.kickoff)}<small>${s >= 90 ? 'dans ' + Math.round(s / 60) + ' min' : 'dans ' + s + ' s'}</small></div>`; }
  if (lv.phase === 'ft') return `<div class="when ft">Fin<small>Terminé</small></div>`;
  return `<div class="when is-live">${lv.phase === 'ht' ? 'MT' : phaseLabel(lv)}<small><span class="pulse"></span>En direct</small></div>`;
};
const scoreHtml = (m) => { const lv = liveState(S.world, m, now()); return lv.phase === 'pre' ? '' : `<span>${lv.home}</span><span>${lv.away}</span>`; };

function matchCard(m) {
  const mk = marketsOf(S.world, m), main = mk[0], h = TEAM(m.home), a = TEAM(m.away);
  return `<article class="match" data-mid="${m.id}">
    <div class="mhead" data-a="detail" data-m="${m.id}">
      <div class="whenc">${whenHtml(m)}</div>
      <div class="teams"><span>${logo(m.home)}${esc(h.short)}</span><span>${logo(m.away)}${esc(a.short)}</span></div>
      <div class="score">${scoreHtml(m)}</div>
    </div>
    <div class="bar c3">${main.selections.map((s) => oddBtn(m, main, s, s.pick === 'X' ? 'Nul' : s.pick === '1' ? h.short : a.short)).join('')}</div>
    <button class="more" data-a="detail" data-m="${m.id}">${mk.length - 1} autres paris et stats</button>
  </article>`;
}

function slotBlocks() {
  const k0 = slotOf(now());
  let ks;
  if (S.filter === 'live') ks = [k0];
  else if (S.filter === 'results') ks = [k0 - 1, k0 - 2, k0 - 3, k0 - 4, k0 - 5, k0 - 6];
  else ks = Array.from({ length: BETTING_AHEAD + 1 }, (_, i) => k0 + i);
  const out = [];
  for (const k of ks) {
    let ms = matchesOfSlot(S.world, k);
    if (S.league !== 'all' && ms[0].leagueId !== S.league) continue;
    out.push({ k, ms });
  }
  return out;
}

function renderMatches() {
  const k0 = slotOf(now());
  const chips = [['all', 'Tous'], ...S.world.groups.map((g) => [g.id, g.name])]
    .map(([id, n]) => `<button data-a="league" data-v="${id}" class="${S.league === id ? 'on' : ''}">${esc(n)}</button>`).join('');
  const filters = [['all', 'À venir'], ['live', '<span class="dot"></span>En direct'], ['results', 'Résultats']]
    .map(([k, l]) => `<button data-a="filter" data-v="${k}" class="${S.filter === k ? 'on' : ''}">${l}</button>`).join('');
  let html = `<div class="filters">${filters}</div><div class="filters sub">${chips}</div>`;
  const blocks = slotBlocks();
  if (!blocks.length) html += `<div class="empty"><b>Aucun match pour ce choix</b>Chaque championnat joue une journée toutes les 3 heures.</div>`;
  for (const { k, ms } of blocks) {
    const g = ms[0];
    const status = k < k0 ? 'Terminée' : k === k0 ? 'En direct' : 'Coup d\'envoi ' + hm(slotStart(k));
    html += `<div class="comp"><b>${esc(g.league)}</b><span>Journée ${g.round + 1}</span><em class="${k === k0 ? 'live' : ''}">${status}</em></div>` + ms.map(matchCard).join('');
  }
  return html;
}

// ---------- rendu : détail d'un match ----------
function detailHeader(m) {
  const lv = liveState(S.world, m, now()), h = TEAM(m.home), a = TEAM(m.away);
  const mid = lv.phase === 'pre' ? `<div class="vs">${hm(m.kickoff)}</div>` : `<div class="vs big">${lv.home} - ${lv.away}</div>`;
  const st = lv.phase === 'pre' ? `Coup d'envoi dans ${Math.max(1, Math.ceil(lv.startsIn / 60000))} min` : lv.phase === 'ft' ? 'Terminé' : lv.phase === 'ht' ? 'Mi-temps' : `${phaseLabel(lv)} en direct`;
  return `<div class="dteam">${logo(m.home, 'lg')}<span>${esc(h.short)}</span></div><div class="dmid">${mid}<small class="${lv.phase === 'pre' || lv.phase === 'ft' ? '' : 'live'}">${st}</small></div><div class="dteam">${logo(m.away, 'lg')}<span>${esc(a.short)}</span></div>`;
}
function marketBlock(m, mk) {
  const open = S.open.has(mk.kind + (mk.line ?? ''));
  const player = mk.kind === 'ANY' || mk.kind === 'FIRST';
  let body = '';
  if (open) {
    if (player) {
      body = `<div class="plist">${mk.selections.map((s) => {
        const p = s.team ? playerOf(s.team, s.pick) : null;
        const on = S.slip.some((x) => x.key === keyOf(m.id, mk.kind, mk.line, s.pick));
        return `<button class="prow ${on ? 'sel' : ''}" ${bettable(m) ? '' : 'disabled'} data-a="sel" data-m="${m.id}" data-k="${mk.kind}" data-l="${mk.line ?? ''}" data-p="${esc(s.pick)}">${p ? face(p) : '<span class="face"><b>-</b></span>'}<span class="pn">${esc(s.label)}<small>${s.team ? esc(TEAM(s.team).short) : ''}</small></span><b>${cote(s.odds)}</b></button>`;
      }).join('')}</div>`;
    } else {
      const cols = mk.kind === 'CS' ? 3 : mk.selections.length === 2 ? 2 : 3;
      body = `<div class="bar c${cols}">${mk.selections.map((s) => oddBtn(m, mk, s, s.label)).join('')}</div>`;
    }
  }
  return `<section class="mkt"><button class="mh" data-a="mkt" data-v="${mk.kind}${mk.line ?? ''}"><span>${esc(mk.title)}</span><i>${open ? '−' : '+'}</i></button>${body}</section>`;
}
function eventsHtml(m) {
  const lv = liveState(S.world, m, now());
  if (lv.phase === 'pre') return `<div class="empty"><b>Le match n'a pas commencé</b>Les buts et les cartons apparaissent ici en direct.</div>`;
  const rows = [...(lv.events || [])].reverse().map((e) => {
    const t = TEAM(m[e.side]), p = playerOf(t.id, e.player), as = e.assist ? playerOf(t.id, e.assist) : null;
    const icon = e.type === 'goal' ? '<span class="ball"></span>' : '<span class="ycard"></span>';
    return `<div class="ev ${e.side}"><span class="mn">${minLabel(e)}</span>${icon}${face(p, 'sm')}<span class="pn">${esc(p.name)}<small>${e.type === 'goal' ? (as ? 'passe de ' + esc(as.name) : 'but') : 'carton jaune'} · ${esc(t.short)}</small></span></div>`;
  });
  return rows.length ? `<div class="evs">${rows.join('')}</div>` : `<div class="empty"><b>Rien à signaler</b>Aucun but ni carton pour l'instant.</div>`;
}
const dots = (f) => f.seq.length ? f.seq.map((x) => `<i class="fm f${x}">${x}</i>`).join('') : '<small class="muted">Début de saison</small>';
const lvl = (v) => v >= 1.25 ? 'Très fort' : v >= 1.05 ? 'Solide' : v >= 0.9 ? 'Moyen' : 'Fragile';
function profile(t, f) {
  const att = t.att, dfn = 1 / t.def;
  return `<div class="prof"><div class="ph">${logo(t.id)}<b>${esc(t.name)}</b></div>
    <div class="pr"><span>Forme (5 derniers)</span><div class="fms">${dots(f)}</div></div>
    <div class="pr"><span>Attaque</span><b>${lvl(att)}</b></div><div class="pr"><span>Défense</span><b>${lvl(dfn)}</b></div></div>`;
}
function statsHtml(m) {
  const h = TEAM(m.home), a = TEAM(m.away);
  const row = (lbl, x, y) => `<div class="srow"><b>${x}</b><span>${lbl}</span><b>${y}</b></div>`;
  const pg = (t, k) => (t.gp ? (t[k] / t.gp).toFixed(2).replace('.', ',') : '-');
  const top = (t) => [...t.players].sort((p, q) => q.goals - p.goals).slice(0, 3).filter((p) => p.goals > 0);
  const tops = (t) => top(t).map((p) => `<div class="tp">${face(p, 'sm')}<span class="pn">${esc(p.name)}<small>${p.goals} but${p.goals > 1 ? 's' : ''} en ${p.apps} match${p.apps > 1 ? 's' : ''}</small></span></div>`).join('') || '<small class="muted">Pas de buteur</small>';
  const tb = tableAt(S.world, m.g, m.season, m.round);
  const mine = (id) => id === m.home || id === m.away;
  const fh = teamForm(S.world, m.home, m.g, m.season, m.round), fa = teamForm(S.world, m.away, m.g, m.season, m.round);
  return `<div class="panel pad two">${profile(h, fh)}${profile(a, fa)}</div><div class="panel pad"><div class="shead">${logo(m.home)}<span>Stats réelles de la saison</span>${logo(m.away)}</div>
    ${row('Classement', '#' + h.rank, '#' + a.rank)}${row('Points', h.pts, a.pts)}${row('Matchs joués', h.gp, a.gp)}
    ${row('Buts marqués / match', pg(h, 'gf'), pg(a, 'gf'))}${row('Buts encaissés / match', pg(h, 'ga'), pg(a, 'ga'))}
    ${row('Bilan V-N-D', `${h.w}-${h.d}-${h.l}`, `${a.w}-${a.d}-${a.l}`)}</div>
  <div class="panel pad two"><div><h4>Buteurs ${esc(h.short)}</h4>${tops(h)}</div><div><h4>Buteurs ${esc(a.short)}</h4>${tops(a)}</div></div>
  <div class="panel pad"><div class="shead"><span>Classement ${esc(m.league)} (saison virtuelle)</span></div>
    ${m.round === 0 ? '<small class="muted">La saison commence avec cette journée.</small>' : `<div class="tbl">${tb.slice(0, 20).map((r) => `<div class="tr ${mine(r.id) ? 'me' : ''}"><i>${r.rank}</i>${logo(r.id, 'xs')}<span>${esc(TEAM(r.id).short)}</span><em>${r.p}</em><em>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</em><b>${r.pts}</b></div>`).join('')}</div>`}</div>`;
}
function renderDetailBody(m) {
  if (S.dtab === 'live') return eventsHtml(m);
  if (S.dtab === 'stats') return statsHtml(m);
  return marketsOf(S.world, m).map((mk) => marketBlock(m, mk)).join('');
}
function renderDetail() {
  const el = $('#detail');
  const m = S.detail && matchById(S.world, S.detail);
  el.hidden = !m;
  if (!m) { el.innerHTML = ''; return; }
  const tabs = [['bets', 'Paris'], ['live', 'Direct'], ['stats', 'Stats']].map(([k, l]) => `<button data-a="dtab" data-v="${k}" class="${S.dtab === k ? 'on' : ''}">${l}</button>`).join('');
  el.innerHTML = `<div class="dtop"><button class="back" data-a="close" aria-label="Retour">‹</button><span>${esc(m.league)}, journée ${m.round + 1}</span></div>
    <div class="dhead" id="dh">${detailHeader(m)}</div><div class="seg dseg">${tabs}</div><div class="dbody" id="dbody">${renderDetailBody(m)}</div>
    ${S.slip.length ? `<button class="dslip" data-a="goslip"><span>Ticket, ${S.slip.length} sélection${S.slip.length > 1 ? 's' : ''}</span><b>Voir</b></button>` : ''}`;
}

// ---------- rendu : ticket et paris ----------
function renderSlip() {
  if (!S.slip.length) return `<div class="empty"><b>Ton ticket est vide</b>Touche une cote dans l'onglet Matchs pour l'ajouter.</div>`;
  const i = slipInfo();
  const legs = S.slip.map((s) => `<div class="leg"><div><b>${esc(s.label)}</b><span class="q">${cote(s.odds)}</span><div class="t">${esc(s.title)}</div><div class="t">${esc(s.home)} - ${esc(s.away)}, ${hm(s.kickoff)}</div></div><button class="x" data-a="rm" data-k="${esc(s.key)}" aria-label="Retirer">✕</button></div>`).join('');
  const n = S.slip.length;
  return `<div class="panel"><div class="h tk"><b>${n > 1 ? `Combiné de ${n} sélections` : 'Pari simple'}</b></div>${legs}</div>
  <div class="panel pad">
    ${i.dup ? '<div class="warn">Deux sélections du même match : retire-en une pour valider.</div>' : ''}
    ${n > 1 ? '<div class="note">Une seule mise pour tout le ticket. Si une sélection est perdue, tout le ticket est perdu.</div>' : ''}
    <div class="stake"><input id="stake" inputmode="decimal" aria-label="Mise" value="${esc(S.stake)}" placeholder="0"><span>€</span></div>
    <div class="quick">${[5, 10, 20, 50].map((v) => `<button data-a="q" data-v="${v}">${v} €</button>`).join('')}<button data-a="q" data-v="max">Max</button></div>
    <div class="row"><span>Cote totale</span><b>${cote(i.odds)}</b></div>
    <div class="row"><span>Mise</span><b>${eur(i.total)}</b></div>
    <div class="row"><span>Gain potentiel</span><b class="gain">${eur(i.gain)}</b></div>
    ${i.total > S.balance ? '<div class="warn">Ton solde ne couvre pas cette mise.</div>' : ''}
    <button class="go" data-a="place" ${i.ok ? '' : 'disabled'}>Valider le ticket</button>
  </div>`;
}
function renderBets() {
  if (!S.bets.length) return `<div class="empty"><b>Aucun pari pour l'instant</b>Tes paris en cours et terminés apparaîtront ici.</div>`;
  const lbl = { pending: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Remboursé' };
  return S.bets.map((b) => {
    const odds = comboOdds(b.legs);
    const legs = b.legs.map((l) => {
      const m = matchById(S.world, l.matchId);
      const lv = m && liveState(S.world, m, now());
      const sc = l.score ? `Final ${l.score}` : lv?.phase === 'ft' ? `${lv.home}-${lv.away}` : lv && lv.phase !== 'pre' ? `<span style="color:var(--live)">${lv.home}-${lv.away} ${phaseLabel(lv)}</span>` : `${hm(l.kickoff)}`;
      const c = l.status === 'won' ? 'lw' : l.status === 'lost' ? 'll' : l.status === 'void' ? 'lv' : '';
      return `<div class="leg"><div><b>${esc(l.label)}</b><span class="q">${cote(l.odds)}</span><div class="t">${esc(l.title)}</div><div class="t">${esc(l.home)} - ${esc(l.away)}</div></div><div class="res ${c}">${sc}${l.status !== 'pending' ? `<br>${lbl[l.status]}` : ''}</div></div>`;
    }).join('');
    const gain = pending(b) ? round2(b.stake * odds) : b.payout;
    const foot = pending(b) ? ['Gain potentiel', eur(gain), ''] : b.status === 'lost' ? ['Mise perdue', '−' + eur(b.stake), ''] : [b.status === 'won' ? 'Gain encaissé' : 'Mise rendue', eur(gain), b.status === 'won' ? 'w' : ''];
    return `<article class="panel bet"><div class="h"><span>${b.type === 'combo' ? `Combiné de ${b.legs.length}, cote ${cote(odds)}` : 'Pari simple'}</span><span class="pill p-${b.status}">${lbl[b.status]}</span></div>${legs}
      <div class="foot"><span>Mise ${eur(b.stake)}<br>${foot[0]}</span><b class="${foot[2]}">${foot[1]}</b></div></article>`;
  }).join('');
}

// ---------- rendu global ----------
function renderAll() {
  if (!S.world) return;
  const y = window.scrollY;
  $('#bal b').textContent = eur(S.balance);
  const nb = $('#slipN'); nb.hidden = !S.slip.length; nb.textContent = S.slip.length;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  const sb = $('#slipbar');
  sb.hidden = !S.slip.length || S.tab !== 'matches' || !!S.detail;
  if (!sb.hidden) sb.innerHTML = `<span>Ticket, ${S.slip.length} sélection${S.slip.length > 1 ? 's' : ''}</span><b>Voir</b>`;
  const bn = $('#banner');
  const left = S.broke ? Math.max(0, REFILL_MS - (now() - S.broke)) : 0;
  bn.hidden = SPEED === 1 && !S.broke;
  bn.textContent = S.broke ? `Solde épuisé : nouveau dépôt de 100 € dans ${Math.floor(left / 3600e3)} h ${String(Math.ceil((left % 3600e3) / 60e3) % 60).padStart(2, '0')} min.` : `Mode accéléré ×${SPEED} (test).`;
  const keep = document.activeElement?.id === 'stake';
  $('#view').innerHTML = S.tab === 'matches' ? renderMatches() : S.tab === 'slip' ? renderSlip() : renderBets();
  S.sig = sigNow();
  renderDetail();
  if (keep) { const el = $('#stake'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  window.scrollTo(0, y);
}
const sigNow = () => [slotOf(now()), S.tab, S.filter, S.league].join('|');

// mise à jour légère chaque seconde (n'écrase pas les boutons pendant un appui)
let lastEv = '';
function tick() {
  if (!S.world) return;
  const changed = settleAll();
  if (S.broke) { const bn = $('#banner'); const left = Math.max(0, REFILL_MS - (now() - S.broke)); bn.hidden = false; bn.textContent = `Solde épuisé : nouveau dépôt de 100 € dans ${Math.floor(left / 3600e3)} h ${String(Math.ceil((left % 3600e3) / 60e3) % 60).padStart(2, '0')} min.`; }
  if (sigNow() !== S.sig || (changed && S.tab !== 'matches')) { renderAll(); return; }
  if (S.tab === 'matches') {
    document.querySelectorAll('.match').forEach((el) => {
      const m = matchById(S.world, el.dataset.mid); if (!m) return;
      const w = el.querySelector('.whenc'), sc = el.querySelector('.score');
      const wh = whenHtml(m), sh = scoreHtml(m);
      if (w.innerHTML !== wh) w.innerHTML = wh;
      if (sc.innerHTML !== sh) sc.innerHTML = sh;
    });
  } else if (S.tab === 'bets') { const v = $('#view'); const h = renderBets(); if (v.innerHTML !== h && !document.querySelector(':active')) v.innerHTML = h; }
  const m = S.detail && matchById(S.world, S.detail);
  if (m) {
    const dh = $('#dh'), h = detailHeader(m); if (dh && dh.innerHTML !== h) dh.innerHTML = h;
    if (S.dtab === 'live') { const e = eventsHtml(m); if (e !== lastEv) { lastEv = e; $('#dbody').innerHTML = e; } }
  }
}

// ---------- événements ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.detail = null; renderAll(); window.scrollTo(0, 0); return; }
  const a = t.dataset.a;
  if (a === 'sel') { toggleSel(t.dataset.m, t.dataset.k, t.dataset.l, t.dataset.p); if (S.detail) $('#dbody').innerHTML = renderDetailBody(matchById(S.world, S.detail)); }
  else if (a === 'detail') { S.detail = t.dataset.m; S.dtab = 'bets'; renderDetail(); $('#detail').scrollTop = 0; }
  else if (a === 'close') { S.detail = null; renderAll(); }
  else if (a === 'dtab') { S.dtab = t.dataset.v; lastEv = ''; renderDetail(); }
  else if (a === 'mkt') { const v = t.dataset.v; S.open.has(v) ? S.open.delete(v) : S.open.add(v); $('#dbody').innerHTML = renderDetailBody(matchById(S.world, S.detail)); }
  else if (a === 'goslip') { S.detail = null; S.tab = 'slip'; renderAll(); window.scrollTo(0, 0); }
  else if (a === 'filter') { S.filter = t.dataset.v; renderAll(); }
  else if (a === 'league') { S.league = t.dataset.v; renderAll(); }
  else if (a === 'rm') { S.slip = S.slip.filter((s) => s.key !== t.dataset.k); save(); renderAll(); }
  else if (a === 'q') { S.stake = t.dataset.v === 'max' ? String(Math.floor(S.balance * 100) / 100) : t.dataset.v; renderAll(); }
  else if (a === 'place') place();
});
document.addEventListener('input', (e) => { if (e.target.id === 'stake') { S.stake = e.target.value; renderAll(); } });
$('#bal').addEventListener('click', () => { S.tab = 'bets'; S.detail = null; renderAll(); });
$('#slipbar').addEventListener('click', () => { S.tab = 'slip'; renderAll(); window.scrollTo(0, 0); });
$('#menu').addEventListener('click', () => {
  const s = document.createElement('div');
  s.className = 'sheet';
  s.innerHTML = `<div><b>Règles</b><p>Dépôt de départ : 100 € fictifs. Si tu dépenses tout et qu'aucun pari n'est en cours, 100 € te sont rendus 24 h plus tard.</p><p>Un match dure 30 minutes. Les résultats viennent d'une simulation basée sur les vraies stats et la forme des équipes.</p><button data-x="close">Fermer</button></div>`;
  s.addEventListener('click', (e) => { if (e.target === s || e.target.dataset?.x === 'close') s.remove(); });
  document.body.appendChild(s);
});

// ---------- démarrage ----------
(async () => {
  try {
    const raw = await (await fetch('data/world.json')).json();
    S.world = createWorld(raw);
    // retire du ticket les sélections dont le match a commencé
    S.slip = S.slip.filter((s) => s.wv === VERSION && now() < s.kickoff);
    renderAll();
    setInterval(tick, 1000);
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><b>Données indisponibles</b>${esc(e.message)}</div>`;
  }
})();
if ('serviceWorker' in navigator && SPEED === 1) navigator.serviceWorker.register('sw.js').catch(() => {});

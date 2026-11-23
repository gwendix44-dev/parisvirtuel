import { scrapeWinamax } from './winamax.js';
import { pollScores, demoState } from './scores.js';
import { demoMatches } from './demo.js';

// prev : état précédent (ou null). Retourne le nouvel état complet.
export async function update(prev, { demo = false, scrapeEvery = 0, log = console.log } = {}) {
  const now = Date.now();
  const s = {
    matches: prev?.matches || [],
    tracked: prev?.tracked || {},
    updatedAt: prev?.updatedAt || null,
    error: null,
    source: demo ? 'demo' : 'winamax',
  };

  // 1. cotes
  if (!s.updatedAt || now - s.updatedAt >= scrapeEvery) {
    try {
      s.matches = demo ? (s.matches.length ? s.matches : demoMatches()) : await scrapeWinamax({ log });
      s.updatedAt = now;
      for (const m of s.matches) {
        const t = (s.tracked[m.id] ||= { id: m.id });
        Object.assign(t, { home: m.home, away: m.away, kickoff: m.kickoff });
        if (m.demoGoals) t.demoGoals = m.demoGoals;
      }
      log(`catalogue : ${s.matches.length} matchs`);
    } catch (e) {
      s.error = 'Cotes : ' + e.message;
      log('ERREUR cotes :', e.message);
    }
  }

  // 2. scores
  try {
    if (demo) {
      for (const t of Object.values(s.tracked)) {
        if (t.result || !t.demoGoals) continue;
        t.live = demoState(t, now);
        if (t.live.status === 'finished') t.result = t.live;
      }
    } else {
      const calls = await pollScores(s.tracked, { now, log });
      if (calls) log(`scores : ${calls} appel(s) ESPN`);
    }
  } catch (e) {
    s.error = (s.error ? s.error + ' ' : '') + 'Scores : ' + e.message;
    log('ERREUR scores :', e.message);
  }

  // 3. ménage : on garde 5 jours
  for (const [id, t] of Object.entries(s.tracked)) if (t.kickoff < now - 5 * 86400e3) delete s.tracked[id];
  s.checkedAt = now;
  return s;
}

// Version publiée (lue par l'appli sur le téléphone).
export function publish(s) {
  const tracked = {};
  for (const [id, { demoGoals, ...t }] of Object.entries(s.tracked)) tracked[id] = t;
  return {
    updatedAt: s.updatedAt,
    checkedAt: s.checkedAt,
    source: s.source,
    error: s.error,
    matches: s.matches.map(({ demoGoals, ...m }) => m),
    tracked,
  };
}

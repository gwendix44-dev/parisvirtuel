# ParisVirtuel

Clone de Winamax Sport en argent virtuel (1 000 € au départ). Football uniquement.

## Lancer

```bash
npm install
npm run demo                      # cotes fictives + scores simulés, sans clé
API_FOOTBALL_KEY=xxx npm start    # vraies cotes Winamax + scores API-Football
```

Ouvre http://localhost:3000, puis « Ajouter à l'écran d'accueil » pour l'installer.
Pour l'utiliser sur téléphone, héberge le serveur (VPS, Railway, Fly...) : le scraping doit tourner côté serveur.

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `API_FOOTBALL_KEY` | — | Clé api-sports.io (scores et règlement) |
| `ODDS_INTERVAL_S` | 90 | Fréquence de rafraîchissement des cotes |
| `LIVE_INTERVAL_S` | 300 | Fréquence des scores quand un match est en cours |
| `IDLE_INTERVAL_S` | 3600 | Fréquence des scores sinon |
| `PORT` | 3000 | Port |

## Fonctionnement

- `src/winamax.js` lit le `PRELOADED_STATE` des pages winamax.fr (liste foot, puis détail des ~40 matchs des 30 prochaines heures).
- `src/livescores.js` interroge API-Football par date et associe chaque match Winamax à un fixture (heure ±20 min + similarité des noms d'équipes).
- `server.js` garde tous les matchs vus dans `data/tracked.json` pour régler les paris même quand Winamax retire le match.
- Le front stocke solde et paris dans le `localStorage` et règle les paris via `/api/results`.

## Vérifier les vrais matchs

`node test/check-live.js` (avec `API_FOOTBALL_KEY` pour tester aussi l'association des scores) liste les matchs lus sur Winamax avec l'heure de Paris : compare avec winamax.fr.

## Marchés gérés (réglés automatiquement)

Résultat 1N2, double chance, nul remboursé, les deux équipes marquent, plus/moins de buts. Les autres marchés (buteur, mi-temps, handicap, corners...) sont ignorés en V1.

## Limites connues

- Paris uniquement avant le coup d'envoi (pas de paris live ni de cash out).
- Le format de Winamax peut changer sans préavis : `parseState` est à ajuster si `/api/health` affiche une erreur.
- Winamax peut bloquer les requêtes automatisées (403). Le scraping est contraire à ses CGU.
- Vérifie que ton plan API-Football couvre la saison en cours et le quota (un appel par date et par cycle).
- Règlement sur le score à 90 min (hors prolongation et tirs au but).

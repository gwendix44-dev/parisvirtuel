# ParisVirtuel

Appli de paris sportifs en argent virtuel (1 000 € au départ), football uniquement, installable sur téléphone (PWA).

## Fonctionnement (tout sur GitHub, sans serveur ni compte supplémentaire)

- `docs/` : l'appli, publiée par GitHub Pages.
- `.github/workflows/update.yml` : toutes les ~5 minutes, lance `scripts/update.js` qui met à jour `docs/data/state.json` (cotes + scores) puis redéploie la page.
- Scores en direct et résultats : API publique d'ESPN (sans clé, non officielle).
- Les paris et le solde sont stockés sur le téléphone ; le règlement se fait dans l'appli à partir des résultats publiés.

## Source des cotes : à finaliser

Le scraper `src/winamax.js` suppose que la page winamax.fr embarque les matchs. Vérification faite : ce n'est PAS le cas
(la page ne contient qu'une coquille, les matchs arrivent par une connexion temps réel). En mode réel, l'appli affiche donc
une erreur explicite au lieu de matchs. Il faut brancher une autre source de cotes dans `src/winamax.js` (fonction `scrapeWinamax`,
qui doit retourner une liste de matchs `{id, home, away, kickoff, competition, country, markets}`).

## Tester en local

```
npm install
npm run demo      # cotes fictives + scores simulés, http://localhost:3000
npm test          # règlement, parsing, association ESPN
node test/fuzz.js # 20 000 paris aléatoires contre une référence
```

## Marchés gérés

Résultat 1N2, double chance, nul remboursé, les deux équipes marquent, plus/moins de buts.
Règlement sur le score à 90 minutes. Paris fermés au coup d'envoi.

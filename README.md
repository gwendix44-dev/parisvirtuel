# ParisVirtuel

Simulateur de paris sportifs en argent fictif. Vraies équipes et vrais effectifs (Top 5 européen + Ligue des champions), matchs de 30 minutes (2 × 14 min + 2 min de mi-temps), un nouveau tour toutes les 30 minutes, 24h/24.

- Simulation déterministe côté téléphone (graine fixe) : tout le monde voit les mêmes matchs, buts et résultats, sans serveur.
- Stats réelles (buts pour/contre, effectifs, buteurs) : `npm run build-world` régénère `docs/data/world.json` depuis ESPN et Wikipedia.
- Marchés : 1N2, double chance, remboursé si nul, les deux marquent, plus/moins de buts, mi-temps, cartons jaunes, score exact, buteur, premier buteur.
- Tests : `npm test`. Test accéléré dans le navigateur : `?speed=60`.
- Le site est dans `docs/` (PWA, installable sur téléphone).

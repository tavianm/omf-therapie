# HTML diff gate — preuves négatives reproductibles

Commande archivée : `npm run test:html-diff-170`.

Le test crée ses propres fixtures temporaires et lance le vrai gate
`scripts/diff-html-170.mjs`. Il ne dépend donc pas de la baseline de production
locale (`node_modules/.cache/170-baseline/`) et s'exécute dans CI après le build.

Résultat attendu (et vérifié lors de l'archivage) :

```text
PASS baseline-only-route-removal: exit 1 includes "FILE MISSING IN DIST — page/route removed"
PASS inter-inline-whitespace-loss: exit 1 includes "«WS»"
PASS dangling-astro-asset: exit 1 includes "DANGLING ASSET REFERENCE: /_astro/missing.js"
OK: 3 fail-closed HTML gate cases verified.
```

Les fixtures démontrent respectivement qu'une route présente uniquement dans la
baseline, la suppression d'un nœud texte d'espace entre deux éléments inline,
et une référence `/_astro/` sans fichier livré arrêtent le gate avec le code 1.

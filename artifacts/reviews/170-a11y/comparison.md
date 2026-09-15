# audit:a11y — baseline v5 vs final v7+TW4 (captures LOCALES)

Runs `A11Y_BASE_URL=http://localhost:<port> node scripts/run-a11y-audit.mjs` (pa11y WCAG2AA),
servis par `scripts/serve-dist.mjs` — URLs dérivées du sitemap GÉNÉRÉ (27 pages, filtrées aux prérendues).
Baseline : build local de c5b22dc (astro 5.18 + TW3, arbre pré-upgrade).
Final : build local de la branche (astro 7.3.2 + Tailwind 4.3.3).

> Historique : la première itération de cette comparaison comparait la prod à elle-même
> (le script auditait https://omf-therapie.fr) — invalidée par la review, corrigée ici.

| URL | erreurs/warnings baseline | erreurs/warnings final | verdict |
|-----|---------------------------|------------------------|---------|
| / | (9, 3) | (9, 3) | identique |
| /a-propos_ | (2, 3) | (2, 3) | identique |
| /accessibilite_ | (0, 2) | (0, 2) | identique |
| /blog_ | (15, 14) | (15, 14) | identique |
| /blog_accompagner-transitions-vie-serenite_ | (3, 6) | (3, 6) | identique |
| /blog_comprendre-langages-amour_ | (3, 6) | (3, 6) | identique |
| /blog_cultiver-estime-de-soi-quotidien_ | (3, 6) | (3, 6) | identique |
| /blog_deconstruire-tabous-therapie_ | (3, 6) | (3, 6) | identique |
| /blog_gerer-anxiete-quotidien-techniques-conseils_ | (3, 6) | (3, 6) | identique |
| /blog_gestion-stress-anxiete-montpellier_ | (3, 6) | (3, 6) | identique |
| /blog_impact-mots-langage-mal-etre_ | (3, 6) | (3, 6) | identique |
| /blog_relation-alimentation-sante-mentale_ | (3, 6) | (3, 6) | identique |
| /blog_renforcer-communication-couple_ | (3, 6) | (3, 6) | identique |
| /blog_therapie-couple-montpellier-guide_ | (3, 7) | (3, 7) | identique |
| /blog_troubles-comportement-alimentaire-comprendre-accompagner_ | (3, 6) | (3, 6) | identique |
| /blog_trouver-psychopraticien-montpellier_ | (3, 6) | (3, 6) | identique |
| /cgv_ | (2, 4) | (2, 4) | identique |
| /confidentialite_ | (2, 4) | (2, 4) | identique |
| /contact_ | (0, 5) | (0, 5) | identique |
| /mentions-legales_ | (2, 4) | (2, 4) | identique |
| /rendez-vous_ | (18, 1) | (18, 1) | identique |
| /services_ | (2, 3) | (2, 3) | identique |
| /services_anxiete-montpellier_ | (4, 3) | (4, 3) | identique |
| /services_therapie-de-couple_ | (4, 3) | (4, 3) | identique |
| /services_therapie-familiale_ | (4, 3) | (4, 3) | identique |
| /services_therapie-individuelle_ | (4, 3) | (4, 3) | identique |
| /services_troubles-alimentaires_ | (4, 3) | (4, 3) | identique |

**27/27 URLs identiques — 0 nouvelle violation WCAG AA.**

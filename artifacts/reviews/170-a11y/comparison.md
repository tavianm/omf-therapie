# audit:a11y — baseline v5 vs final v7+TW4

Runs `npm run audit:a11y` (pa11y WCAG2AA sur les URLs de public/sitemap.txt).
Baseline : arbre v5-TW3 intact (pré-bump). Final : astro 7.3.2 + Tailwind 4.3.3.

| URL | erreurs/warnings baseline | erreurs/warnings final | verdict |
|-----|---------------------------|------------------------|---------|
| omf-therapie.fr | (9, 43) | (9, 43) | identique |
| omf-therapie.fr_accessibilite | (0, 42) | (0, 42) | identique |
| omf-therapie.fr_blog | (15, 54) | (15, 54) | identique |
| omf-therapie.fr_blog_accompagner-transitions-vie-serenite | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_blog_comprendre-langages-amour | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_blog_cultiver-estime-de-soi-quotidien | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_blog_deconstruire-tabous-therapie | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_blog_gerer-anxiete-quotidien-techniques-conseils | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_blog_impact-mots-langage-mal-etre | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_blog_relation-alimentation-sante-mentale | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_blog_renforcer-communication-couple | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_blog_troubles-comportement-alimentaire-comprendre-accompagner | (3, 46) | (3, 46) | identique |
| omf-therapie.fr_contact | (0, 45) | (0, 45) | identique |

**13/13 URLs identiques — 0 nouvelle violation WCAG AA.**

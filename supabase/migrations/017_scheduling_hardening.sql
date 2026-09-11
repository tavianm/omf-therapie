-- =============================================================================
-- Migration 017 — Durcissement de la planification (revue PR #133)
-- =============================================================================
-- Complète 015/016 : verrou d'exécution sur la fonction de lecture de la
-- marge, documentation de l'ordre de déclenchement des triggers appointments,
-- et audit non bloquant des chevauchements historiques.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- W3 — scheduling_buffer_minutes() : exécution retirée à PUBLIC
-- -----------------------------------------------------------------------------
-- Comme pour set_scheduling_buffer (015) et les RPC d'avoirs (008), la
-- fonction n'est exécutable que par le rôle applicatif. Elle lit la table
-- scheduling_settings (RLS service_role) et est appelée par le trigger
-- appointments_enforce_schedule_conflict, qui s'exécute aux droits de
-- l'appelant : service_role doit donc conserver EXECUTE.
REVOKE EXECUTE ON FUNCTION public.scheduling_buffer_minutes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduling_buffer_minutes() TO service_role;

-- -----------------------------------------------------------------------------
-- W2 — Ordre de déclenchement des triggers appointments (alphabétique)
-- -----------------------------------------------------------------------------
-- PostgreSQL déclenche les triggers BEFORE d'un même événement par ordre
-- alphabétique de nom. Sur appointments, ce contrat est porteur (load-bearing) :
-- appointments_apply_scheduling_policy (calcul de NEW.blocked_until) doit
-- impérativement tirer AVANT appointments_enforce_schedule_conflict (contrôle
-- de chevauchement), qui lit la borne ainsi calculée. blocked_until étant
-- NOT NULL depuis 015, le cas d'inversion à l'INSERT est déjà neutralisé par
-- la contrainte ; la mitigation restante est documentale. Tout renommage
-- doit préserver l'ordre alphabétique « apply » < « enforce ».
COMMENT ON TRIGGER appointments_apply_scheduling_policy ON public.appointments IS
  'Ordre alphabétique porteur : doit se déclencher AVANT appointments_enforce_schedule_conflict (apply < enforce). Calcule NEW.blocked_until à partir de la marge configurée ; le contrôle de chevauchement lit cette borne. Tout renommage doit préserver l''ordre alphabétique apply avant enforce.';
COMMENT ON TRIGGER appointments_enforce_schedule_conflict ON public.appointments IS
  'Ordre alphabétique porteur : doit se déclencher APRÈS appointments_apply_scheduling_policy (apply < enforce). Lit NEW.blocked_until calculé par la politique de planification. Tout renommage doit préserver l''ordre alphabétique apply avant enforce.';

-- -----------------------------------------------------------------------------
-- F7 — Audit non bloquant des chevauchements historiques
-- -----------------------------------------------------------------------------
-- Le trigger 015 empêche tout nouveau chevauchement mais ne corrige pas les
-- données existantes. Cet audit compte les paires actives dont les fenêtres
-- [scheduled_at, blocked_until) se chevauchent (mêmes statuts bloquants et
-- mêmes bornes que le trigger). Il émet un simple WARNING : le déploiement
-- ne doit pas échouer sur des données historiques.
--
-- Requête manuelle pour l'opérateur — liste des paires en cause :
-- SELECT a.id AS rdv_a, a.scheduled_at AS debut_a, a.blocked_until AS fin_a, a.status AS statut_a,
--        b.id AS rdv_b, b.scheduled_at AS debut_b, b.blocked_until AS fin_b, b.status AS statut_b
--   FROM public.appointments a
--   JOIN public.appointments b ON a.id < b.id
--  WHERE a.deleted_at IS NULL
--    AND b.deleted_at IS NULL
--    AND a.status = ANY (ARRAY['pending', 'confirmed', 'payment_pending', 'payment_received', 'rescheduled'])
--    AND b.status = ANY (ARRAY['pending', 'confirmed', 'payment_pending', 'payment_received', 'rescheduled'])
--    AND a.scheduled_at < b.blocked_until
--    AND a.blocked_until > b.scheduled_at
--  ORDER BY a.scheduled_at, b.scheduled_at;

DO $$
DECLARE
  v_overlapping_pairs INTEGER;
  v_active_statuses TEXT[] := ARRAY[
    'pending', 'confirmed', 'payment_pending', 'payment_received', 'rescheduled'
  ];
BEGIN
  SELECT COUNT(*) INTO v_overlapping_pairs
  FROM public.appointments a
  JOIN public.appointments b ON a.id < b.id
  WHERE a.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND a.status = ANY (v_active_statuses)
    AND b.status = ANY (v_active_statuses)
    AND a.scheduled_at < b.blocked_until
    AND a.blocked_until > b.scheduled_at;

  IF v_overlapping_pairs > 0 THEN
    RAISE WARNING 'chevauchements historiques : % paire(s) de rendez-vous actifs dont les fenêtres [scheduled_at, blocked_until) se chevauchent. Exécuter la requête d''audit commentée dans la migration 017 pour lister les paires (identifiants, dates, statuts), puis ajuster ou annuler l''un des rendez-vous de chaque paire.', v_overlapping_pairs;
  END IF;
END $$;

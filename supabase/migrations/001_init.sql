-- =============================================================================
-- Migration 001 — Initialisation de la base OMF Thérapie
-- =============================================================================
-- Tables : appointments, user, session, account, verification
-- Auteur  : T02 / feat/15-prise-de-rendez-vous
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE : appointments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Informations patient
  patient_name        TEXT        NOT NULL,
  patient_email       TEXT        NOT NULL,
  patient_phone       TEXT        NOT NULL,
  patient_postal_code TEXT        NOT NULL,
  patient_city        TEXT        NOT NULL,
  patient_reason      TEXT        NOT NULL CHECK (char_length(patient_reason) <= 1500),

  -- Détails de la séance
  appointment_type TEXT NOT NULL
    CHECK (appointment_type IN ('individual', 'couple', 'family')),
  appointment_mode TEXT NOT NULL
    CHECK (appointment_mode IN ('in-person', 'video')),
  duration         INTEGER NOT NULL
    CHECK (duration IN (60, 90)),
  is_first_session BOOLEAN NOT NULL DEFAULT false,

  -- Tarification (en centimes)
  base_price  INTEGER NOT NULL,                -- prix de base
  discount    INTEGER NOT NULL DEFAULT 0,      -- remise éventuelle
  final_price INTEGER NOT NULL,                -- prix à régler

  -- Planification
  scheduled_at TIMESTAMPTZ NOT NULL,

  -- Workflow statut
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'confirmed',
      'declined',
      'rescheduled',
      'payment_pending',
      'payment_received',
      'cancelled'
    )),

  -- Stripe (téléconsultations)
  stripe_payment_link_id     TEXT,
  stripe_payment_link_url    TEXT,
  stripe_payment_intent_id   TEXT,

  -- Idempotence Stripe webhook
  stripe_event_id TEXT UNIQUE,

  -- Lien Google Meet (renseigné manuellement par la thérapeute)
  video_link TEXT,

  -- Notes thérapeute (usage interne, jamais exposées au patient)
  therapist_notes TEXT,

  -- Report de rendez-vous
  rescheduled_to TIMESTAMPTZ,

  -- Horodatages RGPD
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ                        -- soft delete, NULL = actif
);

-- ---------------------------------------------------------------------------
-- INDEX : appointments
-- ---------------------------------------------------------------------------

CREATE INDEX idx_appointments_scheduled_at ON appointments (scheduled_at);
CREATE INDEX idx_appointments_status       ON appointments (status);
CREATE INDEX idx_appointments_patient_email ON appointments (patient_email);

-- ---------------------------------------------------------------------------
-- TRIGGER : mise à jour automatique de updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY : appointments
-- ---------------------------------------------------------------------------

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- Le service_role (admin côté API) a un accès total
CREATE POLICY "admin full access" ON appointments
  FOR ALL
  USING (auth.role() = 'service_role');

-- Les visiteurs anonymes peuvent soumettre une prise de rendez-vous
CREATE POLICY "anon can insert" ON appointments
  FOR INSERT
  WITH CHECK (true);

-- Note : les anon ne peuvent pas lire les rendez-vous (pas de politique SELECT).
-- La confirmation de RDV se fait par email (transactionnel), pas par requête.

-- =============================================================================
-- TABLES BETTERAUTH (v1.6.9)
-- Gestion de l'authentification de la thérapeute (back-office)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE : user
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "user" (
  id              TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  "emailVerified" BOOLEAN     NOT NULL DEFAULT false,
  image           TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE : session
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS session (
  id           TEXT        PRIMARY KEY,
  "expiresAt"  TIMESTAMPTZ NOT NULL,
  token        TEXT        NOT NULL UNIQUE,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "userId"     TEXT        NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- TABLE : account
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS account (
  id                      TEXT        PRIMARY KEY,
  "accountId"             TEXT        NOT NULL,
  "providerId"            TEXT        NOT NULL,
  "userId"                TEXT        NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "idToken"               TEXT,
  "accessTokenExpiresAt"  TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope                   TEXT,
  password                TEXT,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE : verification
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification (
  id          TEXT        PRIMARY KEY,
  identifier  TEXT        NOT NULL,
  value       TEXT        NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY : tables BetterAuth
-- Accès exclusivement réservé au service_role (appels server-side BetterAuth)
-- ---------------------------------------------------------------------------

ALTER TABLE "user"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE session      ENABLE ROW LEVEL SECURITY;
ALTER TABLE account      ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin only" ON "user"
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "admin only" ON session
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "admin only" ON account
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "admin only" ON verification
  FOR ALL USING (auth.role() = 'service_role');

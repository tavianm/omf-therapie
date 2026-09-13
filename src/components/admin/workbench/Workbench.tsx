/**
 * Workbench — island du « Poste de travail » (proposition B) montée sur
 * `/poste-travail/` (issue #148). Reconstruite fidèlement aux 12 écrans
 * Figma « Refonte admin » (rendus de référence dans aidd_docs/tasks/
 * 2026_09/2026_09_11_poste-travail-proposition-b/figma/) :
 *
 *  - ≥ lg : barre latérale claire (profil, CTA création, navigation,
 *    liens pied) ; < lg : en-tête compact, barre d'onglets basse et FAB
 *  - sections Synthèse / Rendez-vous / Patients / Disponibilités avec des
 *    composants dédiés à la proposition B (les îlots de /mes-rdvs ne sont
 *    plus embarqués) — toujours montés, masqués via `hidden` pour
 *    préserver l'état entre changements de section
 *  - tiroir « Nouveau rendez-vous » (drawer ≥ sm / bottom sheet mobile)
 *    partagé par la barre latérale, le FAB et la fiche patient
 *  - focus croisé : la Synthèse pilote la section Rendez-vous via un canal
 *    unique de requêtes (focus RDV ou filtre « demandes », nonce monotone)
 *
 * Les fonctionnalités de la maquette sans backend sont rendues désactivées
 * avec la référence de l'issue de suivi — jamais simulées.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Appointment } from '../../../types/appointment';
import type { PrefillData } from '../../../types/patient';
import { useAppointmentsPolling } from '../../../hooks/useAppointmentsPolling';
import { CreateAppointmentDrawer } from './CreateAppointmentDrawer';
import { DisponibilitesView } from './disponibilites/DisponibilitesView';
import { PatientsView } from './patients/PatientsView';
import { RendezVousView } from './rdv/RendezVousView';
import { SyntheseView } from './SyntheseView';
import { FreshnessIndicator } from './ui';

type Section = 'synthese' | 'rdv' | 'patients' | 'disponibilites';

interface WorkbenchProps {
  appointments: Appointment[];
  practitionerName: string;
}

/**
 * Canal unique des demandes Synthèse → Rendez-vous (SC3) : chaque demande
 * (focus RDV ou filtre « demandes ») porte un nonce issu d'un compteur
 * monotone unique côté Workbench — un filtre ne peut pas avaler un focus
 * (et inversement) par collision de nonce.
 */
export type WorkbenchRequest =
  | { kind: 'focus'; id: string; nonce: number }
  | { kind: 'filter'; filter: 'demandes'; nonce: number };

/** Alias de migration — consommateur actuel : `rdv/RendezVousView` (canal focus). */
export type FocusRequest = WorkbenchRequest;

interface CreateDrawerState {
  open: boolean;
  prefill: PrefillData | null;
}

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'synthese', label: 'Synthèse' },
  { key: 'rdv', label: 'Rendez-vous' },
  { key: 'patients', label: 'Patients' },
  { key: 'disponibilites', label: 'Disponibilités' },
];

const SECTION_STORAGE_KEY = 'poste-travail-section';

// ---------------------------------------------------------------------------
// Icons (Heroicons outline, 24 viewBox)
// ---------------------------------------------------------------------------

function SectionIcon({
  section,
  className,
}: {
  section: Section;
  className: string;
}) {
  const paths: Record<Section, string> = {
    synthese:
      'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
    rdv: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5',
    patients:
      'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
    disponibilites: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[section]} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Workbench({ appointments: initialAppointments, practitionerName }: WorkbenchProps) {
  // État initial identique serveur/client (Synthèse) : la section sauvegardée
  // est restaurée APRÈS hydratation, sinon React détecte un mismatch et laisse
  // les attributs `hidden` du rendu serveur en place (revue #148).
  const [section, setSection] = useState<Section>('synthese');
  const [request, setRequest] = useState<WorkbenchRequest | null>(null);
  const [createDrawer, setCreateDrawer] = useState<CreateDrawerState>({
    open: false,
    prefill: null,
  });
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Live data (#165): SSR props are only the initial state — the list is now
  // owned by the Workbench and kept fresh by polling (visible-only, paused
  // while the creation drawer is open).
  const { appointments, refresh, lastUpdated, isStale } = useAppointmentsPolling(
    initialAppointments,
    { paused: createDrawer.open },
  );

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(SECTION_STORAGE_KEY);
      if (SECTIONS.some(s => s.key === saved)) setSection(saved as Section);
    } catch {
      // sessionStorage indisponible (navigation privée) — Synthèse par défaut.
    }
  }, []);

  const handleSectionChange = useCallback((next: Section) => {
    setSection(next);
    try {
      window.sessionStorage.setItem(SECTION_STORAGE_KEY, next);
    } catch {
      // Persistance best-effort — la navigation reste fonctionnelle sans.
    }
  }, []);

  // Compteur monotone unique (SC3) : toute demande — focus ou filtre — passe
  // par nextNonce(), les collisions entre canaux sont donc impossibles.
  const nonceRef = useRef(0);
  const nextNonce = useCallback(() => {
    nonceRef.current += 1;
    return nonceRef.current;
  }, []);

  // Synthèse → Rendez-vous : révèle le RDV dans la liste.
  const handleFocusAppointment = useCallback(
    (appointmentId: string) => {
      setRequest({ kind: 'focus', id: appointmentId, nonce: nextNonce() });
      handleSectionChange('rdv');
    },
    [handleSectionChange, nextNonce],
  );

  // Synthèse (KPI « Demandes de RDV ») → Rendez-vous avec le filtre
  // « Demandes de RDV » présélectionné (R1).
  const handleOpenDemandes = useCallback(() => {
    setRequest({ kind: 'filter', filter: 'demandes', nonce: nextNonce() });
    handleSectionChange('rdv');
  }, [handleSectionChange, nextNonce]);

  const openCreateDrawer = useCallback((prefill: PrefillData | null = null) => {
    setCreateDrawer({ open: true, prefill });
  }, []);

  const closeCreateDrawer = useCallback(() => {
    setCreateDrawer(current => ({ ...current, open: false }));
  }, []);

  async function handleSignout() {
    setIsSigningOut(true);
    try {
      await fetch('/api/auth/sign-out/', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      window.localStorage.removeItem('omf-admin-auth');
      window.location.href = '/login/';
    }
  }

  return (
    <div className="min-h-screen bg-mint-50">
      {/* ── Sidebar (≥ lg) ─────────────────────────────────────────────── */}
      <aside
        className="
          hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 xl:w-72 lg:z-30
          lg:flex-col lg:gap-6 bg-white border-r border-sage-200 px-5 py-6
        "
        aria-label="Poste de travail"
      >
        {/* Profil */}
        <div>
          <p className="font-serif text-lg font-semibold text-sage-900 truncate">
            {practitionerName}
          </p>
          <p className="text-[11px] font-semibold font-sans uppercase tracking-wider text-sage-400 mt-0.5">
            Psychologue clinicienne
          </p>
        </div>

        {/* CTA création */}
        <button
          type="button"
          onClick={() => openCreateDrawer()}
          className="
            w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm
            font-semibold font-sans rounded-xl bg-sage-900 text-white shadow-sm hover:bg-sage-800
            focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-1
            transition-colors min-h-[44px]
          "
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
              clipRule="evenodd"
            />
          </svg>
          Nouveau rendez-vous
        </button>

        {/* Navigation */}
        <nav aria-label="Sections du poste de travail">
          <p className="text-[10px] font-semibold font-sans uppercase tracking-wider text-sage-400 mb-2 px-3">
            Navigation espace
          </p>
          <ul className="space-y-1">
            {SECTIONS.map(({ key, label }) => {
              const isActive = section === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => handleSectionChange(key)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm
                      font-medium font-sans transition-colors
                      focus:outline-none focus:ring-2 focus:ring-mint-400
                      ${isActive ? 'bg-mint-100 text-sage-900' : 'text-sage-600 hover:bg-mint-50 hover:text-sage-900'}
                    `}
                  >
                    <SectionIcon section={key} className="w-5 h-5 shrink-0" />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Pied de barre latérale */}
        <div className="mt-auto space-y-1 border-t border-sage-200 pt-4">
          <a
            href="/mes-rdvs/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans text-sage-500 hover:bg-mint-50 hover:text-sage-700 transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
            Interface actuelle (mes RDV)
          </a>
          <a
            href="/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans text-sage-500 hover:bg-mint-50 hover:text-sage-700 transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
            Retour au site public
          </a>
          <button
            type="button"
            onClick={handleSignout}
            disabled={isSigningOut}
            className="
              w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-sans
              text-sage-500 hover:bg-mint-50 hover:text-sage-700 transition-colors
              focus:outline-none focus:ring-2 focus:ring-mint-400
              disabled:opacity-60 disabled:cursor-not-allowed
            "
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
              />
            </svg>
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ── En-tête mobile (< lg) ──────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 bg-white/95 backdrop-blur border-b border-sage-200 px-4 py-3">
        <div className="min-w-0">
          <p className="font-serif text-base font-semibold text-sage-900">
            Poste de travail
          </p>
          <p className="text-xs text-sage-500 font-sans truncate">
            {practitionerName}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignout}
          disabled={isSigningOut}
          className="
            inline-flex items-center justify-center w-10 h-10 rounded-xl border border-sage-300
            text-sage-600 hover:bg-sage-50 transition-colors
            focus:outline-none focus:ring-2 focus:ring-mint-400
            disabled:opacity-60 disabled:cursor-not-allowed shrink-0
          "
          aria-label="Se déconnecter"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
            />
          </svg>
        </button>
      </header>

      {/* ── Contenu ────────────────────────────────────────────────────── */}
      <main className="lg:pl-64 xl:pl-72">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 pb-28 lg:pb-10">
          {/* Synthèse */}
          <section
            id="section-synthese"
            hidden={section !== 'synthese'}
            aria-labelledby="heading-synthese"
          >
            <h1 id="heading-synthese" className="sr-only">
              Synthèse
            </h1>
            <FreshnessIndicator lastUpdated={lastUpdated} isStale={isStale} />
            <SyntheseView
              appointments={appointments}
              onFocusAppointment={handleFocusAppointment}
              onOpenDemandes={handleOpenDemandes}
            />
          </section>

          {/* Rendez-vous (en-tête intégré à la vue) */}
          <section
            id="section-rdv"
            hidden={section !== 'rdv'}
            aria-label="Rendez-vous"
          >
            <RendezVousView
              appointments={appointments}
              focus={request}
              onRefresh={refresh}
            />
          </section>
          </section>

          {/* Patients (en-tête intégré à la vue) */}
          <section
            id="section-patients"
            hidden={section !== 'patients'}
            aria-label="Patients"
          >
            <PatientsView
              appointments={appointments}
              onPlanAppointment={openCreateDrawer}
            />
          </section>

          {/* Disponibilités (en-tête intégré à la vue) */}
          <section
            id="section-disponibilites"
            hidden={section !== 'disponibilites'}
            aria-label="Disponibilités et calendrier"
          >
            <DisponibilitesView />
          </section>
        </div>
      </main>

      {/* ── Barre de navigation mobile (< lg) ──────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-sage-200 pb-[env(safe-area-inset-bottom)]"
        aria-label="Sections du poste de travail"
      >
        <ul className="grid grid-cols-4">
          {SECTIONS.map(({ key, label }) => {
            const isActive = section === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => handleSectionChange(key)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`
                    w-full flex flex-col items-center gap-1 px-1 pt-2.5 pb-2 text-[11px]
                    font-medium font-sans transition-colors
                    focus:outline-none focus:ring-2 focus:ring-inset focus:ring-mint-400
                    ${isActive ? 'text-sage-900 font-semibold' : 'text-sage-500 hover:text-sage-700'}
                  `}
                >
                  <SectionIcon section={key} className="w-5 h-5" />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── FAB création (< lg) ────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => openCreateDrawer()}
        className="
          lg:hidden fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 px-5 py-3
          text-sm font-semibold font-sans rounded-full bg-sage-900 text-white shadow-lg
          hover:bg-sage-800 focus:outline-none focus:ring-2 focus:ring-mint-400
          focus:ring-offset-2 transition-colors min-h-[48px]
        "
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
            clipRule="evenodd"
          />
        </svg>
        Nouveau RDV
      </button>

      {/* ── Tiroir « Nouveau rendez-vous » ─────────────────────────────── */}
      <CreateAppointmentDrawer
        open={createDrawer.open}
        appointments={appointments}
        prefill={createDrawer.prefill}
        onClose={closeCreateDrawer}
        onRefresh={refresh}
      />
    </div>
  );
}

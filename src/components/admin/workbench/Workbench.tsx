/**
 * Workbench — proposal-B admin workspace island mounted on `/poste-travail/`
 * (issue #148).
 *
 * App shell inspired by the Figma file "Refonte admin":
 *   - ≥ lg: fixed left sidebar (profile, "Nouveau rendez-vous" CTA, section
 *     nav, footer links) — the public navbar is intentionally absent
 *   - < lg: slim top header, fixed bottom tab bar and a floating "Nouveau RDV"
 *     action button
 *   - four sections (Synthèse / Rendez-vous / Patients / Disponibilités) stay
 *     mounted and toggle via `hidden`, preserving island state across switches
 *     (same pattern as /mes-rdvs tabs)
 *
 * The Rendez-vous / Patients / Disponibilités sections reuse the existing
 * admin islands unchanged; proposal-specific logic lives in SyntheseView and
 * utils/workbench.ts. A `focusAppointment` request (id + nonce) is forwarded
 * to AppointmentsManager so Synthèse rows can reveal a card in the list.
 */

import { useCallback, useState } from 'react';
import type { Appointment } from '../../../types/appointment';
import { AdminCreateButton } from '../AdminCreateButton';
import { AppointmentsManager } from '../AppointmentsManager';
import GoogleCalendarStatus from '../GoogleCalendarStatus';
import { PatientList } from '../PatientList';
import { TimeSlotManager } from '../TimeSlotManager';
import { SyntheseView } from './SyntheseView';

type Section = 'synthese' | 'rdv' | 'patients' | 'disponibilites';

interface WorkbenchProps {
  appointments: Appointment[];
  practitionerName: string;
}

/** Non-null when the Synthèse asked to reveal an appointment; nonce re-triggers. */
interface FocusRequest {
  id: string;
  nonce: number;
}

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'synthese', label: 'Synthèse' },
  { key: 'rdv', label: 'Rendez-vous' },
  { key: 'patients', label: 'Patients' },
  { key: 'disponibilites', label: 'Disponibilités' },
];

const SECTION_STORAGE_KEY = 'poste-travail-section';

function readInitialSection(): Section {
  if (typeof window === 'undefined') return 'synthese';
  const saved = window.sessionStorage.getItem(SECTION_STORAGE_KEY);
  return SECTIONS.some((s) => s.key === saved) ? (saved as Section) : 'synthese';
}

// ---------------------------------------------------------------------------
// Icons (Heroicons outline, 24 viewBox)
// ---------------------------------------------------------------------------

function SectionIcon({ section, className }: { section: Section; className: string }) {
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

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Workbench({ appointments, practitionerName }: WorkbenchProps) {
  const [section, setSection] = useState<Section>(readInitialSection);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSectionChange = useCallback((next: Section) => {
    setSection(next);
    window.sessionStorage.setItem(SECTION_STORAGE_KEY, next);
  }, []);

  // Synthèse → Rendez-vous: reveal the appointment card in the list.
  const handleFocusAppointment = useCallback(
    (appointmentId: string) => {
      setFocus((prev) => ({ id: appointmentId, nonce: (prev?.nonce ?? 0) + 1 }));
      handleSectionChange('rdv');
    },
    [handleSectionChange],
  );

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

  const pendingCount = appointments.filter((a) => a.status === 'pending').length;
  const FAB_CLASS = `
    fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 px-5 py-3
    text-sm font-semibold font-sans rounded-full bg-mint-700 text-white shadow-lg
    hover:bg-mint-800 focus:outline-none focus:ring-2 focus:ring-mint-400
    focus:ring-offset-2 transition-colors min-h-[48px]
  `;

  return (
    <div className="min-h-screen bg-sage-50">
      {/* ── Sidebar (≥ lg) ─────────────────────────────────────────────── */}
      <aside
        className="
          hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 xl:w-72 lg:z-30
          lg:flex-col lg:gap-6 bg-white border-r border-sage-200 px-5 py-6
        "
        aria-label="Poste de travail"
      >
        {/* Profil */}
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-mint-700 text-white font-serif text-sm font-semibold shrink-0"
            aria-hidden="true"
          >
            {initialsOf(practitionerName)}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-sage-900 font-sans truncate">
              {practitionerName}
            </span>
            <span className="block text-[11px] font-medium font-sans uppercase tracking-wider text-sage-400">
              Psychologue clinicienne
            </span>
          </span>
        </div>

        {/* CTA création */}
        <AdminCreateButton className="w-full justify-center" />

        {/* Navigation */}
        <nav aria-label="Sections du poste de travail">
          <p className="text-[11px] font-semibold font-sans uppercase tracking-wider text-sage-400 mb-2">
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
                      ${isActive
                        ? 'bg-mint-50 text-mint-800'
                        : 'text-sage-600 hover:bg-sage-50 hover:text-sage-900'}
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
            className="block px-3 py-2 rounded-xl text-sm font-sans text-sage-500 hover:bg-sage-50 hover:text-sage-700 transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400"
          >
            Interface actuelle (mes RDV)
          </a>
          <a
            href="/"
            className="block px-3 py-2 rounded-xl text-sm font-sans text-sage-500 hover:bg-sage-50 hover:text-sage-700 transition-colors focus:outline-none focus:ring-2 focus:ring-mint-400"
          >
            Retour au site public
          </a>
          <button
            type="button"
            onClick={handleSignout}
            disabled={isSigningOut}
            className="
              w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-sans
              text-sage-500 hover:bg-sage-50 hover:text-sage-700 transition-colors
              focus:outline-none focus:ring-2 focus:ring-mint-400
              disabled:opacity-60 disabled:cursor-not-allowed
            "
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
            </svg>
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ── En-tête mobile (< lg) ──────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 bg-white/95 backdrop-blur border-b border-sage-200 px-4 py-3">
        <div className="min-w-0">
          <p className="font-serif text-base font-semibold text-sage-900">Poste de travail</p>
          <p className="text-xs text-sage-500 font-sans truncate">{practitionerName}</p>
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
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
          </svg>
        </button>
      </header>

      {/* ── Contenu ────────────────────────────────────────────────────── */}
      <main className="lg:pl-64 xl:pl-72">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 pb-28 lg:pb-10">
          {/* Synthèse */}
          <section
            id="section-synthese"
            hidden={section !== 'synthese'}
            aria-labelledby="heading-synthese"
          >
            <header className="mb-6">
              <h1 id="heading-synthese" className="font-serif text-2xl lg:text-3xl font-semibold text-sage-900">
                Synthèse
              </h1>
              <p className="text-sm text-sage-500 font-sans mt-1">
                Vue d'ensemble de votre activité
              </p>
            </header>
            <SyntheseView appointments={appointments} onFocusAppointment={handleFocusAppointment} />
          </section>

          {/* Rendez-vous */}
          <section
            id="section-rdv"
            hidden={section !== 'rdv'}
            aria-labelledby="heading-rdv"
          >
            <header className="mb-6">
              <h1 id="heading-rdv" className="font-serif text-2xl lg:text-3xl font-semibold text-sage-900">
                Rendez-vous
              </h1>
              <p className="text-sm text-sage-500 font-sans mt-1">
                {appointments.length} rendez-vous
                {pendingCount > 0 ? ` · ${pendingCount} en attente` : ''}
              </p>
            </header>
            <AppointmentsManager appointments={appointments} focusAppointment={focus} />
          </section>

          {/* Patients */}
          <section
            id="section-patients"
            hidden={section !== 'patients'}
            aria-labelledby="heading-patients"
          >
            <header className="mb-6">
              <h1 id="heading-patients" className="font-serif text-2xl lg:text-3xl font-semibold text-sage-900">
                Patients
              </h1>
              <p className="text-sm text-sage-500 font-sans mt-1">
                Dossiers dérivés de l'historique des rendez-vous
              </p>
            </header>
            <PatientList />
          </section>

          {/* Disponibilités */}
          <section
            id="section-disponibilites"
            hidden={section !== 'disponibilites'}
            aria-labelledby="heading-disponibilites"
          >
            <header className="mb-6">
              <h1 id="heading-disponibilites" className="font-serif text-2xl lg:text-3xl font-semibold text-sage-900">
                Disponibilités &amp; calendrier
              </h1>
              <p className="text-sm text-sage-500 font-sans mt-1">
                Les présences ouvrent les rendez-vous au cabinet ; la visio conserve les règles de
                l'agenda synchronisé
              </p>
            </header>
            <div className="space-y-5">
              <GoogleCalendarStatus />
              <TimeSlotManager />
            </div>
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
                    ${isActive ? 'text-mint-700' : 'text-sage-500 hover:text-sage-700'}
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
      <div className="lg:hidden">
        <AdminCreateButton label="Nouveau RDV" className={FAB_CLASS} />
      </div>
    </div>
  );
}

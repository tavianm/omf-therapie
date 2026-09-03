import { useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment } from '../../types/appointment';
import type { Patient } from '../../types/patient';
import { AppointmentCard } from './AppointmentCard';
import { AdminOverview } from './AdminOverview';
import { AdminSidePanel } from './AdminSidePanel';
import { AppointmentsManager } from './AppointmentsManager';
import { AppointmentComposer } from './AppointmentComposer';
import { PatientList } from './PatientList';
import { AvailabilityManager } from './AvailabilityManager';
import {
  getWorkspaceSummary,
  type AdminWorkspaceDestination,
  upsertWorkspaceAppointment,
} from './admin-workspace-utils';

interface AdminWorkspaceProps {
  appointments: Appointment[];
}

const DESTINATION_STORAGE_KEY = 'omf-admin-workspace-destination';

const NAVIGATION: Array<{ key: AdminWorkspaceDestination; label: string }> = [
  { key: 'overview', label: 'Synthèse' },
  { key: 'appointments', label: 'Rendez-vous' },
  { key: 'patients', label: 'Patients' },
  { key: 'availability', label: 'Disponibilités' },
];

function readDestination(): AdminWorkspaceDestination {
  if (typeof window === 'undefined') return 'overview';
  const saved = window.sessionStorage.getItem(DESTINATION_STORAGE_KEY);
  return NAVIGATION.some(item => item.key === saved)
    ? (saved as AdminWorkspaceDestination)
    : 'overview';
}

// French elision: "de Alice" → "d'Alice" before a vowel or a mute h.
function rendezVousTitle(patientName: string): string {
  return /^[aàâeéèêëiîïoôuûùyœh]/i.test(patientName)
    ? `Rendez-vous d'${patientName}`
    : `Rendez-vous de ${patientName}`;
}

export function AdminWorkspace({ appointments }: AdminWorkspaceProps) {
  const [appointmentList, setAppointmentList] = useState(appointments);
  const [destination, setDestination] =
    useState<AdminWorkspaceDestination>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPatient, setComposerPatient] = useState<Patient | null>(null);
  const [calendarStatus, setCalendarStatus] = useState(
    'Vérification de l’agenda…',
  );
  const [calendarNeedsReconnect, setCalendarNeedsReconnect] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const destinationHydratedRef = useRef(false);

  const summary = useMemo(
    () => getWorkspaceSummary(appointmentList),
    [appointmentList],
  );
  const selectedAppointment =
    appointmentList.find(item => item.id === selectedId) ?? null;

  useEffect(() => {
    setAppointmentList(appointments);
  }, [appointments]);

  useEffect(() => {
    setDestination(readDestination());
  }, []);

  useEffect(() => {
    if (!destinationHydratedRef.current) {
      destinationHydratedRef.current = true;
      return;
    }
    window.sessionStorage.setItem(DESTINATION_STORAGE_KEY, destination);
  }, [destination]);

  // Stale-response guard instead of an AbortController — see PatientList for
  // the rationale (abort() itself triggers the engine's unhandled
  // AbortError console artifact).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/google-oauth/status/', {
      credentials: 'same-origin',
    })
      .then(async response => {
        if (!response.ok) throw new Error('status unavailable');
        return response.json() as Promise<{
          connected?: boolean;
          tokenValid?: boolean;
        }>;
      })
      .then(status => {
        if (cancelled) return;
        const connected =
          status.connected === true && status.tokenValid === true;
        setCalendarStatus(
          connected ? 'Agenda connecté' : 'Agenda à reconnecter',
        );
        setCalendarNeedsReconnect(!connected);
      })
      .catch(() => {
        if (!cancelled) {
          setCalendarStatus('Agenda indisponible');
          setCalendarNeedsReconnect(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Transient feedback: if the notice never cleared, it would sit above the
  // workspace forever and mask subsequent notices. Auto-dismiss after 8s.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function selectAppointment(appointment: Appointment) {
    returnFocusRef.current = document.activeElement as HTMLElement;
    setSelectedId(appointment.id);
  }

  function closePanel() {
    setSelectedId(null);
    setComposerOpen(false);
    setComposerPatient(null);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function handleAppointmentUpdated(appointment: Appointment) {
    setAppointmentList(current =>
      upsertWorkspaceAppointment(current, appointment),
    );
    setNotice(
      'Enregistré. Les traitements agenda, paiement ou email peuvent encore se finaliser.',
    );
  }

  function openComposer(patient: Patient | null = null) {
    returnFocusRef.current = document.activeElement as HTMLElement;
    setSelectedId(null);
    setComposerPatient(patient);
    setComposerOpen(true);
  }

  function handleAppointmentCreated(appointment: Appointment) {
    setAppointmentList(current =>
      upsertWorkspaceAppointment(current, appointment),
    );
    setNotice(
      `Rendez-vous créé pour ${appointment.patient_name}. Le formulaire est prêt pour le suivant.`,
    );
  }

  async function handleSignOut() {
    setSignOutError(null);
    try {
      const response = await fetch('/api/auth/sign-out/', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok)
        throw new Error(`sign-out failed with status ${response.status}`);
      window.location.href = '/login/';
    } catch (reason) {
      console.warn('[AdminWorkspace] sign-out failed:', reason);
      // Shared iPad: never pretend the session ended while it is still valid.
      setSignOutError(
        'La déconnexion a échoué. La session est toujours active — réessayez avant de quitter l’appareil.',
      );
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-sage-200 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-sage-900">
            Poste de travail
          </h1>
          <p className="mt-1 text-sm text-sage-600">
            {summary.total} rendez-vous · {calendarStatus}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {calendarNeedsReconnect && (
            <a
              href="/api/admin/google-oauth/"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-sage-300 px-4 text-sm font-medium text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400"
            >
              Reconnecter l’agenda
            </a>
          )}
          <button
            type="button"
            onClick={() => openComposer()}
            className="min-h-11 rounded-xl bg-mint-700 px-4 text-sm font-semibold text-white hover:bg-mint-800 focus:outline-none focus:ring-2 focus:ring-mint-400 focus:ring-offset-2"
          >
            Nouveau rendez-vous
          </button>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="min-h-11 rounded-xl border border-sage-300 px-4 text-sm font-medium text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {signOutError && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {signOutError}
        </p>
      )}

      <nav
        className="flex gap-2 overflow-x-auto rounded-2xl border border-sage-200 bg-white p-2"
        aria-label="Navigation du poste de travail"
      >
        {NAVIGATION.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setDestination(item.key)}
            aria-current={destination === item.key ? 'page' : undefined}
            className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-mint-400 ${destination === item.key ? 'bg-mint-700 text-white' : 'text-sage-700 hover:bg-sage-50'}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border border-mint-200 bg-mint-50 px-4 py-3 text-sm text-mint-900"
        >
          {notice}
        </p>
      )}

      {/* The side column only exists when a panel occupies it: reserved
          unconditionally, it leaves ~40% of the workspace empty on wide
          screens (iPad landscape included). */}
      <div
        className={
          selectedAppointment || composerOpen
            ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.75fr)]'
            : 'grid gap-5'
        }
      >
        <main className="min-w-0 rounded-2xl border border-sage-200 bg-sage-50 p-4 sm:p-5">
          {destination === 'overview' && (
            <AdminOverview
              summary={summary}
              onSelectAppointment={selectAppointment}
            />
          )}
          {destination === 'appointments' && (
            <AppointmentsManager
              appointments={appointmentList}
              selectedId={selectedId}
              onSelectAppointment={selectAppointment}
            />
          )}
          {destination === 'patients' && (
            <PatientList onStartAppointment={openComposer} />
          )}
          {destination === 'availability' && <AvailabilityManager />}
        </main>

        {selectedAppointment && (
          <AdminSidePanel
            title={rendezVousTitle(selectedAppointment.patient_name)}
            onClose={closePanel}
          >
            <AppointmentCard
              key={selectedAppointment.id}
              appointment={selectedAppointment}
              onAppointmentUpdated={handleAppointmentUpdated}
            />
          </AdminSidePanel>
        )}
        {composerOpen && !selectedAppointment && (
          <AdminSidePanel title="Nouveau rendez-vous" onClose={closePanel}>
            <AppointmentComposer
              initialPatient={composerPatient}
              onCreated={handleAppointmentCreated}
              onClose={closePanel}
            />
          </AdminSidePanel>
        )}
      </div>
    </div>
  );
}

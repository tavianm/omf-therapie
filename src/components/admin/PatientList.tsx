import { useEffect, useState } from "react";
import { toast, Toaster } from "react-hot-toast";
import { getModeLabel, getTypeLabel } from "../../lib/pricing";
import { AdminCreateButton } from "./AdminCreateButton";
import type { Patient, PrefillData, AppointmentStatus } from "../../types/patient";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmé",
  declined: "Refusé",
  rescheduled: "Reporté",
  payment_pending: "Paiement en attente",
  payment_received: "Paiement reçu",
  cancelled: "Annulé",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));
}

function formatPrice(cents: number): string {
  return `${Math.round(cents / 100)}€`;
}

function getPanelId(email: string): string {
  return `patient-panel-${email.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function getReviewableAppointmentId(patient: Patient): string | null {
  const reviewableAppointment = patient.appointments.find(
    (appointment) =>
      appointment.status === "confirmed" || appointment.status === "payment_received",
  );
  return reviewableAppointment?.id ?? null;
}

export function PatientList() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [expandedPatientEmail, setExpandedPatientEmail] = useState<string | null>(null);
  const [reviewLoadingEmail, setReviewLoadingEmail] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchPatients() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/patients?includeArchived=${String(includeArchived)}`, {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Erreur lors du chargement des patients");
        }

        const body = (await response.json()) as { patients: Patient[] };
        setPatients(body.patients ?? []);
        setExpandedPatientEmail((current) =>
          body.patients?.some((patient) => patient.email === current) ? current : null,
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Erreur inconnue");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchPatients();

    return () => controller.abort();
  }, [includeArchived]);

  async function handleSendReviewReminder(patient: Patient) {
    const appointmentId = getReviewableAppointmentId(patient);
    if (!appointmentId) {
      toast.error("Aucun rendez-vous confirmé à relancer pour ce patient.", { duration: 4000 });
      return;
    }

    setReviewLoadingEmail(patient.email);
    try {
      const response = await fetch("/api/send-review-email/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ appointmentId }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Erreur lors de l'envoi du rappel d'avis");
      }

      toast.success(`Relance d'avis envoyée à ${patient.name}.`, { duration: 4000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue", { duration: 4000 });
    } finally {
      setReviewLoadingEmail((current) => (current === patient.email ? null : current));
    }
  }

  return (
    <section className="space-y-4">
      <Toaster position="top-right" />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-sage-500 font-sans">
          {loading ? "Chargement..." : `${patients.length} patient${patients.length > 1 ? "s" : ""}`}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-sage-700 font-sans">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="h-4 w-4 rounded border-sage-300 text-mint-700 focus:ring-mint-400"
          />
          Afficher les patients inactifs
        </label>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-sans" role="alert">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-sm text-sage-500 font-sans" role="status" aria-live="polite">
          Chargement des patients...
        </p>
      )}

      {!loading && !error && patients.length === 0 && (
        <p className="rounded-2xl border border-sage-200 bg-white px-5 py-6 text-center text-sage-500 font-sans">
          Aucun patient trouvé pour ce filtre.
        </p>
      )}

      {!loading && !error && patients.length > 0 && (
        <ul className="space-y-3">
          {patients.map((patient) => {
            const isExpanded = expandedPatientEmail === patient.email;
            const panelId = getPanelId(patient.email);
            const prefillData: PrefillData = {
              patient_name: patient.name,
              patient_email: patient.email,
              patient_phone: patient.phone,
              appointment_type: patient.lastAppointmentType,
            };
            const reviewableAppointmentId = getReviewableAppointmentId(patient);
            const isReviewActionDisabled = !reviewableAppointmentId || reviewLoadingEmail === patient.email;

            return (
              <li key={patient.email} className="rounded-2xl border border-sage-200 bg-white">
                <button
                  type="button"
                  className="w-full px-4 py-4 text-left hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-mint-400 rounded-2xl"
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  aria-label={`${isExpanded ? "Masquer" : "Afficher"} l'historique de ${patient.name}`}
                  onClick={() => setExpandedPatientEmail(isExpanded ? null : patient.email)}
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div>
                      <p className="text-xs text-sage-500 font-sans">Nom</p>
                      <p className="text-sm text-sage-900 font-medium font-sans">{patient.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-sage-500 font-sans">Email</p>
                      <p className="text-sm text-sage-900 font-sans break-all">{patient.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-sage-500 font-sans">Téléphone</p>
                      <p className="text-sm text-sage-900 font-sans">{patient.phone || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-sage-500 font-sans">Nombre de séances</p>
                      <p className="text-sm text-sage-900 font-sans">{patient.sessionCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-sage-500 font-sans">Dernier RDV</p>
                      <p className="text-sm text-sage-900 font-sans">{formatDate(patient.lastAppointmentAt)}</p>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div id={panelId} className="border-t border-sage-200 px-4 py-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-serif text-lg text-sage-800">Historique des rendez-vous</h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSendReviewReminder(patient)}
                          disabled={isReviewActionDisabled}
                          className="inline-flex items-center px-4 py-2 text-sm font-medium font-sans rounded-xl border border-sage-300 text-sage-700 hover:bg-sage-50 focus:outline-none focus:ring-2 focus:ring-sage-300 focus:ring-offset-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
                        >
                          {reviewLoadingEmail === patient.email ? "Envoi..." : "Relancer avis"}
                        </button>
                        <AdminCreateButton prefillData={prefillData} />
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {patient.appointments.map((appointment) => (
                        <li
                          key={appointment.id}
                          className="rounded-xl border border-sage-200 bg-sage-50 px-3 py-3"
                        >
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-sm font-sans text-sage-700">
                            <p><span className="text-sage-500">Date :</span> {formatDate(appointment.scheduledAt)}</p>
                            <p><span className="text-sage-500">Type :</span> {getTypeLabel(appointment.appointmentType)}</p>
                            <p><span className="text-sage-500">Mode :</span> {getModeLabel(appointment.appointmentMode)}</p>
                            <p><span className="text-sage-500">Statut :</span> {STATUS_LABELS[appointment.status]}</p>
                            <p><span className="text-sage-500">Montant :</span> {formatPrice(appointment.finalPrice)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

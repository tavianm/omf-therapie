/**
 * GoogleCalendarStatus — React island for the admin dashboard (/mes-rdvs)
 *
 * Displays the Google Calendar OAuth connection status and allows the admin
 * to re-authorize when the token is expired or missing.
 *
 * Reads ?google_connected / ?google_error URL params after the OAuth callback
 * and surfaces them as toast notifications, then cleans the URL.
 */

import { useState, useEffect } from "react";
import toast, { Toaster } from "react-hot-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatusResponse {
  connected: boolean;
  expiresAt: string | null;
  updatedAt: string | null;
  tokenValid: boolean;
}

type FetchState =
  | { status: "loading" }
  | { status: "success"; data: StatusResponse }
  | { status: "error" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO date string as "DD/MM/YYYY à HH:mm" in Paris timezone. */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  })
    .format(new Date(iso))
    .replace(",", " à");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-sage-200 shadow-sm animate-pulse"
      aria-busy="true"
      aria-label="Chargement du statut Google Calendar"
    >
      <div className="h-4 w-4 rounded-full bg-sage-200" />
      <div className="h-3.5 w-40 rounded bg-sage-200" />
      <div className="h-3 w-24 rounded bg-sage-100 ml-auto" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GoogleCalendarStatus() {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  // ── Fetch status ────────────────────────────────────────────────────────────
  async function fetchStatus() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/admin/google-oauth/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StatusResponse = await res.json();
      setState({ status: "success", data });
    } catch {
      setState({ status: "error" });
    }
  }

  // ── Read OAuth callback URL params & show toasts ────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("google_connected");
    const error = params.get("google_error");

    if (connected === "true") {
      toast.success("Google Calendar connecté avec succès !");
    } else if (error === "access_denied") {
      toast.error("Autorisation refusée. Réessayez.");
    } else if (error) {
      toast.error("Erreur de connexion Google Calendar.");
    }

    // Clean the URL if any param was present
    if (connected || error) {
      params.delete("google_connected");
      params.delete("google_error");
      const newSearch = params.toString();
      const newUrl = newSearch
        ? `${window.location.pathname}?${newSearch}`
        : window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }

    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (state.status === "loading") {
    return (
      <>
        <Toaster position="top-right" />
        <LoadingSkeleton />
      </>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (state.status === "error") {
    return (
      <>
        <Toaster position="top-right" />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white rounded-xl border border-red-200 shadow-sm">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
            ✗ Google Calendar
          </span>
          <p className="text-sm text-sage-500 font-sans">
            Impossible de vérifier le statut.
          </p>
          <button
            type="button"
            onClick={fetchStatus}
            className="
              ml-auto text-xs font-medium font-sans px-3 py-1.5
              rounded-lg border border-sage-200 text-sage-600
              hover:bg-sage-50 hover:text-sage-800
              focus:outline-none focus:ring-2 focus:ring-sage-300
              transition-colors
            "
          >
            Réessayer
          </button>
        </div>
      </>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  const { data } = state;

  // Connected and token valid
  if (data.connected && data.tokenValid) {
    return (
      <>
        <Toaster position="top-right" />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white rounded-xl border border-sage-200 shadow-sm">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            ● Google Calendar connecté
          </span>
          {data.updatedAt && (
            <p className="text-xs text-sage-400 font-sans">
              Mis à jour le {formatDateTime(data.updatedAt)}
            </p>
          )}
          <a
            href="/api/admin/google-oauth"
            className="
              ml-auto text-xs font-medium font-sans px-3 py-1.5
              rounded-lg border border-sage-200 text-sage-600
              hover:bg-sage-50 hover:text-sage-800
              focus:outline-none focus:ring-2 focus:ring-sage-300
              transition-colors
            "
          >
            Reconnecter
          </a>
        </div>
      </>
    );
  }

  // Connected but token expired
  if (data.connected && !data.tokenValid) {
    return (
      <>
        <Toaster position="top-right" />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white rounded-xl border border-yellow-200 shadow-sm">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            ⚠ Token expiré
          </span>
          {data.expiresAt && (
            <p className="text-xs text-sage-400 font-sans">
              Expiré le {formatDateTime(data.expiresAt)}
            </p>
          )}
          <a
            href="/api/admin/google-oauth"
            className="
              ml-auto inline-flex items-center gap-1.5 text-xs font-medium font-sans px-3 py-1.5
              rounded-lg bg-orange-500 text-white border border-orange-500
              hover:bg-orange-600 hover:border-orange-600
              focus:outline-none focus:ring-2 focus:ring-orange-400
              transition-colors
            "
          >
            Reconnecter
          </a>
        </div>
      </>
    );
  }

  // Not connected
  return (
    <>
      <Toaster position="top-right" />
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white rounded-xl border border-red-200 shadow-sm">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          ✗ Google Calendar déconnecté
        </span>
        <p className="text-xs text-sage-500 font-sans">
          Action requise pour créer des rendez-vous avec lien Meet
        </p>
        <a
          href="/api/admin/google-oauth"
          className="
            ml-auto inline-flex items-center gap-1.5 text-xs font-medium font-sans px-3 py-1.5
            rounded-lg bg-red-500 text-white border border-red-500
            hover:bg-red-600 hover:border-red-600
            focus:outline-none focus:ring-2 focus:ring-red-400
            transition-colors
          "
        >
          Autoriser l'accès
        </a>
      </div>
    </>
  );
}

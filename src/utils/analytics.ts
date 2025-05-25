type EventParams = Record<string, string | boolean>;
import ReactGA from "react-ga4";

export class Analytics {
  private static initialized = false;

  static init() {
    if (this.initialized) return;

    // Load Google Analytics script
    ReactGA.initialize(import.meta.env.VITE_GA_ID);

    /* const script = document.createElement("script");
    script.src = `https://www.googletagmanager.com/gtag/js?id=${
      import.meta.env.VITE_GA_ID
    }`;
    script.async = true;
    document.head.appendChild(script);

    // Initialize dataLayer
    window.dataLayer = window.dataLayer || [];
    function gtag(...args: any[]) {
      window.dataLayer.push(args);
    }
    gtag("js", new Date());
    gtag("config", import.meta.env.VITE_GA_ID, {
      send_page_view: true,
      cookie_domain: "omf-therapie.fr",
    }); */

    this.initialized = true;
  }

  static trackEvent(eventName: string, params: EventParams = {}) {
    /*  if (!window.gtag) return;
    window.gtag("event", eventName, params); */
    ReactGA.event(
      {
        category: "evennt",
        action: eventName,
      },
      params
    );
  }

  static trackFormSubmission(
    formId: string,
    formName: string,
    success: boolean
  ) {
    this.trackEvent("form_submission", {
      form_id: formId,
      form_name: formName,
      success: success,
    });
  }

  static trackBookingClick(
    type: "online" | "consultation",
    location: string,
    buttonText: string
  ) {
    const eventName =
      type === "online" ? "book_online_appointment" : "book_consultation";
    this.trackEvent(eventName, {
      button_location: location,
      button_text: buttonText,
    });
  }
}

// Add type definitions for window object
declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

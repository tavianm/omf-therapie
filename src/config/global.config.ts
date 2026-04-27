import { Instagram } from "lucide-react";

export const SITE_URL = "https://omf-therapie.fr";
export const OWNER_IMAGE = `${SITE_URL}/assets/about/oriane-montabonnet-1.webp`;
export const GBP_PROFILE_URL = "https://share.google/mt9nTqAMN3F713joZ";

export const COMPANY_NAME = "Oriane Montabonnet";
export const COMPANY_DESCRIPTION =
  "Thérapeute professionnelle dédiée à votre bien-être et à votre développement personnel.";

export const SOCIAL_LINKS = [
  {
    name: "Instagram",
    label: "@omf.therapie",
    url: "https://www.instagram.com/omf.therapie",
    ariaLabel: "Suivez-moi sur Instagram",
    icon: Instagram,
  },
];

export const CONTACT_INFO = {
  phone: "06 50 33 18 53",
  phoneE164: "+33650331853",
  email: "contact@omf-therapie.fr",
  address: "1086 Av. Albert Einstein, 34000 Montpellier",
};

export const BUSINESS_HOURS = {
  days: "Lundi - Vendredi",
  hours: [
    { start: "8h", end: "12h" },
    { start: "14h", end: "19h" },
  ],
};

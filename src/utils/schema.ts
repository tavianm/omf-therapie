import { BlogPost } from "../types/blog";
import {
  COMPANY_NAME,
  CONTACT_INFO,
  SOCIAL_LINKS,
  BUSINESS_HOURS,
  SITE_URL,
  OWNER_IMAGE,
  GBP_PROFILE_URL,
  GEO_COORDINATES,
} from "../config/global.config";

export interface FAQItem {
  question: string;
  answer: string;
}

const SAME_AS = [...SOCIAL_LINKS.map((l) => l.url), GBP_PROFILE_URL];

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  février: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  août: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  décembre: "12",
};

function parseFrenchDate(frenchDate: string): string {
  const fallback = new Date().toISOString().split("T")[0];
  const parts = frenchDate.trim().split(" ");
  if (parts.length !== 3) return fallback;
  const [day, monthName, year] = parts;
  const month = FRENCH_MONTHS[monthName.toLowerCase()];
  if (!month) return fallback;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

export function buildLocalBusinessSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "HealthAndBeautyBusiness",
    name: COMPANY_NAME,
    url: SITE_URL,
    telephone: CONTACT_INFO.phoneE164,
    email: CONTACT_INFO.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: "1086 Av. Albert Einstein",
      addressLocality: "Montpellier",
      postalCode: "34000",
      addressCountry: "FR",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: GEO_COORDINATES.latitude,
      longitude: GEO_COORDINATES.longitude,
    },
    openingHoursSpecification: BUSINESS_HOURS.hours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: h.start.replace("h", ":00"),
      closes: h.end.replace("h", ":00"),
    })),
    image: OWNER_IMAGE,
    sameAs: SAME_AS,
  };
}

export function buildPersonSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: COMPANY_NAME,
    jobTitle: "Psychopraticienne",
    url: SITE_URL,
    image: OWNER_IMAGE,
    worksFor: {
      "@type": "HealthAndBeautyBusiness",
      name: COMPANY_NAME,
      url: SITE_URL,
    },
    hasCredential: [
      {
        "@type": "EducationalOccupationalCredential",
        credentialCategory: "Formation TCCE",
        recognizedBy: {
          "@type": "Organization",
          name: "Institut de formation en psychothérapie",
        },
      },
    ],
    alumniOf: [
      {
        "@type": "EducationalOrganization",
        name: "Formation en Thérapies Comportementales, Cognitives et Émotionnelles (TCCE)",
      },
    ],
    knowsAbout: [
      "Thérapie individuelle",
      "Thérapie de couple",
      "Thérapie familiale",
      "Troubles alimentaires",
      "Gestion de l'anxiété",
      "Développement personnel",
    ],
    sameAs: SAME_AS,
  };
}

export function buildArticleSchema(post: BlogPost): Record<string, unknown> {
  const datePublished = parseFrenchDate(post.date);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished,
    dateModified: datePublished,
    wordCount: Math.round(post.content.length / 5),
    url: `${SITE_URL}/blog/${post.slug}`,
    image: post.imageUrl ?? OWNER_IMAGE,
    author: {
      "@type": "Person",
      name: post.author.name,
    },
    publisher: {
      "@type": "Organization",
      name: COMPANY_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: "https://omf-therapie.fr/assets/logo.png",
      },
    },
  };
}

export function buildServiceSchema(
  serviceName: string,
  description: string,
  url: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: serviceName,
    description,
    url,
    provider: {
      "@type": "HealthAndBeautyBusiness",
      name: COMPANY_NAME,
      url: SITE_URL,
      telephone: CONTACT_INFO.phoneE164,
      address: {
        "@type": "PostalAddress",
        streetAddress: "1086 Av. Albert Einstein",
        addressLocality: "Montpellier",
        postalCode: "34000",
        addressCountry: "FR",
      },
    },
  };
}

export function buildFAQSchema(faqs: FAQItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export const FAQ_ITEMS: FAQItem[] = [
  {
    question:
      "Où se situe le cabinet d'Oriane Montabonnet, thérapeute à Montpellier ?",
    answer:
      "Mon cabinet est situé au 1086 Avenue Albert Einstein, 34000 Montpellier, facilement accessible depuis Castelnau-le-Lez, Lattes, Pérols et les communes voisines.",
  },
  {
    question:
      "Comment prendre rendez-vous chez Oriane Montabonnet, thérapeute à Montpellier ?",
    answer:
      "Vous pouvez me contacter par téléphone au 06 50 33 18 53 ou via le formulaire de contact sur omf-therapie.fr.",
  },
  {
    question:
      "Quelles thérapies sont proposées à Montpellier par Oriane Montabonnet ?",
    answer:
      "Je propose des accompagnements individuels, de couple et familiaux à Montpellier, incluant la gestion du stress, de l'anxiété, le développement personnel et le bien-être émotionnel.",
  },
  {
    question: "Quels sont les tarifs d'une séance de thérapie à Montpellier ?",
    answer:
      "Les tarifs varient selon le type de séance. Consultez la page Tarifs sur omf-therapie.fr pour connaître les honoraires en vigueur.",
  },
  {
    question:
      "Oriane Montabonnet accompagne-t-elle les patients de Castelnau-le-Lez, Lattes, Pérols et des communes voisines ?",
    answer:
      "Oui, mon cabinet de Montpellier est facilement accessible depuis Castelnau-le-Lez, Lattes, Pérols, Juvignac, Grabels et Clapiers.",
  },
  {
    question:
      "La thérapie individuelle à Montpellier est-elle remboursée par la sécurité sociale ?",
    answer:
      "Mes séances ne sont pas remboursées par la Sécurité sociale. Certaines mutuelles proposent cependant une prise en charge partielle — renseignez-vous auprès de la vôtre.",
  },
];

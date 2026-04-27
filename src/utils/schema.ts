import { BlogPost } from "../types/blog";

export interface FAQItem {
  question: string;
  answer: string;
}

const SITE_URL = "https://omf-therapie.fr";
const OWNER_NAME = "Oriane Montabonnet";
const OWNER_IMAGE = `${SITE_URL}/assets/about/oriane-montabonnet-1.webp`;
const SAME_AS = [
  "https://www.instagram.com/omf.therapie",
  "https://share.google/mt9nTqAMN3F713joZ",
];

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
  const parts = frenchDate.trim().split(" ");
  if (parts.length !== 3) return frenchDate;
  const [day, monthName, year] = parts;
  const month = FRENCH_MONTHS[monthName.toLowerCase()];
  if (!month) return frenchDate;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

export function buildLocalBusinessSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: OWNER_NAME,
    url: SITE_URL,
    telephone: "06 50 33 18 53",
    email: "contact@omf-therapie.fr",
    address: {
      "@type": "PostalAddress",
      streetAddress: "1086 Av. Albert Einstein",
      addressLocality: "Montpellier",
      postalCode: "34000",
      addressCountry: "FR",
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "08:00",
        closes: "12:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "14:00",
        closes: "19:00",
      },
    ],
    image: OWNER_IMAGE,
    sameAs: SAME_AS,
  };
}

export function buildPersonSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: OWNER_NAME,
    jobTitle: "Thérapeute",
    url: SITE_URL,
    image: OWNER_IMAGE,
    worksFor: {
      "@type": "LocalBusiness",
      name: OWNER_NAME,
      url: SITE_URL,
    },
    sameAs: SAME_AS,
  };
}

export function buildArticleSchema(post: BlogPost): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: parseFrenchDate(post.date),
    url: `${SITE_URL}/blog/${post.slug}`,
    image: post.imageUrl ?? OWNER_IMAGE,
    author: {
      "@type": "Person",
      name: post.author.name,
    },
    publisher: {
      "@type": "Organization",
      name: OWNER_NAME,
      url: SITE_URL,
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
      "Le cabinet est situé au 1086 Avenue Albert Einstein, 34000 Montpellier, facilement accessible depuis Castelnau-le-Lez, Lattes, Pérols et les communes voisines.",
  },
  {
    question:
      "Comment prendre rendez-vous chez Oriane Montabonnet, thérapeute à Montpellier ?",
    answer:
      "Vous pouvez contacter Oriane Montabonnet par téléphone au 06 50 33 18 53 ou via le formulaire de contact sur le site omf-therapie.fr.",
  },
  {
    question:
      "Quelles thérapies sont proposées à Montpellier par Oriane Montabonnet ?",
    answer:
      "Oriane Montabonnet propose des accompagnements individuels, de couple et familiaux à Montpellier, incluant la gestion du stress, de l'anxiété, le développement personnel et le bien-être émotionnel.",
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
      "Oui, le cabinet de Montpellier est facilement accessible depuis Castelnau-le-Lez, Lattes, Pérols, Juvignac, Grabels et Clapiers.",
  },
  {
    question:
      "La thérapie individuelle à Montpellier est-elle remboursée par la sécurité sociale ?",
    answer:
      "Les séances avec Oriane Montabonnet ne sont pas remboursées par la Sécurité sociale. Certaines mutuelles proposent cependant une prise en charge partielle — renseignez-vous auprès de la vôtre.",
  },
];

import { FooterLink } from "../types/footer-links";

export const BUSINESS_HOURS = {
  days: "Lundi - Vendredi",
  hours: [
    { start: "8h", end: "10h" },
    { start: "15h30", end: "19h" },
  ],
};

export const QUICK_LINKS: FooterLink[] = [
  { name: "Accueil", href: "#home", path: "/" },
  { name: "À Propos", href: "#about", path: "/" },
  { name: "Services", href: "#services", path: "/" },
  { name: "Contact", href: "/contact", path: "/contact" },
  {
    name: "Prendre rendez-vous",
    href: "https://hellocare.com/psychopraticien/montpellier/montabonnet-oriane",
    external: true,
    path: "/",
  },
];


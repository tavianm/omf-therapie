import { FooterLink } from "../types/footer-links";



export const QUICK_LINKS: FooterLink[] = [
  { name: "Accueil", href: "/#home", path: "/" },
  { name: "Blog", href: "/blog", path: "/blog" },
  { name: "Contact", href: "/contact", path: "/contact" },
  { name: "Accessibilité: non conforme", href: "/accessibilite", path: "/accessibilite" },
  {
    name: "Prendre rendez-vous",
    href: "https://www.psychologue.net/cabinets/oriane-montabonnet",
    external: true,
    path: "/",
  },
];

import { useMemo } from "react";
import type { NavigationItem } from "../../types/navigation";

export const useNavigationItems = () => {
  return useMemo<NavigationItem[]>(
    () => [
      { name: "Accueil", href: "#home", path: "/" },
      { name: "À Propos", href: "#about", path: "/" },
      { name: "Domaines d'Expertise", href: "#services", path: "/" },
      { name: "Processus", href: "#process", path: "/" },
      { name: "Formations", href: "#qualifications", path: "/" },
      { name: "Tarifs", href: "#pricing", path: "/" },
      { name: "Blog", href: "/blog", path: "/blog", page: true },
      { name: "Contact", href: "/contact", path: "/contact", page: true },
      {
        name: "RDV en ligne",
        href: "https://hellocare.com/psychopraticien/montpellier/montabonnet-oriane",
        external: true,
        path: "/",
      },
    ],
    []
  );
};
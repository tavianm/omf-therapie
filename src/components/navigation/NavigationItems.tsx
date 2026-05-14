import { useMemo } from "react";
import type { NavigationItem } from "../../types/navigation";

export const useNavigationItems = () => {
  return useMemo<NavigationItem[]>(
    () => [
      { name: "Accueil", href: "#home", path: "/" },
      { name: "À propos", href: "/a-propos/", path: "/a-propos/", page: true },
      { name: "Domaines d'Expertise", href: "/services/", path: "/services/", page: true },
      { name: "Tarifs", href: "#pricing", path: "/" },
      { name: "Blog", href: "/blog/", path: "/blog/", page: true },
      { name: "Contact", href: "/contact/", path: "/contact/", page: true },
      {
        name: "Prendre RDV",
        href: "/rendez-vous/",
        path: "/rendez-vous/",
        page: true,
      },
    ],
    []
  );
};

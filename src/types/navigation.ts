export interface NavigationItem {
  name: string;
  href: string;
  path: string;
  external?: boolean;
  page?: boolean
}

export interface NavbarProps {
  className?: string;
  isHomePage?: boolean;
  /** Hint serveur : passer `true` quand la session est connue côté SSR */
  isAuthenticated?: boolean;
}

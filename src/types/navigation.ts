export interface NavigationItem {
  name: string;
  href: string;
  path: string;
  external?: boolean;
}

export interface NavbarProps {
  className?: string;
}

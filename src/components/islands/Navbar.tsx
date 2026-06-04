import { memo, useCallback, useEffect, useState } from 'react';
import { useScrollToSection } from '../../hooks/useScrollToSection';
import type { NavbarProps } from '../../types/navigation';
import { DesktopNav } from '../navigation/DesktopNav';
import { Logo } from '../navigation/Logo';
import { MobileNav } from '../navigation/MobileNav';
import { useNavigationItems } from '../navigation/NavigationItems';

function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  if (pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

const Navbar = memo(
  ({
    className = '',
    isHomePage: isHomePageProp,
    isAuthenticated: isAuthenticatedProp,
  }: NavbarProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeSection, setActiveSection] = useState('home');
    const [isAuthenticated, setIsAuthenticated] = useState(
      // SSR et hydration initiale : toujours false pour matcher le HTML serveur
      () => isAuthenticatedProp ?? false,
    );
    const navigation = useNavigationItems();
    const hellocareBtn = navigation.find((item) => item.external);
    const { scrollToSection } = useScrollToSection({});

    const isHomePage =
      isHomePageProp !== undefined
        ? isHomePageProp
        : typeof window !== 'undefined' && window.location.pathname === '/';

    // Après hydration : lire localStorage et corriger si besoin
    useEffect(() => {
      if (isAuthenticatedProp !== undefined) return;
      const stored = window.localStorage.getItem('omf-admin-auth') === '1';
      if (stored) setIsAuthenticated(true);
    }, []); // ← run once after mount

    const [pathname, setPathname] = useState('/');
    useEffect(() => {
      setPathname(normalizePathname(window.location.pathname));
    }, []);

    // Détection côté client si le hint serveur n'est pas fourni.
    // En cas de 429/réponse non-OK, on conserve l'état actuel pour éviter les clignotements UI.
    useEffect(() => {
      if (isAuthenticatedProp !== undefined) return;
      fetch('/api/auth/get-session/', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
        .then((r) => (r.ok ? r.json() : undefined))
        .then((data: { session?: unknown } | null | undefined) => {
          if (data === undefined) return;
          const nextAuth = !!data?.session;
          setIsAuthenticated(nextAuth);
          if (nextAuth) {
            window.localStorage.setItem('omf-admin-auth', '1');
          } else {
            window.localStorage.removeItem('omf-admin-auth');
          }
        })
        .catch(() => {});
    }, [isAuthenticatedProp]);

    const handleScroll = useCallback(() => {
      if (isHomePage) {
        const sections = navigation
          .filter((item) => item.path === '/' && item.href.startsWith('#'))
          .map((item) => item.href.substring(1));

        const scrollPosition = window.scrollY + 100;

        const currentSection = sections.find((section) => {
          const element = document.getElementById(section);
          if (element) {
            const { offsetTop, offsetHeight } = element;
            return (
              scrollPosition >= offsetTop &&
              scrollPosition < offsetTop + offsetHeight
            );
          }
          return false;
        });

        if (currentSection) setActiveSection(currentSection);
      }
    }, [isHomePage, navigation]);

    useEffect(() => {
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

    const navigateToSection = useCallback(
      (href: string) => {
        const sectionId = href.substring(1);
        if (!isHomePage) {
          window.location.href = `/#${sectionId}`;
        } else {
          scrollToSection(sectionId);
        }
        setIsOpen(false);
      },
      [isHomePage, scrollToSection],
    );

    const isActive = useCallback(
      (href: string, path: string) => {
        const normalizedPath = normalizePathname(path);
        if (normalizedPath === '/rendez-vous')
          return pathname === '/rendez-vous';
        if (normalizedPath === '/blog') return pathname.startsWith('/blog');
        return pathname === '/' && activeSection === href.substring(1);
      },
      [pathname, activeSection],
    );

    return (
      <header
        className={`bg-white shadow-sm fixed top-0 w-full z-50 ${className}`}
      >
        <nav
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
          role="navigation"
          aria-label="Navigation principale"
        >
          <div className="flex justify-between h-20">
            <Logo />
            <DesktopNav
              navigation={navigation}
              isActive={isActive}
              navigateToSection={navigateToSection}
              isAuthenticated={isAuthenticated}
              pathname={pathname}
            />
            <MobileNav
              navigation={navigation}
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              isActive={isActive}
              navigateToSection={navigateToSection}
              hellocareBtn={hellocareBtn}
              isAuthenticated={isAuthenticated}
            />
          </div>
        </nav>
      </header>
    );
  },
);

Navbar.displayName = 'Navbar';
export default Navbar;

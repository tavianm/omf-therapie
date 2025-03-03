import { memo, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useScrollToSection } from "../hooks/useScrollToSection";
import type { NavbarProps } from "../types/navigation";
import { DesktopNav } from "./navigation/DesktopNav";
import { Logo } from "./navigation/Logo";
import { MobileNav } from "./navigation/MobileNav";
import { useNavigationItems } from "./navigation/NavigationItems";

const Navbar = memo(({ className = "" }: NavbarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigationItems();
  const hellocareBtn = navigation.find((item) => item.external);

  // Utiliser notre hook personnalisé pour le défilement avec des options adaptées
  const { scrollToSection } = useScrollToSection(undefined, {});

  const handleScroll = useCallback(() => {
    if (location.pathname === "/") {
      const sections = navigation
        .filter((item) => item.path === "/")
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

      if (currentSection) {
        setActiveSection(currentSection);
      }
    }
  }, [location.pathname, navigation]);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const navigateToSection = useCallback(
    async (href: string) => {
      const sectionId = href.substring(1);

      if (location.pathname !== "/") {
        await navigate("/");
        // Attendre que la navigation soit terminée avant de défiler
        // Utiliser un délai plus long pour s'assurer que le contenu est chargé
        setTimeout(() => {
          scrollToSection(sectionId);
        }, 100);
      } else {
        scrollToSection(sectionId);
      }
      setIsOpen(false);
    },
    [location.pathname, navigate, scrollToSection]
  );

  const isActive = useCallback(
    (href: string, path: string) => {
      if (path === "/contact") {
        return location.pathname === "/contact";
      }
      return location.pathname === "/" && activeSection === href.substring(1);
    },
    [location.pathname, activeSection]
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
          />
          <MobileNav
            navigation={navigation}
            isOpen={isOpen}
            setIsOpen={setIsOpen}
            isActive={isActive}
            navigateToSection={navigateToSection}
            hellocareBtn={hellocareBtn}
          />
        </div>
      </nav>
    </header>
  );
});

Navbar.displayName = "Navbar";

export default Navbar;


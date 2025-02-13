import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { NavbarProps } from "../types/navigation";
import { DesktopNav } from "./navigation/DesktopNav";
import { Logo } from "./navigation/Logo";
import { MobileNav } from "./navigation/MobileNav";
import { useNavigationItems } from "./navigation/NavigationItems";

const Navbar = ({ className = "" }: NavbarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigationItems();
  const hellocareBtn = navigation.find((item) => item.external);

  useEffect(() => {
    if (location.pathname === "/") {
      const handleScroll = () => {
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
      };

      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, [location.pathname, navigation]);

  const navigateToSection = async (href: string) => {
    if (location.pathname !== "/") {
      await navigate("/");
      setTimeout(() => {
        scrollToSection(href);
      }, 100);
    } else {
      scrollToSection(href);
    }
    setIsOpen(false);
  };

  const scrollToSection = (href: string) => {
    const element = document.getElementById(href.substring(1));
    if (element) {
      const offset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
    }
  };

  const isActive = (href: string, path: string) => {
    if (path === "/contact") {
      return location.pathname === "/contact";
    }
    return location.pathname === "/" && activeSection === href.substring(1);
  };

  return (
    <header className={`bg-white shadow-sm fixed w-full z-50 ${className}`}>
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
};

export default Navbar;

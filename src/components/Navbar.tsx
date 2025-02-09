import { Leaf, Menu, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const location = useLocation();
  const navigate = useNavigate();

  const navigation = useMemo(
    () => [
      { name: "Accueil", href: "#home", path: "/" },
      { name: "À Propos", href: "#about", path: "/" },
      { name: "Domaines d'Expertise", href: "#services", path: "/" },
      { name: "Processus", href: "#process", path: "/" },
      { name: "Formations", href: "#qualifications", path: "/" },
      { name: "Tarifs", href: "#pricing", path: "/" },
      { name: "Contact", href: "/contact", path: "/contact" },
      {
        name: "RDV en ligne",
        href: "https://hellocare.com/psychopraticien/montpellier/montabonnet-oriane",
        external: true,
        path: "/",
      },
    ],
    []
  );

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
      }, 100);
    } else {
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
    }
    setIsOpen(false);
  };

  const isActive = (href: string, path: string) => {
    if (path === "/contact") {
      return location.pathname === "/contact";
    }
    return location.pathname === "/" && activeSection === href.substring(1);
  };

  const hellocareBtn = navigation.find((item) => item.external);

  return (
    <header className="bg-white shadow-sm fixed w-full z-50">
      <nav
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
        role="navigation"
        aria-label="Navigation principale"
      >
        <div className="flex justify-between h-20 pr-3">
          <div className="flex items-center">
            <Link
              to="../"
              className="flex items-center"
              aria-label="Accueil Oriane Montabonnet"
            >
              <Leaf className="h-8 w-8 text-mint-600" aria-hidden="true" />
              <span className="ml-2 text-xl font-serif font-medium text-sage-800">
                Oriane Montabonnet
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex md:items-center md:space-x-8">
            {navigation.map((item) =>
              item.external ? (
                <a
                  key={item.name}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-mint-600 hover:text-mint-700 font-medium px-4 py-2 rounded-md bg-mint-50"
                >
                  {item.name}
                </a>
              ) : item.path === "/contact" ? (
                <Link
                  key={item.name}
                  to={"../" + item.href}
                  className={`${
                    isActive(item.href, item.path)
                      ? "text-mint-600"
                      : "text-sage-600 hover:text-mint-500"
                  } transition-colors duration-200 font-medium min-h-[44px] min-w-[44px] flex items-center justify-center`}
                  aria-current={
                    isActive(item.href, item.path) ? "page" : undefined
                  }
                >
                  {item.name}
                </Link>
              ) : (
                <button
                  key={item.name}
                  onClick={() => navigateToSection(item.href)}
                  className={`${
                    isActive(item.href, item.path)
                      ? "text-mint-600"
                      : "text-sage-600 hover:text-mint-500"
                  } transition-colors duration-200 font-medium min-h-[44px] min-w-[44px] flex items-center justify-center`}
                  aria-current={
                    isActive(item.href, item.path) ? "page" : undefined
                  }
                >
                  {item.name}
                </button>
              )
            )}
          </div>

          {/* Mobile Navigation Button */}
          <div className="flex items-center lg:hidden">
            {hellocareBtn && (
              <a
                key={hellocareBtn.name}
                href={hellocareBtn.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-mint-600 text-center hover:text-mint-700 font-medium block px-4 py-2 bg-mint-50"
                role="menuitem"
              >
                {hellocareBtn.name}
              </a>
            )}
          </div>
          <div className="flex items-center lg:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="text-sage-500 hover:text-sage-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-expanded={isOpen}
              aria-controls="mobile-menu"
              aria-label={isOpen ? "Fermer le menu" : "Ouvrir le menu"}
            >
              {isOpen ? (
                <X className="h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="h-6 w-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation Menu */}
      {isOpen && (
        <div
          className="lg:hidden"
          id="mobile-menu"
          role="menu"
          aria-label="Menu mobile"
        >
          <div className="pt-2 pb-4 space-y-1">
            {navigation.map((item) =>
              item.external ? (
                <></>
              ) : item.path === "/contact" ? (
                <Link
                  key={item.name}
                  to={"../" + item.href}
                  className={`${
                    isActive(item.href, item.path)
                      ? "bg-mint-50 text-mint-600"
                      : "text-sage-600 hover:bg-sage-50"
                  } block px-4 py-2 text-base font-medium min-h-[44px] flex items-center`}
                  onClick={() => setIsOpen(false)}
                  role="menuitem"
                  aria-current={
                    isActive(item.href, item.path) ? "page" : undefined
                  }
                >
                  {item.name}
                </Link>
              ) : (
                <button
                  key={item.name}
                  onClick={() => navigateToSection(item.href)}
                  className={`${
                    isActive(item.href, item.path)
                      ? "bg-mint-50 text-mint-600"
                      : "text-sage-600 hover:bg-sage-50"
                  } block px-4 py-2 text-base font-medium min-h-[44px] flex items-center`}
                  role="menuitem"
                  aria-current={
                    isActive(item.href, item.path) ? "page" : undefined
                  }
                >
                  {item.name}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;


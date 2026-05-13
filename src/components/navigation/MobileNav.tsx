import { Menu, X } from "lucide-react";
import type { NavigationItem } from "../../types/navigation";

interface MobileNavProps {
  navigation: NavigationItem[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  isActive: (href: string, path: string) => boolean;
  navigateToSection: (href: string) => void;
  hellocareBtn?: NavigationItem;
  isAuthenticated?: boolean;
}

export const MobileNav = ({
  navigation,
  isOpen,
  setIsOpen,
  isActive,
  navigateToSection,
  hellocareBtn,
  isAuthenticated = false,
}: MobileNavProps) => (
  <div className="flex items-center lg:hidden max-[412px]:gap-2 max-sm:gap-4 gap-6">
    {hellocareBtn && (
      <a
        href={hellocareBtn.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-mint-600 text-center hover:text-mint-700 font-medium block max-[412px]:px-2 px-4 py-2 bg-mint-50"
      >
        {hellocareBtn.name}
      </a>
    )}
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

    {isOpen && (
      <div
        className="lg:hidden absolute top-20 left-0 right-0 bg-white shadow-lg z-50"
        id="mobile-menu"
        role="menu"
        aria-label="Menu mobile"
      >
        <div
          className="overflow-auto space-y-1 py-1"
          style={{ maxHeight: "calc(100vh - 5.7rem)" }}
        >
          {navigation.map((item) =>
            item.external ? null : item.page ? (
              <a
                key={item.name}
                href={item.href}
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
              </a>
            ) : (
              <button
                key={item.name}
                onClick={() => navigateToSection(item.href)}
                className={`${
                  isActive(item.href, item.path)
                    ? "bg-mint-50 text-mint-600"
                    : "text-sage-600 hover:bg-sage-50"
                } block px-4 py-2 text-base font-medium min-h-[44px] flex items-center w-full text-left`}
                role="menuitem"
                aria-current={
                  isActive(item.href, item.path) ? "page" : undefined
                }
              >
                {item.name}
              </button>
            )
          )}
          {isAuthenticated && (
            <a
              href="/mes-rdvs"
              className={`${
                typeof window !== "undefined" &&
                window.location.pathname === "/mes-rdvs"
                  ? "bg-mint-50 text-mint-600"
                  : "text-sage-600 hover:bg-sage-50"
              } block px-4 py-2 text-base font-medium min-h-[44px] flex items-center`}
              onClick={() => setIsOpen(false)}
              role="menuitem"
            >
              Mes RDV
            </a>
          )}
        </div>
      </div>
    )}
  </div>
);

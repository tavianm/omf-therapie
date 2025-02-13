import { Link } from "react-router-dom";
import type { NavigationItem } from "../../types/navigation";

interface DesktopNavProps {
  navigation: NavigationItem[];
  isActive: (href: string, path: string) => boolean;
  navigateToSection: (href: string) => Promise<void>;
}

export const DesktopNav = ({
  navigation,
  isActive,
  navigateToSection,
}: DesktopNavProps) => (
  <div className="hidden lg:flex md:items-center md:space-x-8">
    {navigation.map((item) =>
      item.external ? (
        <ExternalLink key={item.name} item={item} />
      ) : item.path === "/contact" ? (
        <ContactLink key={item.name} item={item} isActive={isActive} />
      ) : (
        <SectionLink
          key={item.name}
          item={item}
          isActive={isActive}
          navigateToSection={navigateToSection}
        />
      )
    )}
  </div>
);

const ExternalLink = ({ item }: { item: NavigationItem }) => (
  <a
    href={item.href}
    target="_blank"
    rel="noopener noreferrer"
    className="text-mint-600 hover:text-mint-700 font-medium px-4 py-2 rounded-md bg-mint-50"
  >
    {item.name}
  </a>
);

const ContactLink = ({
  item,
  isActive,
}: {
  item: NavigationItem;
  isActive: (href: string, path: string) => boolean;
}) => (
  <Link
    to={"../" + item.href}
    className={`${
      isActive(item.href, item.path)
        ? "text-mint-600"
        : "text-sage-600 hover:text-mint-500"
    } transition-colors duration-200 font-medium min-h-[44px] min-w-[44px] flex items-center justify-center`}
    aria-current={isActive(item.href, item.path) ? "page" : undefined}
  >
    {item.name}
  </Link>
);

const SectionLink = ({
  item,
  isActive,
  navigateToSection,
}: {
  item: NavigationItem;
  isActive: (href: string, path: string) => boolean;
  navigateToSection: (href: string) => Promise<void>;
}) => (
  <button
    onClick={() => navigateToSection(item.href)}
    className={`${
      isActive(item.href, item.path)
        ? "text-mint-600"
        : "text-sage-600 hover:text-mint-500"
    } transition-colors duration-200 font-medium min-h-[44px] min-w-[44px] flex items-center justify-center`}
    aria-current={isActive(item.href, item.path) ? "page" : undefined}
  >
    {item.name}
  </button>
);

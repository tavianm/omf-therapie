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
  <ul
    className="hidden lg:flex md:items-center xl:space-x-8 lg:space-x-4"
    role="list"
  >
    {navigation.map((item) => (
      <li key={item.name} role="listitem">
        {item.external ? (
          <ExternalLink item={item} />
        ) : item.page ? (
          <ContactLink item={item} isActive={isActive} />
        ) : (
          <SectionLink
            item={item}
            isActive={isActive}
            navigateToSection={navigateToSection}
          />
        )}
      </li>
    ))}
  </ul>
);

const ExternalLink = ({ item }: { item: NavigationItem }) => (
  <a
    href={item.href}
    target="_blank"
    rel="noopener noreferrer"
    className="block text-mint-600 text-center hover:text-mint-700 font-medium px-4 py-2 rounded-md bg-mint-50"
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

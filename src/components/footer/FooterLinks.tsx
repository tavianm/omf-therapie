import { Link, useLocation } from "react-router-dom";
import { QUICK_LINKS } from "../../config/footer.config";
import { useScrollToSection } from "../../hooks/useScrollToSection";
import { FooterHeading } from "../common/FooterHeading";

export const FooterLinks = () => {
  const { scrollToSection } = useScrollToSection(undefined, {});
  const location = useLocation();

  return <nav aria-label="Navigation du pied de page">
    <FooterHeading>Liens Rapides</FooterHeading>
    <ul className="space-y-2" role="list">
      {QUICK_LINKS.map((link) => (
        <li role="listitem" key={link.name}>
          {link.external ? (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sage-300 hover:text-mint-400 transition-colors"
              aria-label={`${link.name} (s'ouvre dans un nouvel onglet)`}
            >
              {link.name}
            </a>
          ) : link.path !== "/" ? (
            <Link
              to={link.href}
              className="text-sage-300 hover:text-mint-400 transition-colors"
            >
              {link.name}
            </Link>
          ) : (
            <Link
              to={link.href}
              className="text-sage-300 hover:text-mint-400 transition-colors"
              onClick={(e) => {
                if (location.pathname === '/') {
                  e.preventDefault();
                  const sectionId = link.href.substring(2);
                  scrollToSection(sectionId);
                }
              }}
            >
              {link.name}
            </Link>
          )}
        </li>
      ))}
    </ul>
  </nav>
}
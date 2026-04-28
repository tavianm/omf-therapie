import { QUICK_LINKS } from "../../config/footer.config";
import { useScrollToSection } from "../../hooks/useScrollToSection";
import { FooterHeading } from "../common/FooterHeading";

export const FooterLinks = () => {
  const { scrollToSection } = useScrollToSection({});
  const linkClass =
    "text-sage-300 hover:text-mint-400 hover:underline transition-colors";

  return (
    <nav aria-label="Navigation du pied de page">
      <FooterHeading>Liens Rapides</FooterHeading>
      <ul className="space-y-3" role="list">
        {QUICK_LINKS.map((link) => (
          <li role="listitem" key={link.name}>
            {link.external ? (
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
                aria-label={`${link.name} (s'ouvre dans un nouvel onglet)`}
              >
                {link.name}
              </a>
            ) : link.path !== "/" ? (
              <a href={link.href} className={linkClass}>
                {link.name}
              </a>
            ) : (
              <a
                href={link.href}
                className={linkClass}
                onClick={(e) => {
                  if (window.location.pathname === "/") {
                    e.preventDefault();
                    // href is "/#section" — extract section id after "/#"
                    const sectionId = link.href.substring(2);
                    scrollToSection(sectionId);
                  }
                }}
              >
                {link.name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
};

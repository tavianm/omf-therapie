import { Link } from "react-router-dom";
import { QUICK_LINKS } from "../../config/footer.config";
import { FooterHeading } from "../common/FooterHeading";

export const FooterLinks = () => (
  <nav aria-label="Navigation du pied de page">
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
          ) : link.path === "/contact" ? (
            <Link
              to={link.href}
              className="text-sage-300 hover:text-mint-400 transition-colors"
            >
              {link.name}
            </Link>
          ) : (
            <a
              href={link.href}
              className="text-sage-300 hover:text-mint-400 transition-colors"
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(link.href.substring(1))
                  ?.scrollIntoView({ behavior: "smooth" });
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


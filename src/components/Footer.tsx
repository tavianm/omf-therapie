import { Instagram, Leaf, Mail, MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="bg-sage-800 text-sage-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <Link to="/" className="flex items-center">
              <Leaf className="h-6 w-6 text-mint-400" />
              <span className="ml-2 text-lg font-serif font-medium">
                Oriane Montabonnet
              </span>
            </Link>
            <p className="text-sage-300 text-sm">
              Thérapeute professionnelle dédiée à votre bien-être et à votre
              développement personnel.
            </p>
            {/* Ajout des réseaux sociaux */}
            <div className="flex items-center gap-4 pt-2">
              <a
                href="https://www.instagram.com/omf.therapie"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sage-300 hover:text-mint-400 transition-colors"
                aria-label="Suivez-moi sur Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-lg font-medium mb-4">Contact</h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-2 text-sage-300">
                <Phone className="h-4 w-4" />
                <span>06 50 33 18 53</span>
              </li>
              <li className="flex items-center gap-2 text-sage-300">
                <Mail className="h-4 w-4" />
                <span>contact@omf-therapie.fr</span>
              </li>
              <li className="flex items-center gap-2 text-sage-300">
                <MapPin className="h-4 w-4" />
                <span>185 cour Messier, Montpellier</span>
              </li>
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-lg font-medium mb-4">Liens Rapides</h3>
            <ul className="space-y-2">
              {[
                { name: "Accueil", href: "#home", path: "/" },
                { name: "À Propos", href: "#about", path: "/" },
                { name: "Services", href: "#services", path: "/" },
                { name: "Contact", href: "/contact", path: "/contact" },
                {
                  name: "Prendre rendez-vous",
                  href: "https://hellocare.com/psychopraticien/montpellier/montabonnet-oriane",
                  external: true,
                },
              ].map((link) => (
                <li key={link.name}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sage-300 hover:text-mint-400 transition-colors"
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
          </div>

          {/* Hours */}
          <div>
            <h3 className="text-lg font-medium mb-4">Horaires</h3>
            <ul className="space-y-2 text-sage-300">
              <li>Lundi - Vendredi </li>
              <li>8h - 10h</li>
              <li>15h30 - 19h</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-sage-700 text-center text-sage-400 text-sm">
          <p>
            © {new Date().getFullYear()} Oriane Montabonnet. Tous droits
            réservés.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;


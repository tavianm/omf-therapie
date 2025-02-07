import React from 'react';
import { Link } from 'react-router-dom';
import { Leaf, Phone, Mail, MapPin } from 'lucide-react';

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
                Claire Martin
              </span>
            </Link>
            <p className="text-sage-300 text-sm">
              Psychothérapeute professionnelle dédiée à votre bien-être et à votre développement personnel.
            </p>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-lg font-medium mb-4">Contact</h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-2 text-sage-300">
                <Phone className="h-4 w-4" />
                <span>01 23 45 67 89</span>
              </li>
              <li className="flex items-center gap-2 text-sage-300">
                <Mail className="h-4 w-4" />
                <span>contact@clairemartin.fr</span>
              </li>
              <li className="flex items-center gap-2 text-sage-300">
                <MapPin className="h-4 w-4" />
                <span>123 rue de la Paix, Paris</span>
              </li>
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-lg font-medium mb-4">Liens Rapides</h3>
            <ul className="space-y-2">
              {[
                { name: 'Accueil', href: '/' },
                { name: 'À Propos', href: '/about' },
                { name: 'Services', href: '/services' },
                { name: 'Contact', href: '/contact' },
              ].map((link) => (
                <li key={link.name}>
                  <Link
                    to={link.href}
                    className="text-sage-300 hover:text-mint-400 transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Hours */}
          <div>
            <h3 className="text-lg font-medium mb-4">Horaires</h3>
            <ul className="space-y-2 text-sage-300">
              <li>Lundi - Vendredi: 9h - 19h</li>
              <li>Samedi: 9h - 13h</li>
              <li>Dimanche: Fermé</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-sage-700 text-center text-sage-400 text-sm">
          <p>© {new Date().getFullYear()} Claire Martin. Tous droits réservés.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
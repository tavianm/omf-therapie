import { FooterBrand } from "./footer/FooterBrand";
import { FooterContact } from "./footer/FooterContact";
import { FooterHours } from "./footer/FooterHours";
import { FooterLinks } from "./footer/FooterLinks";

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-sage-800 text-sage-100" role="contentinfo">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4 pt-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <FooterBrand />
          <FooterContact />
          <FooterLinks />
          <FooterHours />
        </div>
        <div className="mt-8 pt-4 border-t border-sage-700 text-center text-sage-300 text-sm">
          <span>©{currentYear} Oriane Montabonnet. Tous droits réservés.</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;


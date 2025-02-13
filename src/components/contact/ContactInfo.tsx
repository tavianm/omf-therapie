import { Clock, Mail, MapPin, Phone } from "lucide-react";
import {
  COMPANY_NAME,
  CONTACT_INFO,
  SOCIAL_LINKS,
} from "../../config/global.config";

export const ContactInfo = () => (
  <div>
    <h3 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
      Informations de Contact
    </h3>
    <div className="space-y-4">
      <ContactItem
        icon={Phone}
        text={CONTACT_INFO.phone}
        href={`tel:${CONTACT_INFO.phone.replace(/\s/g, "")}`}
      />
      <ContactItem
        icon={Mail}
        text={CONTACT_INFO.email}
        href={`mailto:${CONTACT_INFO.email}`}
      />
      {SOCIAL_LINKS.map((link) => (
        <ContactItem icon={link.icon} text={link.label} href={link.url} />
      ))}
      <ContactItem
        icon={MapPin}
        text="Espace Pitot, 186 Pl. Jacques Mirouze, Montpellier"
        href={`https://www.google.com/maps/search/${COMPANY_NAME} ${CONTACT_INFO.address}`}
      />
      <ContactItem
        icon={Clock}
        text={
          <div>
            <p>Lundi - Vendredi</p>
            <p>8h - 10h</p>
            <p>15h30 - 19h</p>
          </div>
        }
      />
    </div>
  </div>
);

interface ContactItemProps {
  icon: React.FC<{ className?: string }>;
  text: React.ReactNode;
  href?: string;
}

const ContactItem = ({ icon: Icon, text, href }: ContactItemProps) => {
  const content = (
    <div className="flex items-center gap-4">
      <Icon className="h-5 w-5 text-mint-600" />
      <span className="text-sage-600">{text}</span>
    </div>
  );

  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-mint-500 flex items-center gap-4 transition-colors"
    >
      {content}
    </a>
  ) : (
    content
  );
};


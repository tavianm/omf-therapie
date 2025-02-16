import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { Toaster } from "react-hot-toast";
import {
  COMPANY_NAME,
  CONTACT_INFO,
  SOCIAL_LINKS,
} from "../../config/global.config";
import { useClipboard } from "../../hooks/useClipboard";
import { ClassNames, ContactItem } from "../common/ContactItem";

export const ContactInfo = () => {
  const { copyToClipboard } = useClipboard();
  const classNames: ClassNames = {
    containerClass: "hover:text-mint-500 gap-4",
    textClass: "text-sage-600",
    iconClass: "text-mint-600 ",
  };

  return (
    <div>
      <Toaster position="bottom-center" />
      <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
        Informations de Contact
      </h2>
      <div className="space-y-4">
        <ContactItem
          icon={Phone}
          text={CONTACT_INFO.phone}
          classNames={classNames}
          onClick={() =>
            copyToClipboard(
              CONTACT_INFO.phone,
              "Numéro de télephone copié",
              "Impossible de copier le numéro"
            )
          }
          aria-label={`Copier le numéro de téléphone`}
        />
        <ContactItem
          icon={Mail}
          text={CONTACT_INFO.email}
          classNames={classNames}
          onClick={() =>
            copyToClipboard(
              CONTACT_INFO.email,
              "Email copié ",
              "Impossible de copier l'email"
            )
          }
          aria-label="Copier l'email"
        />
        {SOCIAL_LINKS.map((link) => (
          <div key={link.name}>
            <ContactItem
              icon={link.icon}
              text={link.label}
              href={link.url}
              ariaLabel={link.ariaLabel}
              classNames={classNames}
            />
          </div>
        ))}
        <ContactItem
          icon={MapPin}
          text={CONTACT_INFO.address}
          classNames={classNames}
          href={`https://www.google.com/maps/search/${COMPANY_NAME} ${CONTACT_INFO.address}`}
          aria-label={`Ouvrir la carte à ${COMPANY_NAME} ${CONTACT_INFO.address}`}
        />
        <ContactItem
          icon={Clock}
          classNames={classNames}
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
};


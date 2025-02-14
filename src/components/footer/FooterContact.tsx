import { Mail, MapPin, Phone } from "lucide-react";
import { Toaster } from "react-hot-toast";
import { COMPANY_NAME, CONTACT_INFO } from "../../config/global.config";
import { useClipboard } from "../../hooks/useClipboard";
import { ClassNames, ContactItem } from "../common/ContactItem";
import { FooterHeading } from "../common/FooterHeading";

export const FooterContact = () => {
  const { copyToClipboard } = useClipboard();
  const classNames: ClassNames = {
    containerClass: "gap-2 text-sage-300 hover:text-mint-400",
  };

  return (
    <div>
      <Toaster position="bottom-center" />
      <FooterHeading>Contact</FooterHeading>
      <ul
        className="space-y-3"
        role="list"
        aria-label="Informations de contact"
      >
        <li role="listitem" key="phone">
          <ContactItem
            icon={Phone}
            text={CONTACT_INFO.phone}
            onClick={() =>
              copyToClipboard(
                CONTACT_INFO.phone,
                "Numéro de télephone copié",
                "Impossible de copier le numéro"
              )
            }
            aria-label={`Copier le numéro de téléphone`}
            classNames={classNames}
          />
        </li>
        <li role="listitem" key="email">
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
        </li>
        <li role="listitem" key="map">
          <ContactItem
            icon={MapPin}
            text={CONTACT_INFO.address}
            classNames={classNames}
            href={`https://www.google.com/maps/search/${COMPANY_NAME} ${CONTACT_INFO.address}`}
            aria-label={`Ouvrir la carte à ${COMPANY_NAME} ${CONTACT_INFO.address}`}
          />
        </li>
      </ul>
    </div>
  );
};


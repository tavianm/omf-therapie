import { Mail, MapPin, Phone } from "lucide-react";
import { COMPANY_NAME, CONTACT_INFO } from "../../config/global.config";
import { FooterHeading } from "../common/FooterHeading";

export const FooterContact = () => (
  <div>
    <FooterHeading>Contact</FooterHeading>
    <ul className="space-y-3" role="list" aria-label="Informations de contact">
      <li role="listitem" key="phone">
        <a
          href={`tel:${CONTACT_INFO.phone.replace(/\s/g, "")}`}
          className="flex items-center gap-2 text-sage-300 hover:text-mint-400 transition-colors"
          aria-label={`Appeler le ${CONTACT_INFO.phone}`}
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          <span>{CONTACT_INFO.phone}</span>
        </a>
      </li>
      <li role="listitem" key="email">
        <a
          href={`mailto:${CONTACT_INFO.email}`}
          className="flex items-center gap-2 text-sage-300 hover:text-mint-400 transition-colors"
          aria-label={`Envoyer un email à ${CONTACT_INFO.email}`}
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
          <span>{CONTACT_INFO.email}</span>
        </a>
      </li>
      <li role="listitem" key="map">
        <a
          href={`https://www.google.com/maps/search/${COMPANY_NAME} ${CONTACT_INFO.address}`}
          target="_blank"
          className="flex items-center gap-2 text-sage-300 hover:text-mint-400 transition-colors"
          aria-label={`Ouvrir la carte à ${COMPANY_NAME} ${CONTACT_INFO.address}`}
        >
          <MapPin
            className="min-h-4 min-w-4 h-4 w-4 my-auto"
            aria-hidden="true"
          />
          <span>{CONTACT_INFO.address}</span>
        </a>
      </li>
    </ul>
  </div>
);


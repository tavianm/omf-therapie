import { Leaf } from "lucide-react";
import {
  COMPANY_DESCRIPTION,
  COMPANY_NAME,
  SOCIAL_LINKS,
} from "../../config/global.config";
import { ClassNames, ContactItem } from "../common/ContactItem";

export const FooterBrand = () => {
  const classNames: ClassNames = {
    containerClass:
      "gap-2 text-sage-300 hover:text-mint-400 hover:underline transition-colors",
  };
  return (
    <div className="space-y-4" role="group" aria-label="Marque">
      <div className="flex items-center gap-2">
        <Leaf
          className="h-6 w-6 text-mint-400  transition-colors"
          aria-label="leaf"
        />
        <span className="text-lg font-serif font-medium  transition-colors">
          {COMPANY_NAME}
        </span>
      </div>
      <p className="text-sage-300 text-sm">{COMPANY_DESCRIPTION}</p>
      <ul
        className="flex items-center gap-4 pt-2"
        role="list"
        aria-label="Réseaux sociaux"
      >
        {SOCIAL_LINKS.map((link) => (
          <li role="listitem" key={link.name}>
            <ContactItem
              icon={link.icon}
              text={link.label}
              href={link.url}
              ariaLabel={link.ariaLabel}
              classNames={classNames}
            />
          </li>
        ))}
      </ul>
    </div>
  );
};

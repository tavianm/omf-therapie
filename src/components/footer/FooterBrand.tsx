import { Leaf } from "lucide-react";
import {
  COMPANY_DESCRIPTION,
  COMPANY_NAME,
  SOCIAL_LINKS,
} from "../../config/global.config";

export const FooterBrand = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Leaf className="h-6 w-6 text-mint-400  transition-colors" />
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
        <li role="listitem">
          {SOCIAL_LINKS.map((link) => (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sage-300 hover:text-mint-400 transition-colors flex items-center gap-2 "
              aria-label={`Suivez-moi sur ${link.name}`}
            >
              <link.icon className="h-5 w-5" aria-hidden="true" />
              <span>{link.label}</span>
            </a>
          ))}
        </li>
      </ul>
    </div>
  );
};


import { BUSINESS_HOURS } from "../../config/footer.config";
import { FooterHeading } from "../common/FooterHeading";

export const FooterHours = () => (
  <div>
    <FooterHeading>Horaires</FooterHeading>
    <div className="space-y-2 text-sage-300 ">
      <div>{BUSINESS_HOURS.days}</div>
      <ul role="list" aria-label="Horaires d'ouverture">
        {BUSINESS_HOURS.hours.map((hour, hourIndex) => (
          <li role="listitem" key={hourIndex}>
            {hour.start} - {hour.end}
          </li>
        ))}
      </ul>
    </div>
  </div>
);


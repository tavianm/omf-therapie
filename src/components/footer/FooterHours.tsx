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
    <div className="mt-4">
      <a
        rel="nofollow"
        href="https://www.psychologue.net/cabinets/montabonnet-oriane?utm_source=448100&utm_medium=widget&utm_campaign=widget-company_stamp"
        target="_blank"
      >
        <img
          src="https://www.psychologue.net/stamp.xpng?com=448100&v=10"
          alt="Montabonnet Oriane"
          width="175px"
        />
      </a>
    </div>
  </div>
);


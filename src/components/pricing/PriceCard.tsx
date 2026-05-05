import parse from "html-react-parser";
import { Check } from "lucide-react";

interface PriceCardProps {
  title: string;
  priceDetails: Array<{ price: string; duration: string }>;
  features: string[];
  index: number;
}

export const PriceCard = ({
  title,
  priceDetails,
  features,
  index,
}: PriceCardProps) => {
  return (
    <div className="bg-white p-8 rounded-lg shadow-sm hover:shadow-md transition-shadow">
      <h3 className="text-3xl font-serif font-semibold text-sage-800 mb-4">
        {title}
      </h3>
      {priceDetails?.map((detail, priceIndex, array) => (
        <div
          key={`${index}-${priceIndex}`}
          className={
            "flex items-baseline " +
            (priceIndex > 0
              ? "mb-6"
              : array.length === 1
              ? "my-10 pb-1"
              : "mb-1")
          }
        >
          <span className="text-4xl font-serif font-semibold text-mint-600">
            {detail.price}
          </span>
          <span className="text-sage-600 ml-2">/ {detail.duration}</span>
        </div>
      ))}
      <ul className="space-y-4">
        {features.map((feature, featureIndex) => (
          <li
            key={`${index}-feature-${featureIndex}`}
            className="flex items-center gap-3"
          >
            <Check className="h-5 w-5 text-mint-600" />
            <span className="text-sage-600">{feature && parse(feature)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

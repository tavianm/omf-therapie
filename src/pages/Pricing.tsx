import { motion } from "framer-motion";
import { CommitmentSection } from "../components/pricing/CommitmentSection";
import { CTASection } from "../components/pricing/CTASection";
import { PaymentInfo } from "../components/pricing/PaymentInfo";
import { PriceCard } from "../components/pricing/PriceCard";
import { useMotionVariants } from "../hooks/useMotionVariants";

const Pricing = () => {
  const { fadeInUp } = useMotionVariants();

  const prices = [
    {
      title: "Thérapie Individuelle",
      priceDetails: [
        { price: "50€", duration: "60 minutes" },
        { price: "65€", duration: "90 minutes" },
      ],
      features: [
        "Suivi personnalisé",
        "Séance en cabinet",
        "Téléconsultation",
        "1<sup>re</sup> séance => -25€",
      ],
    },
    {
      title: "Thérapie conjugale",
      priceDetails: [
        { price: "70€", duration: "60 minutes" },
        { price: "85€", duration: "90 minutes" },
      ],
      features: [
        "Médiation relationnelle",
        "Séance en cabinet",
        "Téléconsultation",
        "1<sup>re</sup> séance => -25€",
      ],
    },
    {
      title: "Thérapie familiale",
      priceDetails: [
        { price: "80€", duration: "60 minutes" },
        { price: "95€", duration: "90 minutes" },
      ],
      features: [
        "Suivi personnalisé",
        "Médiation relationnelle",
        "Séance en cabinet",
        "1<sup>re</sup> séance => -25€",
      ],
    },
    {
      title: "Tarifs solidaires",
      priceDetails: [{ price: "-15€", duration: "séance" }],
      duration: "5 x 50 minutes",
      features: [
        "RSA / ASS / Etudiant",
        "Avec justificatif",
        "Séance en cabinet",
        "Téléconsultation",
      ],
    },
  ];

  return (
    <div className="py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...fadeInUp()} className="text-center mb-10">
          <h2 className="section-title">Tarifs des Consultations</h2>
          <p className="section-subtitle">
            Des tarifs transparents adaptés à vos besoins
          </p>
        </motion.div>

        <div className="grid xl:grid-cols-4 sm:grid-cols-2 gap-8">
          {prices.map((price, index) => (
            <PriceCard key={index} {...price} index={index} />
          ))}
        </div>

        <PaymentInfo />
        <CommitmentSection />
        <CTASection />
      </div>
    </div>
  );
};

export default Pricing;


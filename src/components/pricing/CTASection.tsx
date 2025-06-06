import { motion } from "framer-motion";
import { useMotionVariants } from "../../hooks/useMotionVariants";
import { Analytics } from "../../utils/analytics";

export const CTASection = () => {
  const { fadeIn } = useMotionVariants();

  const handleBookingClick = () => {
    Analytics.trackBookingClick(
      "consultation",
      "pricing_section",
      "Réserver une consultation"
    );
  };

  return (
    <motion.div
      {...fadeIn()}
      className="mt-10 bg-white p-8 rounded-lg shadow-sm text-center"
    >
      <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-4">
        Prêt à commencer ?
      </h2>
      <p className="text-sage-600 max-w-3xl mx-auto mb-6">
        Réservez votre consultation en ligne et commencez votre parcours vers le
        mieux-être.
      </p>
      <a
        href="https://www.psychologue.net/cabinets/oriane-montabonnet"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary"
        onClick={handleBookingClick}
      >
        Réserver une consultation
      </a>
    </motion.div>
  );
};

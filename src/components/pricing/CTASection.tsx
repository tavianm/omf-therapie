import { motion } from "framer-motion";
import { useMotionVariants } from "../../hooks/useMotionVariants";

export const CTASection = () => {
  const { fadeIn } = useMotionVariants();

  return (
    <motion.div
      {...fadeIn()}
      className="mt-5 md:mt-10 bg-white p-8 rounded-lg shadow-sm text-center"
    >
      <h3 className="text-3xl font-serif font-semibold text-sage-800 mb-4">
        Prêt à commencer ?
      </h3>
      <p className="text-sage-600 max-w-3xl mx-auto mb-6">
        Réservez votre consultation en ligne et commencez votre parcours vers le
        mieux-être.
      </p>
      <a
        href="https://www.psychologue.net/cabinets/oriane-montabonnet"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary"
        aria-label="Réserver une consultation"
      >
        Réserver une consultation
      </a>
    </motion.div>
  );
};

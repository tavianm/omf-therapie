import { motion } from "framer-motion";
import { useMotionVariants } from "../../hooks/useMotionVariants";

export const CommitmentSection = () => {
  const { fadeIn } = useMotionVariants();

  return (
    <motion.div
      {...fadeIn()}
      className="mt-10 bg-white p-8 rounded-lg shadow-sm text-center"
    >
      <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-4">
        Engagement et responsabilité
      </h2>
      <p className="text-sage-600 max-w-3xl mx-auto">
        Comme 95% de nos patients, nous comptons sur votre présence au
        rendez-vous prévu.
      </p>

      <p className="text-sage-600 max-w-3xl mx-auto my-4">
        Si vous ne pouvez pas honorer votre consultation, merci de bien vouloir
        : Annuler votre rendez-vous au moins 4 heures à l'avance Utiliser notre
        système en ligne ou nous contacter directement Votre geste permettra à
        un autre patient en attente de bénéficier de ce créneau.
      </p>
      <p className="text-sage-600 max-w-3xl mx-auto">
        Nous vous remercions pour votre compréhension et votre collaboration.
      </p>
    </motion.div>
  );
};


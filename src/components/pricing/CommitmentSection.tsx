import { motion } from "framer-motion";
import { useMotionVariants } from "../../hooks/useMotionVariants";

export const CommitmentSection = () => {
  const { fadeIn } = useMotionVariants();

  return (
    <motion.div
      {...fadeIn()}
      className="mt-5 md:mt-10 bg-white p-8 rounded-lg shadow-sm text-center "
    >
      <h3 className="text-3xl font-serif font-semibold text-sage-800 mb-4">
        Engagement et responsabilité
      </h3>
      <section className="text-sage-600 max-w-3xl mx-auto space-y-2">
        <p>
          Comme 95% de mes patients, je compte sur votre présence au rendez-vous
          prévu.
        </p>

        <p>
          Si vous ne pouvez pas honorer votre consultation, merci de bien
          vouloir annuler votre rendez-vous au moins 4 heures à l'avance en
          utilisant le système en ligne ou en me contactant directement.
        </p>
        <p>
          Votre geste permettra à un autre patient en attente de bénéficier de
          ce créneau.
        </p>
        <p>Je vous remercie pour votre compréhension et votre collaboration.</p>
      </section>
    </motion.div>
  );
};

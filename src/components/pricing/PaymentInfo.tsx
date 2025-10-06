import { motion } from "framer-motion";
import { useMotionVariants } from "../../hooks/useMotionVariants";

export const PaymentInfo = () => {
  const { fadeIn } = useMotionVariants();

  return (
    <motion.div
      {...fadeIn()}
      className="mt-5 md:mt-10 grid sm:grid-cols-2 sm:gap-4 xl:gap-8"
    >
      <div className="bg-sage-50 p-8 rounded-lg">
        <h3 className="text-3xl font-serif font-semibold text-sage-800 mb-6">
          Modalités de Paiement
        </h3>
        <ul className="space-y-4 text-sage-600">
          <li>Paiement par carte bancaire</li>
          <li>Paiement en espèces</li>
          <li>Règlement à chaque séance</li>
          <li>Facture fournie sur demande</li>
        </ul>
      </div>

      <div className="bg-sage-50 p-8 rounded-lg">
        <h3 className="text-3xl font-serif font-semibold text-sage-800 mb-6">
          Remboursements
        </h3>
        <div className="space-y-4 text-sage-600">
          <p>
            Les consultations peuvent être partiellement prises en charge par
            certaines mutuelles. N'hésitez pas à vous renseigner auprès de votre
            organisme complémentaire.
          </p>
          <p>
            Une facture détaillée vous sera fournie, sur demande, pour faciliter
            vos démarches de remboursement.
          </p>
        </div>
      </div>
    </motion.div>
  );
};

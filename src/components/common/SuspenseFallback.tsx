import { motion } from "framer-motion";
import { Leaf } from "lucide-react";

export const SuspenseFallback = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <motion.div
          animate={{
            rotate: 360,
            scale: [1, 1.1, 1],
          }}
          transition={{
            rotate: { duration: 2, repeat: Infinity, ease: "linear" },
            scale: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
          }}
          className="inline-block mb-6"
        >
          <Leaf className="h-12 w-12 text-mint-600" />
        </motion.div>
        <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-3">
          Chargement en cours
        </h2>
        <p className="text-sage-600">Merci de patienter un instant...</p>
      </motion.div>
    </div>
  );
};

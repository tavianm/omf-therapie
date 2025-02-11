import { motion } from "framer-motion";
import { GraduationCap } from "lucide-react";

const Qualifications = () => {
  const qualifications = [
    {
      year: "2021",
      title: "Licence en Psychologie",
      institution: "Université de Nîmes",
      description: "Formation aux fondamentaux de la psychologie",
    },
    {
      year: "2022",
      title: "Certification aux thérapies conjugales et familiales",
      institution: "Centre de formation - Ifort",
      description: "Spécialisation en thérapies conjugales et familiales",
    },
    {
      year: "2024",
      title: "Formation nutrition et psyché",
      institution: "Centre de Formation à Distance",
      description: "Etude de l'impact de l'alimentation sur la santé mentale",
    },
  ];

  return (
    <div className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h2 className="section-title">Formations et Qualifications</h2>
          <p className="section-subtitle">
            Un parcours académique et professionnel riche au service de votre
            bien-être
          </p>
        </motion.div>

        <div className="grid md:grid-cols-6 gap-12">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="md:col-span-4 md:col-start-2"
          >
            <div className="flex items-center gap-4 mb-8">
              <GraduationCap className="h-8 w-8 text-mint-600" />
              <h3 className="text-2xl font-serif font-semibold text-sage-800">
                Parcours Académique & Certifications
              </h3>
            </div>
            <div className="space-y-8 ">
              {qualifications.map((qual, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="bg-white p-6 rounded-lg shadow-sm"
                >
                  <div className="text-mint-600 font-medium mb-2">
                    {qual.year}
                  </div>
                  <h4 className="text-xl font-serif font-semibold text-sage-800 mb-2">
                    {qual.title}
                  </h4>
                  <div className="text-sage-600 mb-2">{qual.institution}</div>
                  <p className="text-sage-500 text-sm">{qual.description}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Qualifications;

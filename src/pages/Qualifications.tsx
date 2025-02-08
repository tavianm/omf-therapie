import { motion } from "framer-motion";
import { Award, BookOpen, GraduationCap } from "lucide-react";

const Qualifications = () => {
  const qualifications = [
    {
      year: "2010",
      title: "Doctorat en Psychologie Clinique",
      institution: "Université Paris Descartes",
      description: "Spécialisation en thérapies comportementales et cognitives",
    },
    {
      year: "2007",
      title: "Master en Psychologie",
      institution: "Université Paris Diderot",
      description: "Mention très bien, spécialisation en psychopathologie",
    },
    {
      year: "2005",
      title: "Licence en Psychologie",
      institution: "Université Paris Nanterre",
      description: "Formation aux fondamentaux de la psychologie",
    },
  ];

  const certifications = [
    {
      title: "Thérapie Cognitive et Comportementale",
      institution: "Association Française de TCC",
      year: "2012",
    },
    {
      title: "Mindfulness et Méditation",
      institution: "Centre de Mindfulness de Paris",
      year: "2014",
    },
    {
      title: "Thérapie Systémique",
      institution: "Institut des Systèmes Humains",
      year: "2016",
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
          <h1 className="section-title">Formations et Qualifications</h1>
          <p className="section-subtitle">
            Un parcours académique et professionnel riche au service de votre
            bien-être
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-12">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="flex items-center gap-4 mb-8">
              <GraduationCap className="h-8 w-8 text-mint-600" />
              <h2 className="text-2xl font-serif font-semibold text-sage-800">
                Parcours Académique
              </h2>
            </div>
            <div className="space-y-8">
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
                  <h3 className="text-xl font-serif font-semibold text-sage-800 mb-2">
                    {qual.title}
                  </h3>
                  <div className="text-sage-600 mb-2">{qual.institution}</div>
                  <p className="text-sage-500 text-sm">{qual.description}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <div className="space-y-12">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <div className="flex items-center gap-4 mb-8">
                <Award className="h-8 w-8 text-mint-600" />
                <h2 className="text-2xl font-serif font-semibold text-sage-800">
                  Certifications
                </h2>
              </div>
              <div className="space-y-6">
                {certifications.map((cert, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="bg-white p-6 rounded-lg shadow-sm"
                  >
                    <div className="text-mint-600 font-medium mb-2">
                      {cert.year}
                    </div>
                    <h3 className="text-lg font-serif font-semibold text-sage-800 mb-2">
                      {cert.title}
                    </h3>
                    <div className="text-sage-600">{cert.institution}</div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <div className="flex items-center gap-4 mb-8">
                <BookOpen className="h-8 w-8 text-mint-600" />
                <h2 className="text-2xl font-serif font-semibold text-sage-800">
                  Formation Continue
                </h2>
              </div>
              <div className="bg-sage-50 p-6 rounded-lg">
                <p className="text-sage-600 mb-4">
                  Je maintiens mes connaissances à jour en participant
                  régulièrement à :
                </p>
                <ul className="space-y-3 text-sage-600">
                  <li className="flex items-center gap-2">
                    • Conférences internationales en psychothérapie
                  </li>
                  <li className="flex items-center gap-2">
                    • Ateliers de perfectionnement professionnel
                  </li>
                  <li className="flex items-center gap-2">
                    • Groupes de supervision entre pairs
                  </li>
                  <li className="flex items-center gap-2">
                    • Séminaires spécialisés
                  </li>
                </ul>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Qualifications;

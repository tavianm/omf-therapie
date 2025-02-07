import React from 'react';
import { motion } from 'framer-motion';

const About = () => {
  return (
    <div className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h1 className="section-title">À Propos de Moi</h1>
          <p className="section-subtitle">
            Psychothérapeute passionnée, je vous accompagne dans votre parcours vers le mieux-être
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-12 items-center mb-20">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <img
              src="https://images.unsplash.com/photo-1544717305-2782549b5136?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80"
              alt="Claire Martin - Psychothérapeute"
              className="rounded-lg shadow-lg w-full"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="space-y-6"
          >
            <h2 className="text-3xl font-serif font-semibold text-sage-800">
              Mon Parcours
            </h2>
            <p className="text-sage-600">
              Forte de plus de 15 années d'expérience dans l'accompagnement thérapeutique, 
              j'ai développé une approche holistique centrée sur l'individu. Mon parcours 
              académique en psychologie clinique, enrichi par diverses formations en thérapies 
              comportementales et cognitives, m'a permis de développer une expertise solide 
              dans le traitement de nombreuses problématiques.
            </p>
            <p className="text-sage-600">
              Ma philosophie de travail repose sur l'écoute active, l'empathie et 
              l'adaptation à chaque personne. Je crois profondément en la capacité de 
              chacun à évoluer et à s'épanouir, avec un accompagnement approprié.
            </p>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="bg-sage-50 p-8 rounded-lg"
        >
          <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6 text-center">
            Mes Valeurs
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Bienveillance",
                description: "Un accompagnement sans jugement, dans le respect de chaque individu."
              },
              {
                title: "Professionnalisme",
                description: "Une approche rigoureuse basée sur des méthodes éprouvées."
              },
              {
                title: "Engagement",
                description: "Un suivi personnalisé et adapté à vos besoins spécifiques."
              }
            ].map((value, index) => (
              <div key={index} className="text-center">
                <h3 className="text-xl font-serif font-semibold text-sage-800 mb-3">
                  {value.title}
                </h3>
                <p className="text-sage-600">{value.description}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default About;
import React from 'react';
import { motion } from 'framer-motion';
import { Clock, MessageCircle, Target, Sparkles } from 'lucide-react';

const Process = () => {
  const steps = [
    {
      icon: MessageCircle,
      title: "Premier Contact",
      description: "Un entretien téléphonique gratuit de 15 minutes pour échanger sur vos besoins."
    },
    {
      icon: Clock,
      title: "Première Séance",
      description: "Une séance d'une heure pour faire connaissance et définir ensemble vos objectifs."
    },
    {
      icon: Target,
      title: "Suivi Personnalisé",
      description: "Des séances régulières adaptées à votre rythme et vos besoins."
    },
    {
      icon: Sparkles,
      title: "Évolution",
      description: "Un accompagnement qui évolue avec vous jusqu'à l'atteinte de vos objectifs."
    }
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
          <h1 className="section-title">Le Processus Thérapeutique</h1>
          <p className="section-subtitle">
            Un accompagnement structuré et bienveillant pour votre développement personnel
          </p>
        </motion.div>

        <div className="relative">
          <div className="absolute top-0 left-1/2 h-full w-px bg-sage-200 hidden md:block" />
          
          <div className="space-y-12 relative">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className={`flex flex-col md:flex-row gap-8 ${
                  index % 2 === 0 ? 'md:pr-1/2' : 'md:pl-1/2 md:flex-row-reverse'
                }`}
              >
                <div className="flex-1">
                  <div className="bg-white p-8 rounded-lg shadow-sm">
                    <step.icon className="h-12 w-12 text-mint-600 mb-6" />
                    <h3 className="text-xl font-serif font-semibold text-sage-800 mb-4">
                      {step.title}
                    </h3>
                    <p className="text-sage-600">{step.description}</p>
                  </div>
                </div>
                <div className="hidden md:flex items-center justify-center w-12">
                  <div className="w-12 h-12 rounded-full bg-mint-600 flex items-center justify-center text-white font-semibold">
                    {index + 1}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="mt-20 bg-sage-50 p-8 rounded-lg"
        >
          <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6 text-center">
            Informations Pratiques
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-xl font-serif font-semibold text-sage-800 mb-4">
                Durée des Séances
              </h3>
              <p className="text-sage-600">
                Les séances durent généralement 50 minutes. La fréquence est adaptée 
                à vos besoins, généralement hebdomadaire au début puis espacée selon 
                votre évolution.
              </p>
            </div>
            <div>
              <h3 className="text-xl font-serif font-semibold text-sage-800 mb-4">
                Confidentialité
              </h3>
              <p className="text-sage-600">
                Toutes nos séances sont strictement confidentielles, dans le respect 
                du code de déontologie des psychothérapeutes.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Process;
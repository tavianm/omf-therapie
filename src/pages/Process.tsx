import { motion } from "framer-motion";
import { Clock, MessageCircle, Sparkles, Target } from "lucide-react";
import { useMotionVariants } from "../hooks/useMotionVariants";

const Process = () => {
  const { fadeInUp, fadeInRight, fadeInLeft, fadeIn } = useMotionVariants();
  const steps = [
    {
      icon: MessageCircle,
      title: "Comprendre et identifier vos besoins (Séance 1 à 2)",
      description:
        "Lors des premières séances, nous explorons ensemble ce qui vous amène, vos ressentis et les difficultés que vous rencontrez. L'objectif est de clarifier vos besoins et de poser des bases solides pour la suite de l'accompagnement.",
    },
    {
      icon: Clock,
      title:
        "Définir un plan d'action personnalisé (Fin de séance 1 ou séance 2)",
      description:
        "Une fois vos problématiques identifiées, nous élaborons un plan d'action adapté, avec des objectifs concrets et réalisables, afin de vous guider vers un mieux-être progressif et durable.",
    },
    {
      icon: Target,
      title: "Mettre en place des actions concrètes (Séance 3 à 4)",
      description:
        "À votre rythme, vous commencez à appliquer les outils et stratégies définis ensemble. Ces mises en pratique vous permettent d'observer les premiers changements et de renforcer votre évolution.",
    },
    {
      icon: Sparkles,
      title:
        "Ajuster et affiner votre cheminement (Séance 4 à 5 et au-delà si besoin)",
      description:
        "Nous faisons régulièrement le point sur votre progression afin d'ajuster les actions mises en place. Ce suivi vous assure un accompagnement dynamique, adapté à vos ressentis et vos avancées.",
    },
  ];

  return (
    <div className="py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...fadeInUp()} className="text-center mb-10">
          <h2 className="section-title">Le Processus Thérapeutique</h2>
          <p className="section-subtitle">
            Un accompagnement structuré et bienveillant pour votre développement
            personnel
          </p>
        </motion.div>

        <div className="relative">
          <div className="absolute top-0 left-1/2 h-full w-px bg-sage-200 hidden md:block" />

          <div className="space-y-12 relative">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                {...(index % 2 === 0 ? fadeInLeft() : fadeInRight())}
                className={`flex flex-col md:flex-row gap-8 ${
                  index % 2 === 0
                    ? "md:pr-1/2"
                    : "md:pl-1/2 md:flex-row-reverse"
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

        <motion.div {...fadeIn()} className="mt-10 bg-sage-50 p-8 rounded-lg">
          <h3 className="text-2xl font-serif font-semibold text-sage-800 mb-6 text-center">
            Informations Pratiques
          </h3>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h4 className="text-xl font-serif font-semibold text-sage-800 mb-4">
                Durée des Séances
              </h4>
              <p className="text-sage-600">
                Les séances durent généralement 60 à 90 minutes. La fréquence
                est adaptée à vos besoins, généralement hebdomadaire au début
                puis espacée selon votre évolution.
              </p>
            </div>
            <div>
              <h4 className="text-xl font-serif font-semibold text-sage-800 mb-4">
                Confidentialité
              </h4>
              <p className="text-sage-600">
                Toutes nos séances sont strictement confidentielles, dans le
                respect du code de déontologie des psychothérapeutes.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Process;


import { motion } from "framer-motion";
import { Apple, Brain, Users } from "lucide-react";
import { useMotionVariants } from "../hooks/useMotionVariants";

const Services = () => {
  const { fadeInUp, fadeIn } = useMotionVariants();

  const services = [
    {
      icon: Brain,
      title: "Problématiques personnelles",
      descriptions: [
        "Mal-être psychologique, perte de repères",
        "États dépressifs, tristesse persistante",
        "Anxiété, stress, angoisses envahissantes",
        "Hypersensibilité et gestion des émotions",
        "Difficultés à s'affirmer, peur du jugement",
        "Conflits internes, indécision, sentiment d'être bloqué(e)",
        "Manque de confiance et d'estime de soi",
      ],
    },
    {
      icon: Apple,
      title: "Problématiques alimentaires",
      descriptions: [
        "Alimentation émotionnelle, compulsions alimentaires",
        "Alimentation désordonnée, relation conflictuelle avec la nourriture",
        "Difficulté à perdre du poids ou à maintenir un équilibre alimentaire",
        "Troubles du comportement alimentaire (TCA)",
        "Rééquilibrage alimentaire et bien-être nutritionnel",
        "Mal-être physique lié à l'image de soi",
        "Dysmorphophobie (perception altérée de son corps)",
      ],
    },
    {
      icon: Users,
      title: "Problématiques conjugales & familiales",
      descriptions: [
        "Tensions et difficultés relationnelles",
        "Communication compliquée au sein du couple ou de la famille",
        "Problématiques sexuelles et intimes",
        "Conflits conjugaux ou familiaux récurrents",
        "Préparation à la parentalité, transition vers la vie de parent",
        "Événements bouleversants affectant le couple ou la famille",
        "Deuil et gestion des pertes au sein du cercle familial",
      ],
    },
  ];

  return (
    <div className="py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...fadeInUp()} className="text-center mb-10">
          <h2 className="section-title">Domaines d'Expertise</h2>
          <p className="section-subtitle">
            Une approche thérapeutique adaptée à vos besoins spécifiques
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <motion.div
              key={index}
              {...fadeInUp({ duration: 0.5, delay: index * 0.1 })}
              className="bg-white p-8 rounded-lg shadow-sm hover:shadow-md transition-shadow"
            >
              <service.icon className="h-12 w-12 text-mint-600 mb-6" />
              <h3 className="text-xl font-serif font-semibold text-sage-800 mb-4">
                {service.title}
              </h3>
              <ul className="list-disc pl-3">
                {service.descriptions?.map((description, index) => (
                  <li key={index} className="text-sage-600">
                    {description}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <motion.div
          {...fadeIn()}
          className="mt-10 bg-sage-50 p-8 rounded-lg text-center"
        >
          <h3 className="text-2xl font-serif font-semibold text-sage-800 mb-4">
            Une Approche Sur Mesure
          </h3>
          <p className="text-sage-600 max-w-3xl mx-auto">
            Chaque personne est unique, c'est pourquoi j'adapte mes méthodes et
            techniques thérapeutiques en fonction de vos besoins spécifiques.
            Mon approche intègre différentes modalités thérapeutiques pour vous
            offrir un accompagnement optimal.
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Services;


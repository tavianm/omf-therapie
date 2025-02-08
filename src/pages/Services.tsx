import { motion } from "framer-motion";
import { Brain, Coffee, Users } from "lucide-react";

const Services = () => {
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
      icon: Users,
      title: "Problématiques alimentaires & image corporelle",
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
      icon: Coffee,
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
    /* {
      icon: Heart,
      title: "Thérapie Individuelle",
      description: "Accompagnement personnalisé pour surmonter les difficultés personnelles et émotionnelles."
    },
    {
      icon: Sparkles,
      title: "Développement Personnel",
      description: "Accompagnement vers une meilleure connaissance de soi et de son potentiel."
    },
    {
      icon: Flower,
      title: "Bien-être au Travail",
      description: "Solutions pour améliorer l'équilibre vie professionnelle et personnelle."
    } */
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
          <h1 className="section-title">Domaines d'Expertise</h1>
          <p className="section-subtitle">
            Une approche thérapeutique adaptée à vos besoins spécifiques
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
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
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="mt-20 bg-sage-50 p-8 rounded-lg text-center"
        >
          <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-4">
            Une Approche Sur Mesure
          </h2>
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


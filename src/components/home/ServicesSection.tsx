import { motion } from "framer-motion";
import { Apple, Brain, Home, Users } from "lucide-react";
import { useMotionVariants } from "../../hooks/useMotionVariants";

interface Props {
  detailMode?: boolean;
}

const ServicesSection = ({ detailMode = false }: Props) => {
  const { fadeInUp, fadeIn } = useMotionVariants();

  const services = [
    {
      icon: Brain,
      title: "Problématiques personnelles",
      href: "/services/therapie-individuelle",
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
      href: "/services/troubles-alimentaires",
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
      title: "Problématiques conjugales",
      href: "/services/therapie-de-couple",
      descriptions: [
        "Communication difficile entre partenaires",
        "Conflits conjugaux récurrents ou rupture de confiance",
        "Problématiques sexuelles et intimes",
        "Jalousie, dépendance affective ou distance émotionnelle",
        "Crise de couple, séparation ou divorce en cours",
        "Projet de vie commun et prise de décision à deux",
        "Préparation à la parentalité, transition vers la vie de parent",
      ],
    },
    {
      icon: Home,
      title: "Thérapie familiale",
      href: "/services/therapie-familiale",
      descriptions: [
        "Tensions intergénérationnelles chroniques ou conflits durables",
        "Adolescents en crise ou en opposition avec les parents",
        "Familles recomposées en phase d'adaptation",
        "Deuil familial, maladie grave ou traumatisme partagé",
        "Conflits entre parents et enfants adultes",
        "Fratrie en conflit ou dynamique familiale dysfonctionnelle",
        "Annonce d'un diagnostic impactant toute la famille",
      ],
    },
  ];

  return (
    <div className="py-8 md:py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...fadeInUp()} className="text-center mb-8">
          <h2 className="section-title">Domaines d'Expertise</h2>
          <p className="section-subtitle">
            Une approche thérapeutique adaptée à vos besoins spécifiques
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 md:gap-8">
          {services.map((service, index) => (
            <motion.div
              key={index}
              {...fadeInUp({ duration: 0.5, delay: index * 0.1 })}
              className="bg-white p-8 rounded-lg shadow-sm hover:shadow-md transition-shadow"
            >
              <service.icon className="h-12 w-12 text-mint-600 mb-6" />
              <h3 className="text-3xl font-serif font-semibold text-sage-800 mb-4">
                {service.title}
              </h3>
              <ul className="list-disc pl-3 mb-6">
                {service.descriptions?.map((description, index) => (
                  <li key={index} className="text-sage-600">
                    {description}
                  </li>
                ))}
              </ul>
              <a
                href={detailMode ? service.href : "/services"}
                className="inline-flex items-center text-mint-600 hover:text-mint-700 font-medium transition-colors duration-200"
              >
                En savoir plus →
              </a>
            </motion.div>
          ))}
        </div>

        <motion.div
          {...fadeIn()}
          className="mt-5 md:mt-10 bg-sage-50 p-8 rounded-lg text-center"
        >
          <h3 className="text-3xl font-serif font-semibold text-sage-800 mb-4">
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

export default ServicesSection;

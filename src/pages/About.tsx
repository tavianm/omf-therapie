import { motion } from "framer-motion";

const getRandomNumber = () => Math.floor(Math.random() * 2) + 1;

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
            Thérapeute passionnée, je vous accompagne dans votre parcours vers
            le mieux-être
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
              src={`assets/about_${getRandomNumber()}.webp?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80`}
              alt="Oriane Montabonnet - Thérapeute"
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
              Ma Mission
            </h2>
            <p className="text-sage-600">
              Les émotions, les pensées et les relations façonnent notre
              équilibre intérieur. Parfois, elles deviennent sources de doutes,
              de tensions ou de souffrance. Vous n’avez pas à traverser cela
              seul(e).
            </p>
            <p className="text-sage-600">
              À travers la thérapie, je vous accompagne avec écoute et
              bienveillance pour vous aider à mieux comprendre ce que vous
              traversez et à retrouver un équilibre apaisé. Anxiété, estime de
              soi, troubles alimentaires, difficultés relationnelles… Chaque
              parcours est unique, et mon approche s’adapte à vos besoins, à
              votre rythme.
            </p>
            <p className="text-sage-600">
              Ici, vous trouverez un espace sécurisant, où vous pourrez déposer
              vos pensées, explorer des solutions concrètes et avancer vers une
              vie plus sereine et alignée avec vous-même.
            </p>
            <p className="text-sage-600">
              Vous méritez d’aller mieux. Si vous ressentez le besoin d’être
              accompagné(e), je serai ravie de vous guider sur ce chemin.
              N’hésitez pas à me contacter pour en savoir plus ou prendre
              rendez-vous.
            </p>
            <h2 className="text-3xl font-serif font-semibold text-sage-800">
              Mon Parcours
            </h2>
            <p className="text-sage-600">
              Passionnée par le bien-être psychologique, j’accompagne celles et
              ceux qui traversent des périodes de doute, d’émotions intenses ou
              de questionnements, en leur offrant un espace bienveillant pour
              mieux comprendre et apaiser ce qu’ils vivent.
            </p>
            <p className="text-sage-600">
              Diplômée en psychologie, spécialisée en TCCE, thérapie conjugale
              et familiale, ainsi qu’en nutrition et psyché, j’adopte une
              approche globale pour aider chacun à retrouver équilibre
              émotionnel, relations apaisées et bien-être physique.
            </p>
            <p className="text-sage-600">
              Mon objectif ? Vous aider à retrouver sérénité, confiance et
              harmonie, à travers des solutions adaptées à votre histoire et à
              vos besoins.
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
                description:
                  "Un accompagnement sans jugement, dans le respect de chaque individu.",
              },
              {
                title: "Professionnalisme",
                description:
                  "Une approche rigoureuse basée sur des méthodes éprouvées.",
              },
              {
                title: "Engagement",
                description:
                  "Un suivi personnalisé et adapté à vos besoins spécifiques.",
              },
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


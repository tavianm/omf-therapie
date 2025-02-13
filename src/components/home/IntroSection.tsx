import { motion } from "framer-motion";
import { useMotionVariants } from "../../hooks/useMotionVariants";

interface IntroFeature {
  title: string;
  description: string;
}

const features: IntroFeature[] = [
  {
    title: "Écoute Attentive",
    description:
      "Un espace sécurisant où vous pouvez vous exprimer librement, sans jugement.",
  },
  {
    title: "Approche Personnalisée",
    description:
      "Une thérapie adaptée à vos besoins spécifiques et à votre rythme.",
  },
  {
    title: "Accompagnement Global",
    description: "Une prise en charge holistique pour un mieux-être durable.",
  },
];

export const IntroSection = () => {
  const { fadeIn } = useMotionVariants();
  return (
    <section className="py-20 bg-white" aria-labelledby="intro-title">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...fadeIn()} className="text-center">
          <h2 id="intro-title" className="section-title">
            Bienvenue dans mon cabinet
          </h2>
          <p className="section-subtitle">
            Je vous accompagne dans votre cheminement personnel avec
            bienveillance et professionnalisme, pour vous aider à surmonter vos
            difficultés et retrouver un équilibre harmonieux.
          </p>
        </motion.div>

        <div className="mt-16 grid md:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <FeatureCard key={index} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
};

interface FeatureCardProps {
  feature: IntroFeature;
  index: number;
}

const FeatureCard = ({ feature, index }: FeatureCardProps) => {
  const { fadeInUp } = useMotionVariants();
  return (
    <motion.div
      {...fadeInUp({ duration: 0.5, delay: index * 0.2 })}
      className="bg-sage-50 p-8 rounded-lg"
    >
      <h3 className="text-xl font-serif font-semibold text-sage-800 mb-4">
        {feature.title}
      </h3>
      <p className="text-sage-600">{feature.description}</p>
    </motion.div>
  );
};


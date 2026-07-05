import { motion } from 'framer-motion';
import { ArrowRight, Calendar } from 'lucide-react';
import { useMotionVariants } from '../../hooks/useMotionVariants';

export const HeroSection = () => {
  const { fadeInUp } = useMotionVariants();
  return (
    <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <motion.div {...fadeInUp()} className="text-center text-white">
        <div className="inline-block mx-auto">
          <h1
            id="hero-title"
            className="text-5xl md:text-6xl font-serif font-semibold mb-6"
          >
            Oriane Montabonnet: Thérapeute à Montpellier
          </h1>
          <p className="text-xl md:text-2xl mb-8 max-w-3xl mx-auto">
            Votre partenaire pour un bien-être psychologique durable
          </p>
          <ul
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
            role="list"
          >
            <li role="listitem">
              <a
                href="/rendez-vous/"
                className="btn-primary"
                aria-label="Prendre rendez-vous"
              >
                <Calendar className="w-5 h-5" aria-hidden="true" />
                Prendre rendez-vous
              </a>
            </li>
            <li role="listitem" className="flex">
              <a
                href="#about"
                className="inline-flex items-center gap-2 text-white hover:underline transition-colors min-h-[44px] min-w-[44px] justify-center"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById('about')
                    ?.scrollIntoView({ behavior: 'smooth' });
                }}
                aria-label="En savoir plus sur mes services"
              >
                En savoir plus
                <ArrowRight className="w-5 h-5" aria-hidden="true" />
              </a>
            </li>
          </ul>
        </div>
      </motion.div>
    </div>
  );
};

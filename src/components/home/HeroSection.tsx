import { motion } from "framer-motion";
import { ArrowRight, Calendar } from "lucide-react";
import { Link } from "react-router-dom";
import { useMotionVariants } from "../../hooks/useMotionVariants";

export const HeroSection = () => {
  const { fadeInUp } = useMotionVariants();
  return (
    <section
      id="home"
      className="relative h-[60vh] min-h-[430px] flex items-center"
      aria-labelledby="hero-title"
    >
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <img
          src="assets/home/bien-etre-500w.avif"
          srcSet="assets/home/bien-etre-500w.avif 500w, 
                assets/home/bien-etre-800w.avif 800w, 
                assets/home/bien-etre-1200w.avif 1200w,
                assets/home/bien-etre-1920w.avif 1920w,
                assets/home/bien-etre-2850w.avif 2850w"
          sizes="100vw"
          alt="Femme en position de yoga"
          className="w-full h-full object-cover"
          loading="eager"
          decoding="async"
          fetchpriority="high"
          width="800"
          height="600"
        />
        <div className="absolute inset-0 bg-sage-900/40" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...fadeInUp()} className="text-center text-white">
          <h1
            id="hero-title"
            className="text-5xl md:text-6xl font-serif font-semibold mb-6"
          >
            Oriane Montabonnet: Thérapeute à Montpellier
          </h1>
          <p className="text-xl md:text-2xl mb-8 max-w-3xl mx-auto">
            Votre partenaire pour un bien-être psychologique durable
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="../contact"
              className="btn-primary"
              aria-label="Prendre rendez-vous"
            >
              <Calendar className="w-5 h-5" aria-hidden="true" />
              Prendre rendez-vous
            </Link>
            <a
              href="#about"
              className="inline-flex items-center gap-2 text-white hover:text-mint-200 transition-colors min-h-[44px] min-w-[44px] justify-center"
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById("about")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
              aria-label="En savoir plus sur mes services"
            >
              En savoir plus
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

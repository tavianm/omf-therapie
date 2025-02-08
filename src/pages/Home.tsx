import { motion } from "framer-motion";
import { ArrowRight, Calendar } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import SEO from "../components/SEO";
import About from "./About";
import Pricing from "./Pricing";
import Process from "./Process";
import Qualifications from "./Qualifications";
import Services from "./Services";

const Home = () => {
  useEffect(() => {
    // Préchargement de l'image héro
    const img = new Image();
    img.src =
      "https://images.unsplash.com/photo-1600618528240-fb9fc964b853?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=75";
  }, []);

  return (
    <>
      <SEO
        title="Oriane Montabonnet - Thérapeute à Montpellier | Accompagnement thérapeutique"
        description="Thérapeute professionnelle à Montpellier, Oriane Montabonnet vous accompagne dans votre développement personnel. Thérapie individuelle, gestion du stress et accompagnement personnalisé."
      />
      <div className="pt-20">
        {/* Hero Section */}
        <section
          id="home"
          className="relative h-[60vh] flex items-center"
          aria-labelledby="hero-title"
        >
          <div className="absolute inset-0 z-0" aria-hidden="true">
            <picture>
              <source
                srcSet="https://images.unsplash.com/photo-1600618528240-fb9fc964b853?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=75&fm=webp 800w, 
                        https://images.unsplash.com/photo-1600618528240-fb9fc964b853?ixlib=rb-1.2.1&auto=format&fit=crop&w=1200&q=75&fm=webp 1200w,
                        https://images.unsplash.com/photo-1600618528240-fb9fc964b853?ixlib=rb-1.2.1&auto=format&fit=crop&w=2850&q=75&fm=webp 2850w"
                sizes="100vw"
                type="image/webp"
              />
              <img
                src="https://images.unsplash.com/photo-1600618528240-fb9fc964b853?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=75"
                alt=""
                className="w-full h-full object-cover"
                loading="eager"
                decoding="async"
                fetchPriority="high"
                width="800"
                height="600"
              />
            </picture>
            <div className="absolute inset-0 bg-sage-900/40" />
          </div>

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center text-white"
            >
              <h1
                id="hero-title"
                className="text-5xl md:text-6xl font-serif font-semibold mb-6"
              >
                Bienvenue sur OMF Thérapie
              </h1>
              <p className="text-xl md:text-2xl mb-8 max-w-3xl mx-auto">
                Votre partenaire pour un bien-être psychologique durable
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  to="/contact"
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

        {/* Introduction Section */}
        <section className="py-20 bg-white" aria-labelledby="intro-title">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="text-center"
            >
              <h2 id="intro-title" className="section-title">
                Bienvenue dans mon cabinet
              </h2>
              <p className="section-subtitle">
                Je vous accompagne dans votre cheminement personnel avec
                bienveillance et professionnalisme, pour vous aider à surmonter
                vos difficultés et retrouver un équilibre harmonieux.
              </p>
            </motion.div>

            <div className="mt-16 grid md:grid-cols-3 gap-8">
              {[
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
                  description:
                    "Une prise en charge holistique pour un mieux-être durable.",
                },
              ].map((item, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.2 }}
                  className="bg-sage-50 p-8 rounded-lg"
                >
                  <h3 className="text-xl font-serif font-semibold text-sage-800 mb-4">
                    {item.title}
                  </h3>
                  <p className="text-sage-600">{item.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Other Sections */}
        <section id="about" aria-label="À propos">
          <About />
        </section>

        <section id="services" aria-label="Services">
          <Services />
        </section>

        <section id="process" aria-label="Processus">
          <Process />
        </section>

        <section id="qualifications" aria-label="Qualifications">
          <Qualifications />
        </section>

        <section id="pricing" aria-label="Tarifs">
          <Pricing />
        </section>
      </div>
    </>
  );
};

export default Home;


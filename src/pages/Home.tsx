import SEO from "../components/SEO";
import { HeroSection } from "../components/home/HeroSection";
import { IntroSection } from "../components/home/IntroSection";
import About from "./About";
import Pricing from "./Pricing";
import Process from "./Process";
import Qualifications from "./Qualifications";
import Services from "./Services";

const Home = () => {
  return (
    <>
      <SEO
        title="Oriane Montabonnet - Thérapeute à Montpellier"
        description="Thérapeute professionnelle à Montpellier, Oriane Montabonnet vous accompagne dans votre développement personnel. Thérapie individuelle, gestion du stress et accompagnement personnalisé."
      />
      <div>
        <HeroSection />
        <IntroSection />

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


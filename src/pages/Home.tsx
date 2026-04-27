import { useEffect } from "react";
import SEO from "../components/SEO";
import StructuredData from "../components/StructuredData";
import { HeroSection } from "../components/home/HeroSection";
import { IntroSection } from "../components/home/IntroSection";
import About from "./About";
import Pricing from "./Pricing";
import Process from "./Process";
import Qualifications from "./Qualifications";
import Services from "./Services";
import {
  buildLocalBusinessSchema,
  buildPersonSchema,
  buildFAQSchema,
  FAQ_ITEMS,
} from "../utils/schema";
import FAQSection from "../components/home/FAQSection";
import LocalAreaSection from "../components/home/LocalAreaSection";

const Home = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <>
      <SEO
        title="Oriane Montabonnet - Thérapeute à Montpellier"
        description="Oriane Montabonnet, thérapeute à Montpellier, vous accompagne en thérapie individuelle, de couple et familiale. Cabinet au 1086 Av. Albert Einstein, Montpellier."
      />
      <StructuredData schema={buildLocalBusinessSchema()} />
      <StructuredData schema={buildPersonSchema()} />
      <StructuredData schema={buildFAQSchema(FAQ_ITEMS)} />
      <div>
        <HeroSection />
        <IntroSection />
        <LocalAreaSection />

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

        <FAQSection faqs={FAQ_ITEMS} />

        <section id="pricing" aria-label="Tarifs">
          <Pricing />
        </section>
      </div>
    </>
  );
};

export default Home;

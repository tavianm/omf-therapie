import { motion } from "framer-motion";
import { useEffect } from "react";
import SEO from "../components/SEO";
import { ContactForm } from "../components/contact/ContactForm";
import { ContactInfo } from "../components/contact/ContactInfo";
import { LocationMap } from "../components/contact/LocationMap";
import { useMotionVariants } from "../hooks/useMotionVariants";

const Contact = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const { fadeInUp, fadeInLeft, fadeInRight } = useMotionVariants();

  return (
    <>
      <SEO
        title="Contact | Oriane Montabonnet - Thérapeute à Montpellier"
        description="Contactez Oriane Montabonnet, thérapeute à Montpellier. Prenez rendez-vous pour une consultation et commencez votre parcours vers le bien-être."
      />
      <div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ">
          <motion.div {...fadeInUp()} className="text-center mb-10">
            <h1 className="section-title mt-6">Contact</h1>
            <p className="section-subtitle">
              Je suis à votre écoute pour toute question ou prise de rendez-vous
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 md:gap-12 mb-12">
            <motion.div {...fadeInLeft()} className="space-y-8">
              <OnlineBooking />
              <ContactInfo />
            </motion.div>

            <motion.div {...fadeInRight()}>
              <ContactForm />
            </motion.div>
            <div className="md:col-span-2 md:-mt-8">
              <LocationMap />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const OnlineBooking = () => (
  <div>
    <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
      Prendre rendez-vous en ligne
    </h2>
    <div className="bg-white p-8 rounded-lg shadow-sm">
      <p className="text-sage-600 mb-6">
        Réservez votre consultation en quelques clics via notre plateforme
        sécurisée Hellocare.
      </p>
      <a
        href="https://hellocare.com/psychopraticien/montpellier/montabonnet-oriane"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary w-full justify-center"
      >
        Réserver une consultation
      </a>
    </div>
  </div>
);

export default Contact;

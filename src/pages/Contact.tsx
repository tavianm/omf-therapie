import { motion } from "framer-motion";
import SEO from "../components/SEO";
import { ContactForm } from "../components/contact/ContactForm";
import { ContactInfo } from "../components/contact/ContactInfo";
import { LocationMap } from "../components/contact/LocationMap";

const Contact = () => {
  return (
    <>
      <SEO
        title="Contact | Oriane Montabonnet - Thérapeute à Montpellier"
        description="Contactez Oriane Montabonnet, thérapeute à Montpellier. Prenez rendez-vous pour une consultation et commencez votre parcours vers le bien-être."
        canonical="https://www.omf-therapie.fr/contact"
      />
      <div className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2 className="section-title">Contact</h2>
            <p className="section-subtitle">
              Je suis à votre écoute pour toute question ou prise de rendez-vous
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-12">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="space-y-8"
            >
              <OnlineBooking />
              <ContactInfo />
              <LocationMap />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <ContactForm />
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
};

const OnlineBooking = () => (
  <div>
    <h3 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
      Prendre rendez-vous en ligne
    </h3>
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

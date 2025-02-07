import React from 'react';
import { motion } from 'framer-motion';
import { Phone, Mail, MapPin, Clock } from 'lucide-react';

const Contact = () => {
  return (
    <div className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h1 className="section-title">Contact</h1>
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
            <div>
              <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
                Informations de Contact
              </h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Phone className="h-5 w-5 text-mint-600" />
                  <span className="text-sage-600">01 23 45 67 89</span>
                </div>
                <div className="flex items-center gap-4">
                  <Mail className="h-5 w-5 text-mint-600" />
                  <span className="text-sage-600">contact@clairemartin.fr</span>
                </div>
                <div className="flex items-center gap-4">
                  <MapPin className="h-5 w-5 text-mint-600" />
                  <span className="text-sage-600">123 rue de la Paix, Paris</span>
                </div>
                <div className="flex items-center gap-4">
                  <Clock className="h-5 w-5 text-mint-600" />
                  <div className="text-sage-600">
                    <p>Lundi - Vendredi: 9h - 19h</p>
                    <p>Samedi: 9h - 13h</p>
                    <p>Dimanche: Fermé</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
                Cabinet
              </h2>
              <div className="aspect-w-16 aspect-h-9">
                <iframe
                  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2624.9916256937595!2d2.3294481156744993!3d48.86863857928921!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47e66e38f817b573%3A0x48d69c30470e7aeb!2sPlace%20Vend%C3%B4me!5e0!3m2!1sen!2sfr!4v1628597681669!5m2!1sen!2sfr"
                  className="w-full h-[300px] rounded-lg"
                  loading="lazy"
                ></iframe>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <form className="bg-white p-8 rounded-lg shadow-sm">
              <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
                Formulaire de Contact
              </h2>
              <div className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-sage-700 mb-2">
                    Nom complet
                  </label>
                  <input
                    type="text"
                    id="name"
                    className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-sage-700 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    id="email"
                    className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-sage-700 mb-2">
                    Téléphone
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-sage-700 mb-2">
                    Message
                  </label>
                  <textarea
                    id="message"
                    rows={4}
                    className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                  ></textarea>
                </div>
                <button
                  type="submit"
                  className="w-full btn-primary justify-center"
                >
                  Envoyer
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Contact;
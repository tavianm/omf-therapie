import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const Pricing = () => {
  const prices = [
    {
      title: "Consultation Individuelle",
      price: "70€",
      duration: "50 minutes",
      features: [
        "Séance en cabinet",
        "Suivi personnalisé",
        "Techniques adaptées à vos besoins",
        "Exercices pratiques"
      ]
    },
    {
      title: "Thérapie de Couple",
      price: "90€",
      duration: "60 minutes",
      features: [
        "Séance pour deux personnes",
        "Médiation relationnelle",
        "Outils de communication",
        "Suivi personnalisé"
      ]
    },
    {
      title: "Pack 5 Séances",
      price: "325€",
      duration: "5 x 50 minutes",
      features: [
        "Économie de 25€",
        "Suivi régulier",
        "Progression structurée",
        "Flexibilité des horaires"
      ]
    }
  ];

  return (
    <div className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h1 className="section-title">Tarifs des Consultations</h1>
          <p className="section-subtitle">
            Des tarifs transparents adaptés à vos besoins
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {prices.map((price, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="bg-white p-8 rounded-lg shadow-sm hover:shadow-md transition-shadow"
            >
              <h3 className="text-xl font-serif font-semibold text-sage-800 mb-4">
                {price.title}
              </h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-serif font-semibold text-mint-600">
                  {price.price}
                </span>
                <span className="text-sage-500 ml-2">/ {price.duration}</span>
              </div>
              <ul className="space-y-4">
                {price.features.map((feature, featureIndex) => (
                  <li key={featureIndex} className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-mint-600" />
                    <span className="text-sage-600">{feature}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="mt-16 grid md:grid-cols-2 gap-8"
        >
          <div className="bg-sage-50 p-8 rounded-lg">
            <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
              Modalités de Paiement
            </h2>
            <ul className="space-y-4 text-sage-600">
              <li>Paiement par carte bancaire</li>
              <li>Paiement en espèces</li>
              <li>Virement bancaire</li>
              <li>Règlement à chaque séance</li>
              <li>Facture fournie sur demande</li>
            </ul>
          </div>

          <div className="bg-sage-50 p-8 rounded-lg">
            <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
              Remboursements
            </h2>
            <div className="space-y-4 text-sage-600">
              <p>
                Les consultations peuvent être partiellement prises en charge par certaines mutuelles. 
                N'hésitez pas à vous renseigner auprès de votre organisme complémentaire.
              </p>
              <p>
                Une facture détaillée vous sera fournie pour faciliter vos démarches de remboursement.
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="mt-16 bg-white p-8 rounded-lg shadow-sm text-center"
        >
          <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-4">
            Politique d'Annulation
          </h2>
          <p className="text-sage-600 max-w-2xl mx-auto">
            Toute annulation doit être effectuée au moins 24 heures à l'avance. 
            En cas d'annulation tardive ou d'absence non justifiée, la séance sera due. 
            Cette politique permet de garantir une disponibilité optimale pour l'ensemble des patients.
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Pricing;
import { motion } from "framer-motion";
import parse from "html-react-parser";
import { Check } from "lucide-react";

const Pricing = () => {
  const prices = [
    {
      title: "Thérapie Individuelle",
      priceDetails: [
        { price: "50€", duration: "60 minutes" },
        { price: "65€", duration: "90 minutes" },
      ],
      features: [
        "Suivi personnalisé",
        "Séance en cabinet",
        "Téléconsultation",
        "1<sup>re</sup> séance => -25€",
      ],
    },
    {
      title: "Thérapie conjugale",
      priceDetails: [
        { price: "70€", duration: "60 minutes" },
        { price: "85€", duration: "90 minutes" },
      ],
      features: [
        "Médiation relationnelle",
        "Séance en cabinet",
        "Téléconsultation",
        "1<sup>re</sup> séance => -25€",
      ],
    },
    {
      title: "Thérapie familiale",
      priceDetails: [
        { price: "80€", duration: "60 minutes" },
        { price: "95€", duration: "90 minutes" },
      ],
      features: [
        "Suivi personnalisé",
        "Médiation relationnelle",
        "Séance en cabinet",
        "1<sup>re</sup> séance => -25€",
        ,
      ],
    },
    {
      title: "Tarifs solidaires",
      priceDetails: [{ price: "-15€", duration: "séance" }],
      duration: "5 x 50 minutes",
      features: [
        "RSA / ASS / Etudiant",
        "Avec justificatif",
        "Séance en cabinet",
        "Téléconsultation",
      ],
    },
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

        <div className="grid xl:grid-cols-4 sm:grid-cols-2 gap-8">
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
              {price.priceDetails?.map((price, priceIndex, array) => (
                <div
                  className={
                    "flex items-baseline " +
                    (priceIndex > 0
                      ? "mb-6"
                      : array.length === 1
                      ? "my-10 pb-1"
                      : "mb-1")
                  }
                >
                  <span className="text-4xl font-serif font-semibold text-mint-600">
                    {price.price}
                  </span>
                  <span className="text-sage-500 ml-2">/ {price.duration}</span>
                </div>
              ))}
              <ul className="space-y-4">
                {price.features.map((feature, featureIndex) => (
                  <li key={featureIndex} className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-mint-600" />
                    <span className="text-sage-600">
                      {feature && parse(feature)}
                    </span>
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
                Les consultations peuvent être partiellement prises en charge
                par certaines mutuelles. N'hésitez pas à vous renseigner auprès
                de votre organisme complémentaire.
              </p>
              <p>
                Une facture détaillée vous sera fournie, sur demande, pour
                faciliter vos démarches de remboursement.
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
            Engagement et responsabilité
          </h2>
          <p className="text-sage-600 max-w-3xl mx-auto">
            Comme 95% de nos patients, nous comptons sur votre présence au
            rendez-vous prévu.
          </p>

          <p className="text-sage-600 max-w-3xl mx-auto my-4">
            Si vous ne pouvez pas honorer votre consultation, merci de bien
            vouloir : Annuler votre rendez-vous au moins 4 heures à l'avance
            Utiliser notre système en ligne ou nous contacter directement Votre
            geste permettra à un autre patient en attente de bénéficier de ce
            créneau.
          </p>
          <p className="text-sage-600 max-w-3xl mx-auto">
            Nous vous remercions pour votre compréhension et votre
            collaboration.
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default Pricing;


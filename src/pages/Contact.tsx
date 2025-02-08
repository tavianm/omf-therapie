import emailjs from "@emailjs/browser";
import { motion } from "framer-motion";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import React, { useEffect, useState } from "react";
import SEO from "../components/SEO";

const Contact = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  const [status, setStatus] = useState({
    message: "",
    type: "", // 'success' ou 'error'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.id]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus({ message: "", type: "" });

    try {
      const result = await emailjs.send(
        "service_bdzolup", // Remplacer par votre Service ID
        "template_ora67us", // Remplacer par votre Template ID
        {
          from_name: formData.name,
          from_email: formData.email,
          phone: formData.phone,
          message: formData.message,
          to_name: "Oriane Montabonnet",
        },
        "a16S46gFg6v_HVO3I" // Remplacer par votre Public Key
      );

      if (result.status === 200) {
        setStatus({
          message: "Votre message a été envoyé avec succès !",
          type: "success",
        });
        setFormData({
          name: "",
          email: "",
          phone: "",
          message: "",
        });
      }
    } catch {
      setStatus({
        message:
          "Une erreur est survenue lors de l'envoi du message. Veuillez réessayer.",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <SEO
        title="Contact | Oriane Montabonnet - Thérapeute à Montpellier"
        description="Contactez Oriane Montabonnet, thérapeute à Montpellier. Prenez rendez-vous pour une consultation et commencez votre parcours vers le bien-être."
        canonical="https://www.omf-therapie.fr//contact"
      />
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
                    <span className="text-sage-600">06 50 33 18 53</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <Mail className="h-5 w-5 text-mint-600" />
                    <span className="text-sage-600">
                      contact@omf-therapie.fr
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <MapPin className="h-5 w-5 text-mint-600" />
                    <span className="text-sage-600">
                      185 cour Messier, Montpellier
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <Clock className="h-5 w-5 text-mint-600" />
                    <div className="text-sage-600">
                      <p>Lundi - Vendredi</p>
                      <p>8h - 10h</p>
                      <p>15h30 - 19h</p>
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
                    src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2624.9916256937595!2d2.3294481156744993!3d48.86863857928921!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x12b6a585a9083373%3A0xaee98960437b8f02!2s185%20Cr%20Messier%2C%2034000%20Montpellier!5e0!3m2!1sen!2sfr!4v1628597681669!5m2!1sen!2sfr"
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
              <form
                onSubmit={handleSubmit}
                className="bg-white p-8 rounded-lg shadow-sm"
              >
                <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-6">
                  Formulaire de Contact
                </h2>
                {status.message && (
                  <div
                    className={`mb-6 p-4 rounded-lg ${
                      status.type === "success"
                        ? "bg-green-50 text-green-800"
                        : "bg-red-50 text-red-800"
                    }`}
                  >
                    {status.message}
                  </div>
                )}
                <div className="space-y-6">
                  <div>
                    <label
                      htmlFor="name"
                      className="block text-sm font-medium text-sage-700 mb-2"
                    >
                      Nom complet
                    </label>
                    <input
                      type="text"
                      id="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="email"
                      className="block text-sm font-medium text-sage-700 mb-2"
                    >
                      Email
                    </label>
                    <input
                      type="email"
                      id="email"
                      value={formData.email}
                      onChange={handleChange}
                      required
                      className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="phone"
                      className="block text-sm font-medium text-sage-700 mb-2"
                    >
                      Téléphone
                    </label>
                    <input
                      type="tel"
                      id="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="message"
                      className="block text-sm font-medium text-sage-700 mb-2"
                    >
                      Message
                    </label>
                    <textarea
                      id="message"
                      value={formData.message}
                      onChange={handleChange}
                      required
                      rows={4}
                      className="w-full px-4 py-2 rounded-lg border border-sage-200 focus:ring-2 focus:ring-mint-500 focus:border-transparent"
                    ></textarea>
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`w-full btn-primary justify-center ${
                      isSubmitting ? "opacity-75 cursor-not-allowed" : ""
                    }`}
                  >
                    {isSubmitting ? "Envoi en cours..." : "Envoyer"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Contact;


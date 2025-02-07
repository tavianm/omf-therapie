import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const Home = () => {
  return (
    <div>
      {/* Hero Section */}
      <section className="relative h-[90vh] flex items-center">
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1600618528240-fb9fc964b853?ixlib=rb-1.2.1&auto=format&fit=crop&w=2850&q=80)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-sage-900/40" />
        </div>
        
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center text-white"
          >
            <h1 className="text-5xl md:text-6xl font-serif font-semibold mb-6">
              Retrouvez votre équilibre intérieur
            </h1>
            <p className="text-xl md:text-2xl mb-8 max-w-3xl mx-auto">
              Un accompagnement thérapeutique personnalisé pour vous guider vers le bien-être
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/contact"
                className="btn-primary"
              >
                <Calendar className="w-5 h-5" />
                Prendre rendez-vous
              </Link>
              <Link
                to="/about"
                className="inline-flex items-center gap-2 text-white hover:text-mint-200 transition-colors"
              >
                En savoir plus
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Introduction Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h2 className="section-title">Bienvenue dans mon cabinet</h2>
            <p className="section-subtitle">
              Je vous accompagne dans votre cheminement personnel avec bienveillance et professionnalisme,
              pour vous aider à surmonter vos difficultés et retrouver un équilibre harmonieux.
            </p>
          </motion.div>

          <div className="mt-16 grid md:grid-cols-3 gap-8">
            {[
              {
                title: 'Écoute Attentive',
                description: 'Un espace sécurisant où vous pouvez vous exprimer librement, sans jugement.'
              },
              {
                title: 'Approche Personnalisée',
                description: 'Une thérapie adaptée à vos besoins spécifiques et à votre rythme.'
              },
              {
                title: 'Accompagnement Global',
                description: 'Une prise en charge holistique pour un mieux-être durable.'
              }
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
                <p className="text-sage-600">
                  {item.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
import React from "react";
import { Helmet } from "react-helmet-async";

interface SEOProps {
  title: string;
  description: string;
  canonical?: string;
  type?: string;
  name?: string;
  image?: string;
}

const SEO: React.FC<SEOProps> = ({
  title,
  description,
  canonical = "https://omf-therapie.fr/",
  type = "website",
  name = "Oriane Montabonnet",
  image = "https://omf-therapie.fr/assets/oriane-montabonnet-1.webp", // Ajoutez une image par défaut
}) => {
  return (
    <Helmet>
      {/* Balises standards */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:url" content={canonical} />
      <meta property="og:site_name" content={name} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* Autres balises importantes */}
      <meta name="robots" content="index, follow" />
      <meta name="language" content="fr" />
      <meta name="author" content={name} />
    </Helmet>
  );
};

export default SEO;


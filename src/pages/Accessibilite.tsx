import { Helmet } from "react-helmet-async";

export default function Accessibilite() {
  window.scrollTo(0, 0);
  return (
    <section className="max-w-3xl mx-auto px-4 py-8 md:py-10">
      <Helmet>
        <title>Déclaration d’accessibilité — OMF Thérapie</title>
        <meta
          name="description"
          content="Déclaration d’accessibilité d’OMF Thérapie conformément à l’article 47 de la loi n° 2005-102 du 11 février 2005."
        />
      </Helmet>

      <h1 className="text-3xl md:text-4xl font-serif font-semibold text-sage-800 mb-6">
        Déclaration d’accessibilité
      </h1>

      <p className="text-sage-700 mb-4">Établie le 5 octobre 2025.</p>

      <p className="mb-6">
        Notre organisation s’engage à rendre son service accessible,
        conformément à l’article 47 de la loi n° 2005-102 du 11 février 2005.
      </p>

      <p className="mb-8">
        Cette déclaration d’accessibilité s’applique à{" "}
        <strong>OMF Thérapie</strong> (
        <a
          href="https://omf-therapie.fr/"
          className="text-mint-600 underline hover:text-mint-700"
        >
          https://omf-therapie.fr/
        </a>
        ).
      </p>

      <h2 className="text-2xl font-serif font-semibold text-sage-800 mt-8 mb-3">
        État de conformité
      </h2>
      <div className="h-px bg-sage-200 mb-6" aria-hidden="true" />
      <p className="mb-8">
        <strong>OMF Thérapie</strong> est <strong>non conforme</strong> avec le
        RGAA. Le site n’a encore pas été audité.
      </p>

      <h2 className="text-2xl font-serif font-semibold text-sage-800 mt-8 mb-3">
        Établissement de cette déclaration d’accessibilité
      </h2>
      <div className="h-px bg-sage-200 mb-6" aria-hidden="true" />
      <p className="mb-8">Cette déclaration a été établie le 5 octobre 2025.</p>

      <h3 className="text-xl font-serif font-semibold text-sage-800 mt-6 mb-3">
        Technologies utilisées
      </h3>
      <p className="mb-4">
        L’accessibilité de OMF Thérapie s’appuie sur les technologies
        suivantes :
      </p>
      <ul className="list-disc pl-6 space-y-1 mb-8">
        <li>HTML</li>
        <li>WAI-ARIA</li>
        <li>CSS</li>
        <li>JavaScript</li>
      </ul>

      <h2 className="text-2xl font-serif font-semibold text-sage-800 mt-8 mb-3">
        Amélioration et contact
      </h2>
      <div className="h-px bg-sage-200 mb-6" aria-hidden="true" />
      <p className="mb-4">
        Si vous n’arrivez pas à accéder à un contenu ou à un service, vous
        pouvez contacter le responsable de OMF Thérapie pour être orienté vers
        une alternative accessible ou obtenir le contenu sous une autre forme.
      </p>
      <ul className="list-disc pl-6 space-y-1 mb-4">
        <li>
          Téléphone :{" "}
          <a
            href="tel:0650331853"
            className="text-mint-600 underline hover:text-mint-700"
          >
            0650331853
          </a>
        </li>
        <li>
          E-mail :{" "}
          <a
            href="mailto:montabonnet.therapie@gmail.com"
            className="text-mint-600 underline hover:text-mint-700"
          >
            montabonnet.therapie@gmail.com
          </a>
        </li>
        <li>
          Formulaire de contact :{" "}
          <a
            href="/contact"
            className="text-mint-600 underline hover:text-mint-700"
          >
            Nous contacter
          </a>
        </li>
        <li>Adresse : Montpellier</li>
        <li>
          <a
            href="https://www.instagram.com/omf.therapie"
            className="text-mint-600 underline hover:text-mint-700"
          >
            @omf.therapie
          </a>
        </li>
      </ul>
      <p className="mb-8">Nous essayons de répondre dans les 2 jours ouvrés.</p>

      <h2 className="text-2xl font-serif font-semibold text-sage-800 mt-8 mb-3">
        Voie de recours
      </h2>
      <div className="h-px bg-sage-200 mb-6" aria-hidden="true" />
      <p className="mb-4">
        Cette procédure est à utiliser dans le cas suivant : vous avez signalé
        au responsable du site internet un défaut d’accessibilité qui vous
        empêche d’accéder à un contenu ou à un des services du portail et vous
        n’avez pas obtenu de réponse satisfaisante.
      </p>
      <p className="mb-3">Vous pouvez :</p>
      <ul className="list-disc pl-6 space-y-2 mb-8">
        <li>
          <a
            href="https://formulaire.defenseurdesdroits.fr/formulaire_saisine/"
            className="text-mint-600 underline hover:text-mint-700"
          >
            Écrire un message au Défenseur des droits
          </a>
        </li>
        <li>
          <a
            href="https://www.defenseurdesdroits.fr/carte-des-delegues"
            className="text-mint-600 underline hover:text-mint-700"
          >
            Contacter le délégué du Défenseur des droits dans votre région
          </a>
        </li>
        <li>
          Envoyer un courrier par la poste (gratuit, ne pas mettre de timbre) :
          <br />
          <address className="not-italic">
            Défenseur des droits
            <br />
            Libre réponse 71120
            <br />
            75342 Paris CEDEX 07
          </address>
        </li>
      </ul>

      <hr className="my-8 border-sage-200" />

      <p className="text-sage-600">
        Cette déclaration d’accessibilité a été créé le 5 octobre 2025 grâce au
        Générateur de Déclaration d’Accessibilité.
      </p>
    </section>
  );
}

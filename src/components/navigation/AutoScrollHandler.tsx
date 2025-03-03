import { useScrollToSection } from "../../hooks/useScrollToSection";

interface AutoScrollHandlerProps {
  pathToSectionMap: Record<string, string>;
  options?: {
    offset?: number;
    behavior?: ScrollBehavior;
  };
}

/**
 * Composant qui gère automatiquement le défilement vers les sections
 * basé sur l'URL actuelle
 */
export const AutoScrollHandler: React.FC<AutoScrollHandlerProps> = ({
  pathToSectionMap,
  options,
}) => {
  // Utilise le hook personnalisé pour gérer le défilement
  useScrollToSection(pathToSectionMap, {
    behavior: "instant",
    ...options,
  });

  // Ce composant ne rend rien, il gère seulement le défilement
  return null;
};


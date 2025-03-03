import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

interface ScrollOptions {
  offset?: number;
  behavior?: ScrollBehavior;
  delay?: number;
  maxRetries?: number;
  retryInterval?: number;
}

/**
 * Hook personnalisé pour gérer le défilement vers des sections spécifiques
 * @param pathToSectionMap - Mapping des chemins d'URL vers les IDs de section
 * @param options - Options de défilement (offset, behavior, delay)
 */
export const useScrollToSection = (
  pathToSectionMap?: Record<string, string>,
  options: ScrollOptions = {}
) => {
  const location = useLocation();
  const pendingScrollRef = useRef<string | null>(null);

  const {
    offset = 80,
    behavior = "smooth",
    delay = 0,
    maxRetries = 10,
    retryInterval = 50,
  } = options;

  // Fonction pour défiler vers une section spécifique avec retries
  const scrollToSection = useCallback(
    (sectionId: string): boolean => {
      // Stocker l'ID de section pour les retries
      pendingScrollRef.current = sectionId;

      // Fonction qui tente de défiler vers la section
      const attemptScroll = (retriesLeft: number) => {
        try {
          // Vérifier si c'est toujours la section cible actuelle
          if (pendingScrollRef.current !== sectionId) {
            return false;
          }

          const element = document.getElementById(sectionId);

          if (!element) {
            if (retriesLeft <= 0) {
              console.warn(
                `Section avec l'ID "${sectionId}" non trouvée après plusieurs tentatives.`
              );
              pendingScrollRef.current = null;
              return false;
            }

            // Réessayer après un délai
            setTimeout(() => attemptScroll(retriesLeft - 1), retryInterval);
            return false;
          }

          // Élément trouvé, effectuer le défilement
          const elementPosition = element.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - offset;

          window.scrollTo({
            top: offsetPosition,
            behavior,
          });

          pendingScrollRef.current = null;
          return true;
        } catch (error) {
          console.error(
            `Erreur lors du défilement vers la section "${sectionId}":`,
            error
          );
          pendingScrollRef.current = null;
          return false;
        }
      };

      // Démarrer la tentative de défilement
      return attemptScroll(maxRetries);
    },
    [offset, behavior, maxRetries, retryInterval]
  );

  // Fonction pour défiler vers une section basée sur le chemin d'URL
  const scrollToSectionFromPath = useCallback(
    (path: string): boolean => {
      if (!pathToSectionMap) return false;

      // Trouver la correspondance la plus longue dans le mapping
      const matchingPaths = Object.keys(pathToSectionMap)
        .filter((mappedPath) =>
          path.toLowerCase().endsWith(mappedPath.toLowerCase())
        )
        .sort((a, b) => b.length - a.length);

      if (matchingPaths.length > 0) {
        const sectionId = pathToSectionMap[matchingPaths[0]];
        return scrollToSection(sectionId);
      }

      return false;
    },
    [pathToSectionMap, scrollToSection]
  );

  // Effet pour gérer le défilement automatique basé sur l'URL
  useEffect(() => {
    if (pathToSectionMap) {
      // Utiliser un délai pour s'assurer que le contenu est chargé
      const timeoutId = setTimeout(() => {
        scrollToSectionFromPath(location.pathname);
      }, delay);

      return () => clearTimeout(timeoutId);
    }
  }, [location.pathname, scrollToSectionFromPath, delay, pathToSectionMap]);

  return {
    scrollToSection,
    scrollToSectionFromPath,
  };
};


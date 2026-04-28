import { useCallback, useRef } from "react";

interface ScrollOptions {
  offset?: number;
  behavior?: ScrollBehavior;
  maxRetries?: number;
  retryInterval?: number;
}

/**
 * Hook personnalisé pour gérer le défilement vers des sections spécifiques.
 * Compatible Astro (sans react-router-dom).
 */
export const useScrollToSection = (options: ScrollOptions = {}) => {
  const pendingScrollRef = useRef<string | null>(null);
  const {
    offset = 80,
    behavior = "smooth",
    maxRetries = 10,
    retryInterval = 100,
  } = options;

  const scrollToSection = useCallback(
    (sectionId: string): boolean => {
      pendingScrollRef.current = sectionId;

      const attemptScroll = (retriesLeft: number): boolean => {
        if (pendingScrollRef.current !== sectionId) return false;

        const element = document.getElementById(sectionId);

        if (!element) {
          if (retriesLeft <= 0) {
            console.warn(`Section #${sectionId} not found`);
            return false;
          }
          setTimeout(() => attemptScroll(retriesLeft - 1), retryInterval);
          return false;
        }

        const elementTop =
          element.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: elementTop - offset, behavior });
        return true;
      };

      return attemptScroll(maxRetries);
    },
    [offset, behavior, maxRetries, retryInterval]
  );

  return { scrollToSection };
};


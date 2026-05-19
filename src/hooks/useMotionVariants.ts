import { useMemo } from "react";
import type { MotionProps } from "framer-motion";

interface MotionVariantOptions {
  duration?: number;
  delay?: number;
  distance?: number;
}

// Renders the element at its final visible state with a gentle opacity fade.
// - initial:false inherits the SSR DOM state (opacity:0 + transform offsets from framer-motion SSR)
// - animate resets transforms instantly (x/y duration:0) to avoid positional jumps
// - opacity fades in smoothly (0.35s) so content doesn't snap brutally on scroll
// - No WAAPI-heavy features (no IntersectionObserver, no will-change, no stagger)
//   → safe in WKWebView (Apple Messages limited webview)
const staticProps: MotionProps = {
  initial: false,
  animate: { opacity: 1, x: 0, y: 0 },
  transition: {
    opacity: { duration: 0.35, ease: "easeOut" },
    x: { duration: 0 },
    y: { duration: 0 },
  },
};

function shouldDisableAnimations(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  // Touch-primary devices (phones/tablets): limited GPU memory in WKWebView.
  if (window.matchMedia("(hover: none) and (pointer: coarse)").matches)
    return true;
  // Explicit accessibility preference.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  return false;
}

export const useMotionVariants = () => {
  const noMotion = useMemo(() => shouldDisableAnimations(), []);

  const fadeInUp = (options: MotionVariantOptions = {}): MotionProps => {
    if (noMotion) return staticProps;
    return {
      initial: { opacity: 0, y: options.distance ?? 20 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true },
      transition: {
        duration: options.duration ?? 0.8,
        delay: options.delay ?? 0,
      },
    };
  };

  const fadeIn = (options: MotionVariantOptions = {}): MotionProps => {
    if (noMotion) return staticProps;
    return {
      initial: { opacity: 0 },
      whileInView: { opacity: 1 },
      viewport: { once: true },
      transition: {
        duration: options.duration ?? 0.8,
        delay: options.delay ?? 0,
      },
    };
  };

  const fadeInLeft = (options: MotionVariantOptions = {}): MotionProps => {
    if (noMotion) return staticProps;
    return {
      initial: { opacity: 0, x: -(options.distance ?? 20) },
      whileInView: { opacity: 1, x: 0 },
      viewport: { once: true },
      transition: {
        duration: options.duration ?? 0.8,
        delay: options.delay ?? 0,
      },
    };
  };

  const fadeInRight = (options: MotionVariantOptions = {}): MotionProps => {
    if (noMotion) return staticProps;
    return {
      initial: { opacity: 0, x: options.distance ?? 20 },
      whileInView: { opacity: 1, x: 0 },
      viewport: { once: true },
      transition: {
        duration: options.duration ?? 0.8,
        delay: options.delay ?? 0,
      },
    };
  };

  const staggerChildren = (options: MotionVariantOptions = {}): MotionProps => {
    if (noMotion) return staticProps;
    return {
      initial: { opacity: 0 },
      whileInView: { opacity: 1 },
      viewport: { once: true },
      transition: {
        duration: options.duration ?? 0.3,
        staggerChildren: options.delay ?? 0.1,
      },
    };
  };

  return {
    fadeInUp,
    fadeIn,
    fadeInLeft,
    fadeInRight,
    staggerChildren,
  };
};

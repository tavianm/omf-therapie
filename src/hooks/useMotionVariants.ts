import { MotionProps } from "framer-motion";

interface MotionVariantOptions {
  duration?: number;
  delay?: number;
  distance?: number;
}

export const useMotionVariants = () => {
  const fadeInUp = (options: MotionVariantOptions = {}): MotionProps => ({
    initial: { opacity: 0, y: options.distance ?? 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: {
      duration: options.duration ?? 0.8,
      delay: options.delay ?? 0,
    },
  });

  const fadeIn = (options: MotionVariantOptions = {}): MotionProps => ({
    initial: { opacity: 0 },
    whileInView: { opacity: 1 },
    viewport: { once: true },
    transition: {
      duration: options.duration ?? 0.8,
      delay: options.delay ?? 0,
    },
  });

  const fadeInLeft = (options: MotionVariantOptions = {}): MotionProps => ({
    initial: { opacity: 0, x: -(options.distance ?? 20) },
    whileInView: { opacity: 1, x: 0 },
    viewport: { once: true },
    transition: {
      duration: options.duration ?? 0.8,
      delay: options.delay ?? 0,
    },
  });

  const fadeInRight = (options: MotionVariantOptions = {}): MotionProps => ({
    initial: { opacity: 0, x: options.distance ?? 20 },
    whileInView: { opacity: 1, x: 0 },
    viewport: { once: true },
    transition: {
      duration: options.duration ?? 0.8,
      delay: options.delay ?? 0,
    },
  });

  const staggerChildren = (
    options: MotionVariantOptions = {}
  ): MotionProps => ({
    initial: { opacity: 0 },
    whileInView: { opacity: 1 },
    viewport: { once: true },
    transition: {
      duration: options.duration ?? 0.3,
      staggerChildren: options.delay ?? 0.1,
    },
  });

  return {
    fadeInUp,
    fadeIn,
    fadeInLeft,
    fadeInRight,
    staggerChildren,
  };
};

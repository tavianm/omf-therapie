import { motion } from "framer-motion";
import { useMotionVariants } from "../../hooks/useMotionVariants";

interface BlogHeaderProps {
  title: string;
  subtitle: string;
}

export const BlogHeader = ({ title, subtitle }: BlogHeaderProps) => {
  const { fadeInUp } = useMotionVariants();

  return (
    <motion.div {...fadeInUp()} className="text-center mb-8">
      <h1 className="section-title mt-6">{title}</h1>
      <p className="section-subtitle">{subtitle}</p>
    </motion.div>
  );
};

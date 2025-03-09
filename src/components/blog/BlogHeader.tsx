import { motion } from "framer-motion";
import { useMotionVariants } from "../../hooks/useMotionVariants";
import { BlogSyncButton } from "./BlogSyncButton";

interface BlogHeaderProps {
  title: string;
  subtitle: string;
  onSyncComplete?: () => void;
  showSyncButton?: boolean;
}

export const BlogHeader = ({ 
  title, 
  subtitle, 
  onSyncComplete,
  showSyncButton = false
}: BlogHeaderProps) => {
  const { fadeInUp } = useMotionVariants();

  return (
    <motion.div {...fadeInUp()} className="text-center mb-10">
      <h1 className="section-title mt-6">{title}</h1>
      <p className="section-subtitle">{subtitle}</p>
      
      {showSyncButton && (
        <div className="mt-4">
          <BlogSyncButton onSyncComplete={onSyncComplete} />
        </div>
      )}
    </motion.div>
  );
};
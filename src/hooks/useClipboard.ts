import { toast } from "react-hot-toast";

export const useClipboard = () => {
  const copyToClipboard = async (
    text: string,
    message: string,
    errorMessage: string
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message, {
        duration: 2000,
        className: "bg-mint-50 text-mint-800 border border-mint-200",
      });
    } catch {
      toast.error(errorMessage, {
        duration: 2000,
        className: "bg-red-50 text-red-800 border border-red-200",
      });
    }
  };

  return { copyToClipboard };
};


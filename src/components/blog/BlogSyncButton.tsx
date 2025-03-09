import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { syncLinkedInPosts } from "../../utils/blogApi";
import { toast } from "react-hot-toast";

interface BlogSyncButtonProps {
  onSyncComplete?: () => void;
}

export const BlogSyncButton = ({ onSyncComplete }: BlogSyncButtonProps) => {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    if (isSyncing) return;
    
    setIsSyncing(true);
    
    try {
      const success = await syncLinkedInPosts();
      
      if (success) {
        toast.success("Synchronisation avec LinkedIn réussie !", {
          duration: 3000,
          className: "bg-mint-50 text-mint-800 border border-mint-200",
          iconTheme: { primary: "#477a6d", secondary: "#ffffff" },
        });
        
        if (onSyncComplete) {
          onSyncComplete();
        }
      } else {
        toast.error("Échec de la synchronisation avec LinkedIn", {
          duration: 3000,
          className: "bg-red-50 text-red-800 border border-red-200",
        });
      }
    } catch (error) {
      console.error("Error syncing LinkedIn posts:", error);
      toast.error("Une erreur est survenue lors de la synchronisation", {
        duration: 3000,
        className: "bg-red-50 text-red-800 border border-red-200",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <button
      onClick={handleSync}
      disabled={isSyncing}
      className={`flex items-center gap-2 px-4 py-2 bg-mint-600 text-white rounded-md hover:bg-mint-700 transition-colors ${
        isSyncing ? "opacity-75 cursor-not-allowed" : ""
      }`}
      aria-label="Synchroniser avec LinkedIn"
    >
      <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
      {isSyncing ? "Synchronisation..." : "Synchroniser avec LinkedIn"}
    </button>
  );
};
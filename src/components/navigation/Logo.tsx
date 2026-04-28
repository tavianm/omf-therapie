import { Leaf } from "lucide-react";

export const Logo = () => (
  <div className="flex items-center mr-3">
    <a
      href="/"
      className="flex items-center"
      aria-label="Accueil Oriane Montabonnet"
    >
      <Leaf className="h-8 w-8 text-mint-600" aria-hidden="true" />
      <span className="ml-2 text-xl font-serif font-medium text-sage-800">
        Oriane Montabonnet
      </span>
    </a>
  </div>
);


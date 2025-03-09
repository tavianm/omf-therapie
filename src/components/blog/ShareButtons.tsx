import { Facebook, Linkedin, Twitter } from "lucide-react";
import { BlogPost } from "../../types/blog";

interface ShareButtonsProps {
  post: BlogPost;
}

export const ShareButtons = ({ post }: ShareButtonsProps) => {
  const shareUrl = `https://omf-therapie.fr/blog/${post.slug}`;
  const shareTitle = post.title;

  const shareLinks = [
    {
      name: "LinkedIn",
      icon: Linkedin,
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
        shareUrl
      )}&title=${encodeURIComponent(shareTitle)}`,
      ariaLabel: "Partager sur LinkedIn",
    },
    {
      name: "Facebook",
      icon: Facebook,
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        shareUrl
      )}`,
      ariaLabel: "Partager sur Facebook",
    },
    {
      name: "Twitter",
      icon: Twitter,
      url: `https://twitter.com/intent/tweet?url=${encodeURIComponent(
        shareUrl
      )}&text=${encodeURIComponent(shareTitle)}`,
      ariaLabel: "Partager sur Twitter",
    },
    /* {
      name: "Email",
      icon: Mail,
      url: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`,
      ariaLabel: "Partager par email",
    }, */
  ];

  return (
    <div className="flex items-center space-x-2">
      {shareLinks.map((link) => (
        <a
          key={link.name}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sage-500 hover:text-mint-600 transition-colors"
          aria-label={link.ariaLabel}
        >
          <link.icon className="h-5 w-5" />
        </a>
      ))}
    </div>
  );
};


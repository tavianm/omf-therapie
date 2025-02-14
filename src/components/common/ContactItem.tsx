export interface ClassNames {
  iconClass?: string;
  textClass?: string;
  containerClass?: string;
}
interface ContactItemProps {
  icon: React.FC<{ className?: string }>;
  text: React.ReactNode;
  classNames?: ClassNames;
  ariaLabel?: string;
  href?: string;
  onClick?: () => void;
}

export const ContactItem = ({
  icon: Icon,
  text,
  classNames,
  ariaLabel,
  href,
  onClick,
}: ContactItemProps) => {
  const content = (
    <>
      <Icon className={"min-h-5 min-w-5 h-5 w-5 " + classNames?.iconClass} />
      <span className={classNames?.textClass}>{text}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={
          "flex items-center w-full text-left transition-colors " +
          classNames?.containerClass
        }
        aria-label={ariaLabel}
      >
        {content}
      </button>
    );
  }

  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        "flex items-center transition-colors " + classNames?.containerClass
      }
      aria-label={ariaLabel}
    >
      {content}
    </a>
  ) : (
    <div className="flex items-center gap-4">{content}</div>
  );
};

interface FooterHeadingProps {
  children: React.ReactNode;
}

export const FooterHeading = ({ children }: FooterHeadingProps) => (
  <h2 className="text-lg font-medium mb-4 text-sage-100">{children}</h2>
);

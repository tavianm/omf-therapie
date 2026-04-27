import { Helmet } from "react-helmet-async";

interface StructuredDataProps {
  schema: Record<string, unknown> | Record<string, unknown>[];
}

export default function StructuredData({ schema }: StructuredDataProps) {
  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
    </Helmet>
  );
}

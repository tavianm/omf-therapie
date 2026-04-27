import { Helmet } from "react-helmet-async";

interface StructuredDataProps {
  schema: Record<string, unknown> | Record<string, unknown>[];
}

function serializeJsonLd(schema: StructuredDataProps["schema"]): string {
  return JSON.stringify(schema).replace(/</g, "\\u003c");
}

export default function StructuredData({ schema }: StructuredDataProps) {
  return (
    <Helmet>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(schema) }}
      />
    </Helmet>
  );
}

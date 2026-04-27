import { FAQItem } from "../../utils/schema";

interface FAQSectionProps {
  faqs: FAQItem[];
}

export default function FAQSection({ faqs }: FAQSectionProps) {
  return (
    <section aria-label="Foire aux questions" className="py-16 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-serif font-semibold text-sage-800 mb-8 text-center">
          Questions fréquentes
        </h2>
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <details
              key={index}
              className="group border border-sage-200 rounded-lg overflow-hidden"
            >
              <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-sage-50 hover:bg-sage-100 transition-colors">
                <span className="font-medium text-sage-800 pr-4">{faq.question}</span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-sage-500 group-open:rotate-180 transition-transform"
                >
                  ▾
                </span>
              </summary>
              <div className="p-4 text-sage-600 text-sm leading-relaxed">
                {faq.answer}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

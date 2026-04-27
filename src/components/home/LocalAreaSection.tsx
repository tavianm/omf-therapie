const MODES = [
  {
    icon: "📍",
    title: "En cabinet à Montpellier",
    description:
      "Je vous reçois au 1086 Avenue Albert Einstein, 34000 Montpellier — accessible depuis le centre-ville et les communes voisines.",
  },
  {
    icon: "💻",
    title: "En téléconsultation",
    description:
      "Les séances en visio sont disponibles où que vous soyez, au même tarif qu'en cabinet.",
  },
];

export default function LocalAreaSection() {
  return (
    <section aria-label="Modalités de consultation" className="py-12 bg-sage-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-xl font-serif font-semibold text-sage-800 mb-8 text-center">
          Thérapeute à Montpellier — en cabinet ou en visio
        </h2>
        <div className="grid sm:grid-cols-2 gap-6">
          {MODES.map((mode) => (
            <div
              key={mode.title}
              className="bg-white border border-sage-200 rounded-lg p-6 text-center"
            >
              <span className="text-3xl mb-3 block" aria-hidden="true">
                {mode.icon}
              </span>
              <h3 className="font-semibold text-sage-800 mb-2">{mode.title}</h3>
              <p className="text-sage-600 text-sm leading-relaxed">
                {mode.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

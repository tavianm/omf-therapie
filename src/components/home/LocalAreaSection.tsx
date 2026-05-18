import { Car, MapPin, Video } from "lucide-react";

const MODES = [
  {
    Icon: MapPin,
    title: "En cabinet à Montpellier",
    description:
      "Je vous reçois au 1086 Avenue Albert Einstein, 34000 Montpellier — accessible depuis le centre-ville et les communes voisines.",
    note: "Parking gratuit sur place.",
  },
  {
    Icon: Video,
    title: "En téléconsultation",
    description:
      "Les séances en visio sont disponibles où que vous soyez, au même tarif qu'en cabinet.",
    note: null,
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
          {MODES.map(({ Icon, title, description, note }) => (
            <div
              key={title}
              className="bg-white border border-sage-200 rounded-lg p-6 text-center"
            >
              <div className="flex justify-center mb-3">
                <Icon className="w-8 h-8 text-sage-500" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-sage-800 mb-2">{title}</h3>
              <p className="text-sage-600 text-sm leading-relaxed">
                {description}
              </p>
              {note && (
                <p className="mt-3 flex items-center justify-center gap-1.5 text-sage-600 text-xs">
                  <Car className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {note}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

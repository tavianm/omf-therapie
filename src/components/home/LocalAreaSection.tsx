const CITIES = [
  "Montpellier",
  "Castelnau-le-Lez",
  "Lattes",
  "Pérols",
  "Juvignac",
  "Grabels",
  "Clapiers",
];

export default function LocalAreaSection() {
  return (
    <section aria-label="Zone de couverture" className="py-12 bg-sage-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-xl font-serif font-semibold text-sage-800 mb-3">
          Thérapeute à Montpellier et ses environs
        </h2>
        <p className="text-sage-600 mb-6 max-w-2xl mx-auto text-sm">
          Le cabinet est situé au 1086 Avenue Albert Einstein, 34000 Montpellier.
          Oriane Montabonnet accompagne également les patients des communes voisines.
        </p>
        <ul className="flex flex-wrap justify-center gap-2" aria-label="Communes desservies">
          {CITIES.map((city) => (
            <li
              key={city}
              className="px-4 py-1.5 bg-white border border-sage-200 rounded-full text-sm text-sage-700 font-medium"
            >
              {city}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
